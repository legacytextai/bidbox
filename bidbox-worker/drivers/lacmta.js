// LA Metro (LACMTA) scan driver — metadata ingestion only.
//
// Portal: Oracle WebCenter Portal / ADF Faces (business.metro.net). Confirmed
// via live recon (docs/handoff/2026-07-06-lacmta-recon-and-blocker.md) that:
//   - A plain HTTP GET of the listing returns only ADF's device-capability
//     "loopback" bootstrap script — no data without executing JS.
//   - Opening a solicitation fires a POST to the *same* listing URL with an
//     incremented Adf-Page-Id (server-side partial-page-render), not a GET to
//     a distinct/bookmarkable resource. There is no stable per-item URL and no
//     JSON/XHR API.
//   - The on-screen results table hard-caps at 25 rows with no pagination
//     control at all (confirmed: internal scroll reveals no more than 25).
//   - The "Download into PDF" export is NOT subject to that cap and returns
//     every currently-open solicitation (confirmed live: ~70 rows).
//   - The "Solicitation Number" search field filters the same capped table to
//     an exact match, so searching for any number found in the PDF export
//     reliably surfaces that one row for clicking, regardless of the 25-row
//     cap or the row's position in the full list.
//
// Transport: Browserbase, via the same connection path as drivers/planetbids.js
// (see lib/browserbase.js). A local-Playwright validation attempt was blocked
// by Metro's WAF (headless Chromium specifically, not plain HTTP) — the same
// signature that caused PlanetBids to require Browserbase in the first place.
// This driver intentionally has NO local-chromium fallback, matching
// planetbids.js: it requires BROWSERBASE_API_KEY/BROWSERBASE_PROJECT_ID and
// fails cleanly if they are not configured, rather than silently degrading to
// a transport known to get blocked.
//
// Driver shape: (1) download+parse the PDF export for the full enumeration of
// {number, title, type, dueDateRaw, issueDateRaw, status}, then (2) for each
// number, search -> click -> extract the ADF detail form -> "Back to
// Solicitations List" -> repeat.
//
// Explicitly out of scope: document acquisition (Oracle iSupplier vendor
// registration requires manual agency approval), Oracle SSO, OCR.

const { connectBrowserbaseSession, fetchBrowserbaseDownloadZip } = require('../lib/browserbase');

const DEFAULT_LISTING_URL = 'https://business.metro.net/webcenter/portal/VendorPortal/pages_home/solicitations/openSolicitations';

const NUMBER_TOKEN = /^[A-Z]{1,3}\d{4,}(?:\(\d+\))?$/;
const TYPE_TOKEN = /\b(IFB|RFP|RFQ)\b/;
const TYPE_TOKEN_ALL = /\b(IFB|RFP|RFQ)\b/g;
const DATE_TIME_TOKEN = /(\d{2}-[A-Za-z]{3}-\d{4}),\s*(\d{2}:\d{2}:\d{2})/;
const DATE_ONLY_TOKEN = /\b(\d{2}-[A-Za-z]{3}-\d{4})\b/g;
const STATUS_TOKEN = /\b(Active|Closed|Awarded|Cancelled)\b/;

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

function collapseWs(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

// Minutes to add to a UTC instant to get America/Los_Angeles wall-clock time.
// Shared Pacific-time helper pattern (also used by bidbox-worker/drivers/lacounty_dpw.js).
function laOffsetMinutes(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
  const hour = p.hour === '24' ? 0 : Number(p.hour);
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return (asIfUtc - utcMs) / 60000;
}

function laWallClockToUtcISO(y, mo, d, h, mi, s) {
  const guessUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = laOffsetMinutes(guessUtc);
  return new Date(guessUtc - offset * 60000).toISOString();
}

// Metro dates: "22-Jul-2026, 14:00:00" (date+time) or "11-May-2026" (date only).
// When no time is present, noon Pacific is used as a neutral sortable placeholder
// (same convention as caltrans.js / lacounty_dpw.js); the raw value is always
// preserved upstream in crawl_data.
function parseMetroDate(raw) {
  if (!raw) return { iso: null, hadTime: false, sentinel: null };
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return { iso: null, hadTime: false, sentinel: s || null };
  const mo = MONTHS[m[2]];
  if (!mo) return { iso: null, hadTime: false, sentinel: s || null };
  const hadTime = m[4] != null;
  const h = hadTime ? Number(m[4]) : 12;
  const mi = hadTime ? Number(m[5]) : 0;
  const se = hadTime && m[6] ? Number(m[6]) : 0;
  return { iso: laWallClockToUtcISO(Number(m[3]), mo, Number(m[1]), h, mi, se), hadTime, sentinel: null };
}

// ── Listing PDF parsing ──────────────────────────────────────────────────────

async function loadPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function extractPdfText(bytes) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  const pdf = await loadingTask.promise;
  const parts = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent({ includeMarkedContent: false });
        for (const item of textContent.items ?? []) {
          if (typeof item.str !== 'string') continue;
          parts.push(item.str);
          parts.push(item.hasEOL ? '\n' : ' ');
        }
      } finally {
        page.cleanup();
      }
    }
  } finally {
    if (typeof pdf.cleanup === 'function') await Promise.resolve(pdf.cleanup()).catch(() => {});
    if (typeof pdf.destroy === 'function') await Promise.resolve(pdf.destroy()).catch(() => {});
  }
  return parts.join('');
}

// The export wraps long titles across multiple lines with Type/Due Date/Issue
// Date/Status appended after the (possibly multi-line) title, all before the
// next row's Number token. Accumulate lines into blocks split at each new
// Number token, then regex-extract fields out of the accumulated block —
// tolerant of exactly which physical line a token lands on (mirrors the
// existing caltrans.js "blob of rendered text -> regex fields" approach).
function parseListingPdfText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    const firstWord = line.split(/\s+/)[0];
    if (NUMBER_TOKEN.test(firstWord)) {
      if (current) blocks.push(current);
      current = { number: firstWord, raw: line };
    } else if (current) {
      current.raw += ' ' + line;
    }
  }
  if (current) blocks.push(current);

  return blocks.map((b) => {
    const dueMatch = b.raw.match(DATE_TIME_TOKEN);
    const allDates = [...b.raw.matchAll(DATE_ONLY_TOKEN)].map((m) => m[1]);
    const statusMatch = b.raw.match(STATUS_TOKEN);
    const dueDateStr = dueMatch ? dueMatch[1] : null;
    const issueDateStr = allDates.find((d) => d !== dueDateStr) || null;

    // Titles can legitimately contain the words "IFB"/"RFP"/"RFQ" mid-sentence
    // (e.g. "... Compliance RFP. Pre Proposal Meeting info...") — matching the
    // first IFB|RFP|RFQ occurrence in the row would cut the title short there
    // instead of at the real Type column. The row's actual column order is
    // always Title -> Type -> Due Date, so the real Type value is the LAST
    // IFB|RFP|RFQ match that appears before the due-date token, not the first
    // one anywhere in the row.
    const typeMatches = [...b.raw.matchAll(TYPE_TOKEN_ALL)];
    const typeMatch = dueMatch
      ? [...typeMatches].reverse().find((m) => m.index < dueMatch.index) ?? null
      : typeMatches[typeMatches.length - 1] ?? null;

    const titleEnd = typeMatch ? typeMatch.index : b.raw.length;
    const title = collapseWs(b.raw.slice(b.number.length, titleEnd)) || null;

    return {
      number: b.number,
      title,
      type: typeMatch ? typeMatch[1] : null,
      dueDateRaw: dueMatch ? `${dueMatch[1]}, ${dueMatch[2]}` : null,
      issueDateRaw: issueDateStr,
      status: statusMatch ? statusMatch[1] : null,
    };
  }).filter((row) => NUMBER_TOKEN.test(row.number));
}

// ── Detail form extraction ───────────────────────────────────────────────────

// The ADF detail view renders each field as a label/value <td> pair:
//   <td class="af_panelLabelAndMessage_label ...">LABEL</td>
//   <td class="... af_panelLabelAndMessage_content-cell">VALUE</td>
// followed by a hidden duplicate editable-widget mirror of the same field
// further down the DOM. Taking the first occurrence per label (document
// order) always picks the real display value, not the hidden mirror.
async function extractDetailFields(page) {
  return page.evaluate(() => {
    const fields = {};
    document.querySelectorAll('td.af_panelLabelAndMessage_label').forEach((labelCell) => {
      const key = labelCell.textContent.trim();
      if (!key || key in fields) return;
      let sib = labelCell.nextElementSibling;
      while (sib && sib.tagName !== 'TD') sib = sib.nextElementSibling;
      fields[key] = sib ? sib.textContent.trim() || null : null;
    });
    return fields;
  });
}

function pickField(fields, aliases) {
  for (const alias of aliases) {
    const value = fields[alias];
    if (value != null && value !== '') return value;
  }
  return null;
}

// ── Candidate assembly ────────────────────────────────────────────────────────

// No stable per-item URL exists (see header comment), so source_url is a
// deterministic synthetic key built from the listing URL + solicitation
// number. It is not navigable, but it is stable across scans, which is all
// persistScannedCandidate's upsert-by-source_url idempotency requires.
function buildSourceUrl(listingUrl, number) {
  return `${listingUrl}#solicitation=${encodeURIComponent(number)}`;
}

function buildCandidate(listingUrl, row) {
  const due = parseMetroDate(row.dueDateRaw);
  return {
    source_url: buildSourceUrl(listingUrl, row.number),
    raw_title: row.title ? `${row.number} - ${row.title}` : row.number,
    bid_due_at: due.iso,
    county: 'Los Angeles',
    portal_bid_id: row.number,
    estimated_value: null,
    estimated_value_low: null,
    estimated_value_high: null,
    project_address: null,
    required_licenses: null,
    required_naics: null,
    portal_department: null,
    crawl_data: {
      source: 'lacmta_open_solicitations',
      listing_url: listingUrl,
      solicitation_number: row.number,
      solicitation_type: row.type,
      listing_title: row.title,
      listing_status: row.status,
      due_date_raw: row.dueDateRaw,
      due_date_time_available: due.hadTime,
      due_date_note: due.iso ? null : (due.sentinel || 'no parseable date'),
      issue_date_raw: row.issueDateRaw,
      extracted_at: new Date().toISOString(),
      extraction_method: 'lacmta_v1_listing_only',
      document_acquisition_supported: false,
    },
  };
}

function applyDetailFields(candidate, fields) {
  const description = pickField(fields, ['Description']);
  const type = pickField(fields, ['Type']);
  const setAsideProgram = pickField(fields, ['Set Aside Program']);
  const naics = pickField(fields, ['NAICS Code(s)']);
  const additionalInfo = pickField(fields, ['Aditional Information', 'Additional Information']);
  const issueDateRaw = pickField(fields, ['Issue Date']);
  const dueDateRaw = pickField(fields, ['Due Date and Time']);
  const preBidDateRaw = pickField(fields, ['Pre-Bid/Proposal Conference Date and Time']);
  const preBidLocation = pickField(fields, ['Pre-Bid/Proposal Conference Location']);
  const forecastedAwardDateRaw = pickField(fields, ['Forecasted Award Date']);
  const contractAdministrator = pickField(fields, ['Contract Administrator']);
  const phone = pickField(fields, ['Phone No.', 'Phone']);
  const fax = pickField(fields, ['Fax']);
  const email = pickField(fields, ['Email']);

  const due = parseMetroDate(dueDateRaw ?? candidate.crawl_data.due_date_raw);

  candidate.bid_due_at = due.iso ?? candidate.bid_due_at;
  candidate.crawl_data = {
    ...candidate.crawl_data,
    detail_fields: fields,
    description,
    solicitation_type: type ?? candidate.crawl_data.solicitation_type,
    set_aside_program: setAsideProgram,
    naics_codes: naics,
    additional_information: additionalInfo,
    issue_date_raw: issueDateRaw ?? candidate.crawl_data.issue_date_raw,
    due_date_raw: dueDateRaw ?? candidate.crawl_data.due_date_raw,
    due_date_time_available: due.hadTime,
    due_date_note: due.iso ? null : (due.sentinel || 'no parseable date'),
    pre_bid_conference_date_raw: preBidDateRaw,
    pre_bid_conference_location: preBidLocation,
    forecasted_award_date_raw: forecastedAwardDateRaw,
    contract_administrator: contractAdministrator,
    contact_phone: phone,
    contact_fax: fax,
    contact_email: email,
    extraction_method: 'lacmta_v1_detail',
  };
  if (description) candidate.crawl_data.scope = description;
  return candidate;
}

// ── Playwright orchestration (Browserbase transport) ─────────────────────────

async function downloadListingRows(page, listingUrl, sessionId, log) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('a[href="#"]', { timeout: 45000 });
  await page.waitForTimeout(1000);

  const downloadButton = page.getByRole('button', { name: 'Download into PDF', exact: true });
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    downloadButton.click(),
  ]);
  const failure = await download.failure();
  if (failure) {
    throw new Error(`PDF download failed: ${failure}`);
  }
  // Neither download.path() nor download.createReadStream() work over a
  // remote Browserbase CDP connection: both rely on local filesystem access
  // to the browser process, which doesn't exist remotely. Confirmed live —
  // createReadStream() silently returned zero bytes rather than throwing.
  // connectBrowserbaseSession() already enabled Browserbase's download sync
  // via Browser.setDownloadBehavior; retrieve the synced file through
  // Browserbase's own session downloads endpoint instead.
  const bytes = await fetchBrowserbaseDownloadZip(sessionId, log);
  const text = await extractPdfText(bytes);
  const rows = parseListingPdfText(text);
  log(`Listing PDF export parsed rows: ${rows.length}`);
  return rows;
}

async function fetchDetailForRow(page, row) {
  const numberBox = page.getByRole('textbox', { name: 'Solicitation Number', exact: true });
  await numberBox.fill('');
  await numberBox.fill(row.number);
  // exact: true is required — the page also has a "Collapse Search" toggle
  // link with role="button", and Playwright's default substring matching on
  // accessible name matches both, causing a strict-mode ambiguity error
  // (confirmed live).
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const resultLink = page.locator('a[href="#"]', { hasText: row.number }).first();
  await resultLink.waitFor({ state: 'visible', timeout: 20000 });
  await resultLink.click();

  await page.getByText('Back to Solicitations List', { exact: true }).waitFor({ timeout: 20000 });
  const fields = await extractDetailFields(page);

  await page.getByText('Back to Solicitations List', { exact: true }).click();
  await page.waitForTimeout(300);

  return fields;
}

async function scrapeLacmta(source, log = console.log) {
  const listingUrl = source.listing_url || DEFAULT_LISTING_URL;
  const candidates = [];
  const errorMessages = [];
  const recordError = (message) => {
    errorMessages.push(message);
    log(`[${source.source_name}] ${message}`);
  };

  let browser;
  try {
    log(`[${source.source_name}] Opening LA Metro Open Solicitations via Browserbase: ${listingUrl}`);
    const session = await connectBrowserbaseSession((msg) => log(`[${source.source_name}] ${msg}`));
    browser = session.browser;
    const page = session.page;
    await page.setViewportSize({ width: 1440, height: 1000 });

    const rows = await downloadListingRows(page, listingUrl, session.sessionId, (msg) => log(`[${source.source_name}] ${msg}`));
    if (rows.length === 0) {
      recordError('LA Metro listing export parsed 0 rows — export format may have changed');
    }

    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.number)) continue;
      seen.add(row.number);

      const candidate = buildCandidate(listingUrl, row);
      try {
        const fields = await fetchDetailForRow(page, row);
        applyDetailFields(candidate, fields);
        log(`[${source.source_name}] Parsed solicitation ${row.number}: ${row.title ?? ''}`);
      } catch (e) {
        candidate.crawl_data.detail_error = e.message;
        recordError(`Detail extraction failed for ${row.number}: ${e.message}`);
      }
      candidates.push(candidate);

      // Small politeness delay between per-item search/click round trips.
      await page.waitForTimeout(150);
    }
  } catch (e) {
    recordError(`LA Metro scrape failed: ${e.message}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  return { candidates, errors: errorMessages.length, errorMessages };
}

module.exports = {
  DEFAULT_LISTING_URL,
  scrapeLacmta,
  // exported for testing
  parseListingPdfText,
  parseMetroDate,
  extractDetailFields,
  applyDetailFields,
  buildCandidate,
  buildSourceUrl,
};
