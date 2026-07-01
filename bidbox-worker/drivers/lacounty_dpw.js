// LA County DPW scan driver — Milestone 1 (metadata ingestion), first Agency Direct driver.
//
// HTTP-first and unauthenticated: the DPW portal (dpw.lacounty.gov) is a
// server-rendered ASP.NET WebForms site with a DataTables-enhanced listing and
// flat detail pages. No browser automation is required for metadata (document
// acquisition, which IS gated behind SSO, is Milestone 2 and lives elsewhere).
//
// Built incrementally (Task 5): Step 1 = listing → rows. Later steps add detail
// extraction, the template registry, and OML normalization.

const cheerio = require('cheerio');

const DEFAULT_LISTING_URL = 'https://dpw.lacounty.gov/contracts/Opportunities.aspx';
// Detail hrefs in the listing are relative to /contracts/ (e.g.
// "cons/ProjectDetailAdv.aspx?project_id=RDC0015913"). Always resolve against
// this base and follow the href — never reconstruct a detail URL from the ID.
const CONTRACTS_BASE = 'https://dpw.lacounty.gov/contracts/';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 2;

function collapseWs(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

// Fetch a page as HTML with a realistic User-Agent (Imperva passes clean
// requests with a real UA), a hard timeout, and a small bounded retry for
// transient network / 5xx failures.
async function fetchHtml(url, log = console.log) {
  let lastError;
  for (let attempt = 1; attempt <= FETCH_RETRIES + 1; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      lastError = e;
      if (attempt <= FETCH_RETRIES) {
        const delayMs = 500 * attempt;
        log(`[lacounty_dpw] fetch failed (attempt ${attempt}): ${e.message} — retrying in ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function extractProjectId(detailUrl) {
  const match = detailUrl.match(/[?&]project_id=([^&]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

// Parse the server-rendered Opportunities.aspx table (#contract_table). Every
// active opportunity is a <tbody> row already present in the initial HTML;
// DataTables only paginates client-side, so no network pagination is needed.
// Each row: td[0] hidden full name, td[1] {div.scope description, detail <a>,
// div.bidexpress flag}, td[2] open date, td[3] close date.
function parseListingRows(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('#contract_table tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    const nameCell = cells.eq(1);
    const anchor = nameCell.find('a[href]').first();
    const href = anchor.attr('href');
    if (!href) return;

    const detailUrl = new URL(href, CONTRACTS_BASE).toString();
    rows.push({
      detailUrl,
      listingHref: href,
      rawTitle: collapseWs(anchor.text()),
      projectId: extractProjectId(detailUrl),
      description: collapseWs(nameCell.find('div.scope').first().text()) || null,
      openDateRaw: collapseWs(cells.eq(2).text()) || null,
      closeDateRaw: collapseWs(cells.eq(3).text()) || null,
      bidExpress: collapseWs(nameCell.find('div.bidexpress').text()).length > 0,
    });
  });
  return rows;
}

// Step 1: a lightweight candidate built from listing data only. bid_due_at and
// the full OML fields are resolved from the detail page in later steps; raw
// values are preserved in crawl_data so nothing observed is lost.
function buildListingCandidate(row, listingUrl) {
  return {
    source_url: row.detailUrl,
    raw_title: row.rawTitle,
    bid_due_at: null,
    county: 'Los Angeles',
    portal_bid_id: row.projectId,
    crawl_data: {
      source: 'lacounty_dpw_listing',
      listing_url: listingUrl,
      project_id: row.projectId,
      listing_name: row.rawTitle,
      description: row.description,
      open_date_raw: row.openDateRaw,
      close_date_raw: row.closeDateRaw,
      detail_path: row.listingHref,
      bid_express: row.bidExpress,
      extraction_method: 'lacounty_dpw_v1_listing_only',
      extracted_at: new Date().toISOString(),
      document_acquisition_supported: false,
    },
  };
}

async function scrapeLaCountyDpw(source, log = console.log) {
  const listingUrl = source.listing_url || DEFAULT_LISTING_URL;
  const candidates = [];
  const errorMessages = [];
  const recordError = (message) => {
    errorMessages.push(message);
    log(`[${source.source_name}] ${message}`);
  };

  try {
    log(`[${source.source_name}] Opening LA County DPW listing: ${listingUrl}`);
    const html = await fetchHtml(listingUrl, log);
    const rows = parseListingRows(html);
    log(`[${source.source_name}] LA County DPW listing rows: ${rows.length}`);

    // Fail loudly: a 200 that parses to zero rows means the listing structure
    // changed, not that there are no opportunities.
    if (rows.length === 0) {
      recordError('LA County DPW listing parsed 0 rows — listing structure may have changed');
    }

    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.detailUrl)) continue;
      seen.add(row.detailUrl);
      candidates.push(buildListingCandidate(row, listingUrl));
      log(`[${source.source_name}] Parsed listing opportunity ${row.projectId}: ${row.rawTitle}`);
    }
  } catch (e) {
    recordError(`LA County DPW listing scrape failed: ${e.message}`);
  }

  return { candidates, errors: errorMessages.length, errorMessages };
}

module.exports = {
  scrapeLaCountyDpw,
  // exported for validation/testing
  parseListingRows,
  fetchHtml,
  DEFAULT_LISTING_URL,
  CONTRACTS_BASE,
};
