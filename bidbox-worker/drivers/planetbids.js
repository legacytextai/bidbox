const { chromium } = require('playwright');
const { createBrowserbaseSessionId } = require('../lib/browserbase');
const { extractExactApiMetadata } = require('../lib/planetbids-recovery');
const { parseBidDueDate } = require('../lib/planetbids-date');
const { createPlanetBidsHydrationDiagnostics } = require('../lib/planetbids-hydration-diagnostics');

function extractBidId(url) {
  const m = url.match(/\/bo-detail\/(\d+)/);
  return m ? m[1] : null;
}

function extractPortalId(url) {
  const m = String(url ?? '').match(/\/portal\/(\d+)/);
  return m ? m[1] : null;
}

function buildPlanetBidsDetailUrl(portalId, bidId) {
  if (!portalId || !bidId) return null;
  return `https://vendors.planetbids.com/portal/${portalId}/bo/bo-detail/${bidId}`;
}

function parseMoneyToken(token) {
  if (!token) return null;
  const cleaned = token.replace(/\s+/g, ' ').trim();
  const hasDollar = cleaned.includes('$');
  const hasComma = cleaned.includes(',');
  const unitMatch = cleaned.match(/([KMB])\b|\b(thousand|million|billion)\b/i);
  const numberMatch = cleaned.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const n = parseFloat(numberMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = (unitMatch?.[1] ?? unitMatch?.[2] ?? '').toLowerCase();
  let value = n;
  if (unit === 'b' || unit === 'billion') value = n * 1_000_000_000;
  if (unit === 'm' || unit === 'million') value = n * 1_000_000;
  if (unit === 'k' || unit === 'thousand') value = n * 1_000;

  // Avoid treating small unlabeled counts, years, or bid numbers as estimates.
  if (!hasDollar && !hasComma && !unit && value < 10000) return null;
  return Math.round(value);
}

function parseEstimatedValueDetails(raw) {
  if (!raw) {
    return {
      estimated_value: null,
      estimated_value_raw: null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const text = String(raw).replace(/\s+/g, ' ').trim();
  const moneyPattern = /(?:\$+\s*)?\d[\d,]*(?:\.\d+)?\s*(?:[KkMmBb]|thousand|million|billion)?/g;
  const values = [...text.matchAll(moneyPattern)]
    .map((m) => ({ raw: m[0].trim(), value: parseMoneyToken(m[0]) }))
    .filter((m) => m.value !== null);

  if (values.length === 0) {
    return {
      estimated_value: null,
      estimated_value_raw: text || null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const first = values[0].value;
  const second = values[1]?.value ?? null;
  if (second !== null && /(?:-|–|—|\bto\b|\band\b|\bbetween\b)/i.test(text)) {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return {
      estimated_value: Math.round((low + high) / 2),
      estimated_value_raw: text,
      estimated_value_low: low,
      estimated_value_high: high,
    };
  }

  return {
    estimated_value: first,
    estimated_value_raw: text,
    estimated_value_low: null,
    estimated_value_high: null,
  };
}

function parseEstimatedValue(raw) {
  return parseEstimatedValueDetails(raw).estimated_value;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstPresent(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function parseBooleanSignal(value) {
  if (value === true || value === false) return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (/\b(optional|not required|not mandatory|no|false)\b/.test(text)) return false;
  if (/\b(mandatory|required|yes|true|must|required attendance|attendance required)\b/.test(text)) return true;
  return null;
}

function normalizeJobWalkMetadata(raw) {
  const dateTime = firstPresent(raw.section_scoped_job_walk_at, raw.job_walk_at, raw.pre_bid_meeting_at);
  const details = firstPresent(raw.section_scoped_job_walk_details, raw.job_walk_details);
  const attendanceRequired = firstPresent(raw.section_scoped_attendance_required, raw.attendance_required);
  const location = firstPresent(raw.job_walk_location, raw.pre_bid_meeting_location);
  const link = firstPresent(raw.meeting_link);
  const additionalDetails = firstPresent(raw.additional_details);
  const preBidExists = parseBooleanSignal(raw.pre_bid_meeting) ?? Boolean(dateTime || details || attendanceRequired || location || link || additionalDetails);
  const mandatory = parseBooleanSignal(attendanceRequired) ?? parseBooleanSignal(details);
  const exists = Boolean(preBidExists || dateTime || details || attendanceRequired || location || link || additionalDetails);

  return {
    pre_bid_exists: preBidExists ?? null,
    meeting_datetime: dateTime ?? null,
    meeting_location: location ?? null,
    meeting_link: link ?? null,
    additional_details: additionalDetails ?? null,
    pre_bid_location: location ?? null,
    pre_bid_meeting_link: link ?? null,
    pre_bid_notes: additionalDetails ?? null,
    job_walk_exists: exists || null,
    job_walk_mandatory: mandatory,
    job_walk_at: dateTime ?? null,
    pre_bid_meeting_at: firstPresent(raw.pre_bid_meeting_at, dateTime),
    job_walk_details: [details, additionalDetails, location ? `Location: ${location}` : null].filter(Boolean).join(' | ') || null,
    job_walk_location: location ?? null,
    attendance_required: attendanceRequired ?? null,
    pre_bid_meeting: raw.pre_bid_meeting || preBidExists || null,
  };
}

// Any 2xx from the PlanetBids API host. Used for telemetry counting and to feed
// detail-URL extraction — never as proof that listings rendered. The Ember shell
// fires /papi/t, /papi/server-time, /papi/oauth/refresh and several lookups
// (/papi/bid-types, /papi/departments, …) long before /papi/bids returns, so
// "an API responded" says nothing about whether the bid table exists yet.
function isPlanetBidsApiResponse(res) {
  return res.url().includes('api-external.prod.planetbids.com') && res.status() >= 200 && res.status() < 300;
}

// The bid-listing payload itself. Telemetry only: a listing can paint from cache
// without a fresh response, so this must never be a prerequisite for readiness.
function isPlanetBidsListingResponseUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.hostname === 'api-external.prod.planetbids.com'
      && /^\/papi\/bids\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Boot beacons that must never imply listing readiness. `/papi/t` is a telemetry
// ping and `/papi/server-time` a clock read; both resolve within ~1s of navigation.
function isPlanetBidsClockOrBeaconUrl(url) {
  try {
    const parsed = new URL(String(url));
    return /^\/papi\/(server-time|t)\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function createBiddingRowsLocator(page) {
  return page
    .locator([
      'table tbody tr',
      'table tr',
      '[role="table"] [role="row"]',
      '[role="grid"] [role="row"]',
      '[class*="result" i] [class*="row" i]',
      '[class*="bid" i][class*="row" i]',
      '[class*="opportunit" i][class*="row" i]',
    ].join(', '))
    .filter({ hasText: /\bBidding\b/i })
    .filter({ hasText: /(?:Bid|RFI|RFP|RFQ|RFQual|IPWB|Posted|Project|Invitation|Due Date|Remaining)/i });
}

async function waitForDocumentReady(page, timeout = 30000) {
  return page.waitForFunction(
    () => ['interactive', 'complete'].includes(document.readyState),
    { timeout }
  ).then(() => true).catch(() => false);
}

async function waitForPlanetBidsDetailNavigation(page, timeout = 25000) {
  try {
    // PlanetBids detail pages can keep subresources open long after the route
    // and DOM are usable. Requiring the default `load` state turns a successful
    // click into a timeout and leaves the scan stranded on the detail route.
    await page.waitForURL('**/bo-detail/**', { waitUntil: 'domcontentloaded', timeout });
  } catch (error) {
    // If the route changed successfully, detail readiness below is the
    // authoritative content check. Only rethrow when navigation never landed.
    if (!/\/bo-detail\/\d+/.test(page.url())) throw error;
  }
}

async function openPlanetBidsRowWithRetry({ rows, index, reloadListing, page, log = () => {}, attempts = 2 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const currentRows = rows();
    if (index >= await currentRows.count()) return false;
    try {
      await currentRows.nth(index).click();
      await waitForPlanetBidsDetailNavigation(page);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      log(`Row ${index + 1} navigation missed (attempt ${attempt}/${attempts}) — reloading listing and retrying once`);
      await reloadListing();
    }
  }
  throw lastError;
}

async function waitForDetailReadiness(page, targetBidId, apiMetadataByBidId, timeout = Number(process.env.PLANETBIDS_SCAN_DETAIL_TIMEOUT_MS ?? 15000)) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const api = apiMetadataByBidId.get(String(targetBidId));
    if (api?.raw_title) return { outcome: 'detail_api', api, duration_ms: Date.now() - started };
    const state = await page.evaluate(() => {
      const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
      return {
        body_chars: body.length,
        detail_root: Boolean(document.querySelector('#bo-detail-content, [data-test*="bo-detail" i], [class*="bo-detail" i], [class*="bid-detail" i]')),
        terminal_error: /something went wrong|service unavailable|project (?:is )?unavailable|not found|session expired/i.test(body),
      };
    }).catch((error) => {
      throw error;
    });
    if (state.terminal_error) return { outcome: 'portal_error_page', duration_ms: Date.now() - started };
    if (state.detail_root && state.body_chars > 40) return { outcome: 'rendered_page', duration_ms: Date.now() - started };
    await page.waitForTimeout(500);
  }
  return { outcome: 'detail_timeout', duration_ms: Date.now() - started };
}

function parseFoundBidsCount(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!/^\d+$/.test(text)) return null;
  return Number.parseInt(text, 10);
}

// Bounded budget for the bid table to paint after navigation. PlanetBids' Ember
// shell resolves its boot requests within ~1s but paints the table later; 15s
// covers observed production render times with headroom while staying far inside
// the 10-minute scrape guard. Overridable for slow portals without a redeploy.
const PLANETBIDS_LISTING_WAIT_MS = Number(process.env.PLANETBIDS_LISTING_WAIT_MS) > 0
  ? Number(process.env.PLANETBIDS_LISTING_WAIT_MS)
  : 15000;
const PLANETBIDS_LISTING_POLL_MS = 250;

const PLANETBIDS_NO_RESULTS_RE = /no\s+(open\s+)?(bid|opportunit|record)|no\s+data|nothing\s+found/i;

// PlanetBids serves decommissioned/unknown portal ids as a /2001 interstitial.
// Terminal: a source-configuration problem, never a hydration timeout.
function detectPlanetBidsInvalidPortal(url, bodyText) {
  return /^https?:\/\/vendors\.planetbids\.com\/2001(?:[/?#]|$)/i.test(String(url ?? ''))
    || /not a valid PlanetBids agency portal/i.test(String(bodyText ?? ''));
}

function addPlanetBidsDetailUrl(urls, portalId, bidId) {
  const normalized = String(bidId ?? '').trim();
  if (!/^\d{4,9}$/.test(normalized)) return;
  const url = buildPlanetBidsDetailUrl(portalId, normalized);
  if (url) urls.add(url);
}

function valueHasBidSignals(value) {
  const text = String(value ?? '').toLowerCase();
  return /\b(bid|bidding|opportunit|project|solicitation|invitation|closing|due|remaining|stage|status|title)\b/.test(text);
}

function objectHasBidSignals(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  const keySignal = keys.some(valueHasBidSignals);
  const typeSignal = valueHasBidSignals(obj.type);
  const attrSignal = obj.attributes && typeof obj.attributes === 'object'
    ? Object.keys(obj.attributes).some(valueHasBidSignals)
    : false;
  const valueSignal = [
    obj.title,
    obj.name,
    obj.bidTitle,
    obj.bid_title,
    obj.projectTitle,
    obj.project_title,
    obj.invitationNumber,
    obj.invitation_number,
    obj.stage,
    obj.status,
  ].some(valueHasBidSignals);
  return keySignal || typeSignal || attrSignal || valueSignal;
}

function responseUrlHasBidListingSignals(responseUrl) {
  try {
    const parsed = new URL(responseUrl);
    const haystack = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    if (/\b(download|downloadable|file|document|attachment|line-item|oauth|token|vendor|profile|company|notification)\b/.test(haystack)) {
      return false;
    }
    return /\b(bid|bids|bidding|opportunit|solicitation|bo-search|event)\b/.test(haystack);
  } catch {
    return false;
  }
}

function collectPlanetBidsApiDetailUrls(json, portalId, responseUrl = '') {
  const urls = new Set();
  if (!portalId || json === null || json === undefined) return [];

  const responseLooksBidRelated = responseUrlHasBidListingSignals(responseUrl);
  const seen = new Set();

  const collectFromRoute = (value) => {
    const text = String(value ?? '');
    const matches = text.matchAll(
      /(?:https?:\/\/vendors\.planetbids\.com)?\/portal\/\d+\/bo\/bo-detail\/\d+|\/bo\/bo-detail\/\d+|\/bo-detail\/\d+/gi
    );
    for (const match of matches) {
      const bidId = extractBidId(match[0]);
      if (bidId) addPlanetBidsDetailUrl(urls, portalId, bidId);
    }
  };

  const collectIdCandidates = (obj, likelyBidObject, allowGenericId) => {
    if (!likelyBidObject) return;
    const attrs = obj.attributes && typeof obj.attributes === 'object' ? obj.attributes : {};
    const candidates = [
      obj.bid_id,
      obj.bidId,
      obj.bidID,
      obj.bid_id_fk,
      obj.bidNumberId,
      obj.bo_id,
      obj.boId,
      attrs.bid_id,
      attrs.bidId,
      attrs.bidID,
      attrs.bid_id_fk,
      attrs.bidNumberId,
      attrs.bo_id,
      attrs.boId,
    ];
    for (const candidate of candidates) {
      addPlanetBidsDetailUrl(urls, portalId, candidate);
    }
    if (allowGenericId) addPlanetBidsDetailUrl(urls, portalId, obj.id);
  };

  const walk = (value, path = '') => {
    if (value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      collectFromRoute(value);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}.${index}`));
      return;
    }

    const bidShapedObject = objectHasBidSignals(value);
    const likelyBidObject =
      bidShapedObject ||
      responseLooksBidRelated ||
      /\b(data|bids?|opportunit(?:y|ies)|solicitations?|results?|rows?)\b/i.test(path);
    const allowGenericId =
      bidShapedObject ||
      /\b(bids?|opportunit(?:y|ies)|solicitations?|results?|rows?)\b/i.test(path);
    collectIdCandidates(value, likelyBidObject, allowGenericId);

    for (const [key, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${key}` : key;
      if (typeof child === 'string' || typeof child === 'number') {
        if (valueHasBidSignals(key)) addPlanetBidsDetailUrl(urls, portalId, child);
        collectFromRoute(child);
      } else {
        walk(child, childPath);
      }
    }
  };

  walk(json);
  return [...urls];
}

async function extractBidDetailUrlsFromPage(page, baseUrl) {
  return page.evaluate((base) => {
    const urls = new Set();
    const baseParsed = new URL(base);
    const portalId = baseParsed.pathname.match(/\/portal\/(\d+)/)?.[1] ?? null;
    const portalPrefix = portalId ? `/portal/${portalId}` : '';

    const addBidId = (rawValue) => {
      if (!portalId) return;
      const value = String(rawValue ?? '').trim();
      if (!/^\d{4,9}$/.test(value)) return;
      urls.add(`https://vendors.planetbids.com/portal/${portalId}/bo/bo-detail/${value}`);
    };

    const addUrl = (rawValue) => {
      let value = String(rawValue ?? '').trim();
      if (!value) return;

      const routeMatch = value.match(
        /(?:https?:\/\/vendors\.planetbids\.com)?\/portal\/\d+\/bo\/bo-detail\/\d+|\/bo\/bo-detail\/\d+|\/bo-detail\/\d+/i
      );
      if (routeMatch) value = routeMatch[0];
      if (/^\/bo-detail\/\d+/i.test(value) && portalPrefix) value = `${portalPrefix}/bo${value}`;
      if (/^\/bo\/bo-detail\/\d+/i.test(value) && portalPrefix) value = `${portalPrefix}${value}`;

      try {
        const url = new URL(value, base);
        if (url.hostname !== 'vendors.planetbids.com') return;
        if (!/\/portal\/\d+\/bo\/bo-detail\/\d+$/i.test(url.pathname)) return;
        urls.add(url.href.split('#')[0]);
      } catch {
        // Ignore malformed attributes from the Ember shell.
      }
    };

    document
      .querySelectorAll('a[href], [href], [data-href], [onclick], [data-bid-id], [data-bidid]')
      .forEach((el) => {
        addUrl(el.getAttribute('href'));
        addUrl(el.getAttribute('data-href'));
        addUrl(el.getAttribute('onclick'));
        addBidId(el.getAttribute('data-bid-id'));
        addBidId(el.getAttribute('data-bidid'));
        for (const attr of el.attributes ?? []) {
          addUrl(attr.value);
          if (/\bbid\b/i.test(attr.name)) addBidId(attr.value);
        }
      });

    const html = document.documentElement?.innerHTML ?? '';
    const matches = html.matchAll(
      /(?:https?:\/\/vendors\.planetbids\.com)?\/portal\/\d+\/bo\/bo-detail\/\d+|\/bo\/bo-detail\/\d+|\/bo-detail\/\d+/gi
    );
    for (const match of matches) addUrl(match[0]);

    return [...urls];
  }, baseUrl).catch(() => []);
}

// Single-pass read of the signals that can definitively classify a listing page.
async function probePlanetBidsListingPage(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = clean(document.body?.innerText ?? '');
    return {
      url: location.href,
      body_text: bodyText.substring(0, 1000),
      found_bids_text: bodyText.match(/Found\s+([\d,]+)\s+bids?/i)?.[1] ?? null,
    };
  }).catch(() => ({ url: page.url(), body_text: '', found_bids_text: null }));
}

/**
 * Bounded, DOM-authoritative listing-state wait.
 *
 * The DOM is the only source of truth. Network activity is telemetry only:
 * gating on "some PlanetBids API responded" reads the table before Ember paints
 * it, which is the 2026-07-16 nightly-failure race (see
 * docs/analysis/repeated-planetbids-nightly-failures-bug-report-2026-07-16.md).
 *
 * Resolves as soon as one definitive state holds, so a fast portal costs one poll.
 * Returns { state: 'rows' | 'empty' | 'invalid_portal' | 'timeout', … }.
 */
async function waitForPlanetBidsListingState(page, options = {}) {
  const {
    rows = () => createBiddingRowsLocator(page),
    probe = () => probePlanetBidsListingPage(page),
    timeout = PLANETBIDS_LISTING_WAIT_MS,
    pollMs = PLANETBIDS_LISTING_POLL_MS,
    now = () => Date.now(),
    sleep = (ms) => page.waitForTimeout(ms),
    readinessSignals = {},
  } = options;

  const started = now();
  let foundBidsCount = null;
  let polls = 0;
  let finalUrl = null;

  for (;;) {
    polls++;
    const rowCount = await rows().count().catch(() => 0);
    if (rowCount > 0) {
      return { state: 'rows', rowCount, foundBidsCount, waitMs: now() - started, polls, finalUrl, readinessSignals };
    }

    const observed = await probe();
    finalUrl = observed.url ?? finalUrl;
    foundBidsCount = parseFoundBidsCount(observed.found_bids_text);

    if (detectPlanetBidsInvalidPortal(observed.url, observed.body_text)) {
      return { state: 'invalid_portal', rowCount: 0, foundBidsCount, waitMs: now() - started, polls, finalUrl, readinessSignals };
    }

    // Only affirmative evidence counts as empty. A blank body is a page that has
    // not painted yet — never proof that the portal has no open solicitations.
    if (foundBidsCount === 0 || PLANETBIDS_NO_RESULTS_RE.test(observed.body_text ?? '')) {
      return { state: 'empty', rowCount: 0, foundBidsCount, waitMs: now() - started, polls, finalUrl, readinessSignals };
    }

    if (now() - started >= timeout) {
      return { state: 'timeout', rowCount: 0, foundBidsCount, waitMs: now() - started, polls, finalUrl, readinessSignals };
    }
    await sleep(pollMs);
  }
}

async function gotoListingAndWait(page, listingUrl, sourceName, log, options = {}) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForDocumentReady(page, 30000);
  const state = await waitForPlanetBidsListingState(page, options);
  log(
    `[${sourceName}] Listing state=${state.state} rows=${state.rowCount} ` +
    `found_bids=${state.foundBidsCount ?? 'n/a'} wait=${state.waitMs}ms polls=${state.polls}`
  );
  return state;
}

async function clickSearchIfAvailable(page, sourceName, log) {
  const searchButton = page.getByRole('button', { name: /^search$/i }).first();
  if (!(await searchButton.isVisible({ timeout: 2000 }).catch(() => false))) {
    return false;
  }

  log(`[${sourceName}] No Bidding rows after initial load — clicking Search`);
  await searchButton.click();
  await waitForDocumentReady(page, 30000);
  await page.waitForSelector('body', { state: 'attached', timeout: 5000 }).catch(() => null);
  // Readiness is re-established by the caller's bounded DOM wait; settling on an
  // API response here would reintroduce the boot-beacon race.
  return true;
}

async function captureZeroRowDiagnostics(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = clean(document.body?.innerText ?? '');
    const foundBids = bodyText.match(/Found\s+([\d,]+)\s+bids?/i)?.[1] ?? null;
    const resultContainer = [
      ...document.querySelectorAll(
        'table, [role="table"], [role="grid"], [class*="result" i], [class*="bid" i], [class*="opportunit" i]'
      ),
    ].find((el) => /Posted|Project Title|Invitation|Due Date|Remaining|Stage|Bidding/i.test(el.textContent ?? ''));

    return {
      final_url: location.href,
      tr_count: document.querySelectorAll('tr').length,
      role_row_count: document.querySelectorAll('[role="row"]').length,
      found_bids_text: foundBids,
      body_preview: bodyText.substring(0, 700),
      result_html_preview: resultContainer ? clean(resultContainer.innerHTML).substring(0, 1200) : null,
    };
  }).catch((e) => ({
    final_url: page.url(),
    tr_count: null,
    role_row_count: null,
    found_bids_text: null,
    body_preview: `diagnostic capture failed: ${e.message}`,
    result_html_preview: null,
  }));
}

async function scrapePlanetBids(payload, log) {
  const { source_id, source_name, listing_url, task_id } = payload;
  const candidates = [];
  const errorMessages = [];
  let errors = 0;
  const telemetry = {
    candidates_discovered: 0,
    candidates_fully_extracted: 0,
    extraction_failures: 0,
    portal_errors: 0,
    empty_shells: 0,
    context_deaths: 0,
    retryable_failures: 0,
    terminal_failures: 0,
    recovery_candidates: [],
  };

  const recordError = (message) => {
    const clean = String(message ?? 'Unknown error');
    errorMessages.push(clean);
    log(`[${source_name}] ${clean}`);
  };

  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID ?? '';

  if (!bbApiKey) {
    recordError('BROWSERBASE_API_KEY not configured');
    return { candidates, errors: 1, errorMessages, telemetry };
  }

  let browser = null;
  let hydrationDiagnostics = null;

  // FIX 4: 10-minute outer guard — returns partial results on timeout
  const TIMEOUT_MS = 10 * 60 * 1000;
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Scrape timed out after 10 minutes')),
      TIMEOUT_MS
    );
  });

  try {
    await Promise.race([
      (async () => {
        log(`[${source_name}] Creating Browserbase session`);
        // Centralized create with concurrency gate + 429/503 backoff (see lib/browserbase).
        let sessionId;
        try {
          sessionId = await createBrowserbaseSessionId(bbApiKey, bbProjectId, log);
        } catch (e) {
          recordError(e.message);
          errors++;
          return;
        }
        log(`[${source_name}] Session: ${sessionId}`);

        const wsUrl = `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`;
        browser = await chromium.connectOverCDP(wsUrl);

        const bContext = browser.contexts()[0] ?? (await browser.newContext());
        const page = await bContext.newPage();
        const biddingRows = () => createBiddingRowsLocator(page);

        let bearerToken = null;
        let apiResponsesObserved = 0;
        const portalId = extractPortalId(listing_url);
        hydrationDiagnostics = createPlanetBidsHydrationDiagnostics({
          sourceId: source_id,
          sourceName: source_name,
          taskId: task_id,
          sessionId,
        });
        // Event listeners are attached before the first listing navigation.
        // They observe only; listing readiness remains DOM-authoritative.
        hydrationDiagnostics.attach(page);
        const apiDetailUrls = new Set();
        const apiMetadataByBidId = new Map();
        const apiExtractionTasks = [];
        page.on('request', (req) => {
          hydrationDiagnostics.request(req);
          if (req.url().includes('api-external.prod.planetbids.com')) {
            const auth = req.headers()['authorization'] ?? '';
            if (auth.startsWith('Bearer ')) bearerToken = auth.slice(7);
          }
        });
        // Network observation is telemetry only — it never gates listing readiness.
        const readinessSignals = {
          clock_or_beacon_observed: false,
          listing_endpoint_observed: false,
        };
        page.on('response', (res) => {
          if (isPlanetBidsApiResponse(res)) {
            apiResponsesObserved++;
            const responseUrl = res.url();
            if (isPlanetBidsClockOrBeaconUrl(responseUrl)) readinessSignals.clock_or_beacon_observed = true;
            if (isPlanetBidsListingResponseUrl(responseUrl)) readinessSignals.listing_endpoint_observed = true;
            apiExtractionTasks.push(res.json().then((json) => {
              const urls = collectPlanetBidsApiDetailUrls(json, portalId, responseUrl);
              for (const url of urls) {
                apiDetailUrls.add(url);
                const responseBidId = extractBidId(url);
                if (!responseBidId) continue;
                const exact = extractExactApiMetadata(json, responseBidId, responseUrl, res.status());
                if (exact) apiMetadataByBidId.set(String(responseBidId), exact);
              }
            }).catch(() => {}));
          }
        });

        // Listing readiness is decided by the DOM, never by network activity.
        // One bounded recovery attempt follows a hydration timeout; both attempts
        // re-run the full state wait so a boot beacon cannot short-circuit either.
        const awaitListingState = () => waitForPlanetBidsListingState(page, {
          rows: biddingRows,
          readinessSignals,
        });

        log(`[${source_name}] Loading listing: ${listing_url}`);
        hydrationDiagnostics.begin(1, page, portalId);
        let firstSearchClicked = false;
        let listing = await gotoListingAndWait(page, listing_url, source_name, log, {
          rows: biddingRows,
          readinessSignals,
        });
        if (listing.state === 'timeout' && await clickSearchIfAvailable(page, source_name, log)) {
          firstSearchClicked = true;
          listing = await awaitListingState();
        }

        let listingAttempts = 1;
        if (listing.state === 'timeout') {
          await hydrationDiagnostics.finish(listing, page, { timeout: true, searchClicked: firstSearchClicked });
          log(`[${source_name}] Listing did not reach a definitive state in ${listing.waitMs}ms — one bounded reload before failing`);
          await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
          hydrationDiagnostics.begin(2, page, portalId);
          let secondSearchClicked = false;
          listing = await gotoListingAndWait(page, listing_url, source_name, log, {
            rows: biddingRows,
            readinessSignals,
          });
          if (listing.state === 'timeout' && await clickSearchIfAvailable(page, source_name, log)) {
            secondSearchClicked = true;
            listing = await awaitListingState();
          }
          await hydrationDiagnostics.finish(listing, page, { timeout: listing.state === 'timeout', searchClicked: secondSearchClicked });
          listingAttempts = 2;
        } else {
          await hydrationDiagnostics.finish(listing, page, { timeout: false, searchClicked: firstSearchClicked });
        }

        if (listing.state === 'invalid_portal') {
          telemetry.terminal_failures++;
          recordError(
            `invalid_planetbids_portal: PlanetBids does not recognize this portal id. ` +
            `listing_url=${listing_url}; final_url=${listing.finalUrl}; attempts=${listingAttempts}; ` +
            `wait_ms=${listing.waitMs}. Source configuration must be corrected — retrying will not help.`
          );
          errors++;
          return;
        }

        if (listing.state === 'empty') {
          log(`[${source_name}] No active bidding rows found (found_bids=${listing.foundBidsCount ?? 'no-results text'}, attempts=${listingAttempts})`);
          return;
        }

        let rowCount = listing.state === 'rows' ? listing.rowCount : 0;
        log(`[${source_name}] ${rowCount} Bidding row(s) found`);

        let detailUrlFallbacks = [];
        let extractionMode = 'dom_rows';
        if (rowCount === 0) {
          // Hydration timed out after bounded recovery. Existing detail-link
          // fallbacks still get a chance before the scan reports a failure.
          await Promise.allSettled(apiExtractionTasks);
          const domDetailUrls = await extractBidDetailUrlsFromPage(page, listing_url);
          const apiDerivedDetailUrls = [...apiDetailUrls];
          detailUrlFallbacks = [...new Set([...domDetailUrls, ...apiDerivedDetailUrls])];
          const diagnostics = await captureZeroRowDiagnostics(page);

          if (detailUrlFallbacks.length > 0) {
            extractionMode = 'detail_url_fallback';
            log(
              `[${source_name}] Bidding row locator found 0 rows, but ${detailUrlFallbacks.length} ` +
              `bid detail target(s) were resolved. Falling back to direct detail navigation. ` +
              `dom_detail_links=${domDetailUrls.length}; api_detail_links=${apiDerivedDetailUrls.length}; ` +
              `api_responses=${apiResponsesObserved}; tr_count=${diagnostics.tr_count}; ` +
              `role_row_count=${diagnostics.role_row_count}; found_bids=${diagnostics.found_bids_text ?? 'n/a'}`
            );
          } else {
            // Transient by construction: the portal never reached a definitive
            // state. Never claim listing records existed — nothing was observed.
            telemetry.retryable_failures++;
            recordError(
              `planetbids_listing_hydration_timeout: listings never rendered and no explicit ` +
              `empty state appeared within the bounded wait. final_url=${diagnostics.final_url}; ` +
              `attempts=${listingAttempts}; wait_ms=${listing.waitMs}; polls=${listing.polls}; ` +
              `api_responses=${apiResponsesObserved}; ` +
              `clock_or_beacon_observed=${readinessSignals.clock_or_beacon_observed}; ` +
              `listing_endpoint_observed=${readinessSignals.listing_endpoint_observed}; ` +
              `found_bids=${diagnostics.found_bids_text ?? 'n/a'}; tr_count=${diagnostics.tr_count}; ` +
              `role_row_count=${diagnostics.role_row_count}; no_results_text=false; ` +
              `api_detail_links=${apiDerivedDetailUrls.length}; dom_detail_links=${domDetailUrls.length}; ` +
              `body=${diagnostics.body_preview ? `${diagnostics.body_preview.length} chars` : 'blank'}; ` +
              `session=${sessionId}`
            );
            if (diagnostics.result_html_preview) {
              log(`[${source_name}] Results HTML preview: ${diagnostics.result_html_preview}`);
            }
            errors++;
            return;
          }
        }

        const targetCount = detailUrlFallbacks.length > 0 ? detailUrlFallbacks.length : rowCount;
        telemetry.candidates_discovered = targetCount;

        if (targetCount === 0) {
          const diagnostics = await captureZeroRowDiagnostics(page);
          recordError(
            `No Bidding rows rendered. final_url=${diagnostics.final_url}; ` +
            `api_responses=${apiResponsesObserved}; tr_count=${diagnostics.tr_count}; ` +
            `role_row_count=${diagnostics.role_row_count}; found_bids=${diagnostics.found_bids_text ?? 'n/a'}; ` +
            `Body preview: ${diagnostics.body_preview}`
          );
          if (diagnostics.result_html_preview) {
            log(`[${source_name}] Results HTML preview: ${diagnostics.result_html_preview}`);
          }
          errors++;
          return;
        }

        for (let i = 0; i < targetCount; i++) {
          try {
            if (i > 0 && extractionMode === 'dom_rows') {
              await gotoListingAndWait(page, listing_url, source_name, log);
              await page.waitForTimeout(Math.floor(Math.random() * 1000)); // FIX 4: jitter
            }

            if (extractionMode === 'detail_url_fallback') {
              const fallbackDetailUrl = detailUrlFallbacks[i];
              log(`[${source_name}] Opening fallback detail ${i + 1}/${targetCount}: ${fallbackDetailUrl}`);
              await page.goto(fallbackDetailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await waitForDocumentReady(page, 30000);
              await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
              await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000));
            } else {
              log(`[${source_name}] Clicking row ${i + 1}/${targetCount}`);
              const opened = await openPlanetBidsRowWithRetry({
                rows: biddingRows,
                index: i,
                page,
                log: (message) => log(`[${source_name}] ${message}`),
                reloadListing: async () => {
                  await gotoListingAndWait(page, listing_url, source_name, log);
                  await page.waitForTimeout(500 + Math.floor(Math.random() * 500));
                },
              });
              if (!opened) {
                log(`[${source_name}] Row ${i}: no longer present — skipping`);
                continue;
              }
              await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000)); // FIX 4: jitter
            }

            const detailUrl = page.url();
            const bidId = extractBidId(detailUrl);
            if (!bidId) {
              log(`[${source_name}] Item ${i}: unexpected detail URL: ${detailUrl} — skipping`);
              errors++;
              continue;
            }

            const readiness = await waitForDetailReadiness(page, bidId, apiMetadataByBidId);
            if (readiness.outcome === 'portal_error_page' || readiness.outcome === 'detail_timeout') {
              telemetry.extraction_failures++;
              telemetry.retryable_failures++;
              if (readiness.outcome === 'portal_error_page') telemetry.portal_errors++;
              recordError(`${readiness.outcome}: target_bid_id=${bidId}; url=${detailUrl}; render_wait_ms=${readiness.duration_ms}`);
              telemetry.recovery_candidates.push({ portal_bid_id: bidId, source_url: detailUrl, error_code: readiness.outcome });
              errors++;
              continue;
            }

            // ── DOM INSPECTION (bid 142261 / Polytechnic High School only) ──────────
            // No parsing, no regex. Captured once and persisted to agent_tasks.payload.
            // Remove after DOM structure is confirmed.
            let _domInspection = null;
            if (detailUrl.includes('142261')) {
              _domInspection = await page.evaluate(() => {
                const HEADINGS = [
                  'Pre-Bid Meeting Information',
                  'Job Walk Information',
                  'Job Walk',
                ];
                const results = [];
                for (const heading of HEADINGS) {
                  const allEls = [...document.querySelectorAll('*')];
                  const headingEl = allEls.find((el) => {
                    const direct = [...el.childNodes]
                      .filter((n) => n.nodeType === Node.TEXT_NODE)
                      .map((n) => n.textContent.trim())
                      .join('')
                      .trim();
                    return direct === heading;
                  });
                  if (!headingEl) { results.push({ heading, found: false }); continue; }

                  // First ancestor with > 1 child is the section container.
                  let container = headingEl.parentElement;
                  for (let d = 0; container && container !== document.body && d < 8; d++, container = container.parentElement) {
                    if (container.children.length > 1) break;
                  }

                  const ancestors = [];
                  let cur = headingEl.parentElement;
                  for (let d = 0; cur && cur !== document.body && d < 8; d++, cur = cur.parentElement) {
                    ancestors.push({ depth: d + 1, tag: cur.tagName, className: cur.className, childCount: cur.children.length, textLength: (cur.textContent || '').length });
                  }

                  results.push({
                    heading,
                    found: true,
                    headingEl: { tag: headingEl.tagName, className: headingEl.className, outerHTML: headingEl.outerHTML?.substring(0, 1000) },
                    container: container ? {
                      tag: container.tagName,
                      className: container.className,
                      outerHTML: container.outerHTML?.substring(0, 4000),
                      innerHTML: container.innerHTML?.substring(0, 4000),
                      innerText: container.innerText?.substring(0, 2000),
                      textContent: container.textContent?.substring(0, 2000),
                    } : null,
                    ancestors,
                    children: container
                      ? [...container.children].map((ch) => ({ tag: ch.tagName, className: ch.className, innerText: ch.innerText?.substring(0, 300), childCount: ch.children.length }))
                      : [],
                  });
                }
                return results;
              });
            }
            // ─────────────────────────────────────────────────────────────────────

            const raw = await page.evaluate(() => {
              const bodyText = document.body.innerText;

              const field = (label) => {
                const re = new RegExp(label + '[:\\s]+([^\\n]{1,300})', 'i');
                const m = bodyText.match(re);
                return m ? m[1].trim() || null : null;
              };

              // Parses the "Pre-Bid Meeting Information" section from bodyText.
              // Returns an object of lowercased label → value string pairs when the
              // section is found, or null when the heading is absent from the page.
              // Uses bodyText (document.body.innerText) which preserves newlines,
              // so each field value is cleanly bounded by its own line.
              const extractPreBidMeetingSection = () => {
                const trimLine = (s) => String(s ?? '').trim();

                // Known labels inside the Pre-Bid Meeting Information section.
                const KNOWN_LABELS = [
                  'pre-bid meeting',
                  'meeting type',
                  'date & time',
                  'date/time',
                  'meeting date',
                  'meeting time',
                  'meeting link',
                  'attendance required',
                  'attendance mandatory',
                  'mandatory',
                  'location',
                  'meeting location',
                  'address',
                  'venue',
                  'additional details',
                  'notes',
                ];
                const labelKey = (s) => trimLine(s).toLowerCase().replace(/\s+/g, ' ');
                const labelSet = new Set(KNOWN_LABELS);

                // Heading: "Pre-Bid Meeting Information" (with or without "Information").
                // Must occupy its own line.
                const headingRe = /^pre[-\s]?bid\s+meeting(?:\s+information)?\s*$/im;
                const headingMatch = bodyText.match(headingRe);
                if (!headingMatch) return null;

                const afterHeading = headingMatch.index + headingMatch[0].length;

                // Stop at the next top-level section heading so we don't bleed into
                // Online Q&A, Contact Information, Bid Bond, etc.
                const STOP_RE = /^(?:online\s+q\s*&\s*a|contact\s+information|bid\s+bond|project\s+information|plan\s+holders|required\s+documents|addenda|q\s*&\s*a|documents?|submission)\s*$/im;
                const stopMatch = bodyText.substring(afterHeading).match(STOP_RE);
                const sectionEnd = stopMatch
                  ? afterHeading + stopMatch.index
                  : Math.min(afterHeading + 2000, bodyText.length);

                const sectionText = bodyText.substring(afterHeading, sectionEnd);
                const lines = sectionText.split('\n').map(trimLine).filter(Boolean);

                const pairs = {};
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];

                  // "Label: Value" on the same line.
                  const colonIdx = line.indexOf(':');
                  if (colonIdx > 0 && colonIdx < 70) {
                    const rawKey = labelKey(line.substring(0, colonIdx));
                    const rawVal = trimLine(line.substring(colonIdx + 1));
                    if (labelSet.has(rawKey) && rawVal) {
                      pairs[rawKey] = rawVal;
                      continue;
                    }
                  }

                  // "Label" on one line, value on the next line.
                  const lineKey = labelKey(line);
                  if (labelSet.has(lineKey)) {
                    const nextLine = i + 1 < lines.length ? trimLine(lines[i + 1]) : null;
                    if (nextLine && !labelSet.has(labelKey(nextLine))) {
                      pairs[lineKey] = nextLine;
                      i++; // consume the value line
                    } else {
                      pairs[lineKey] = null; // label present, no value
                    }
                  }
                }

                return pairs;
              };

              // FIX 1: strip navigation chrome from extracted title
              const cleanTitle = (t) => {
                if (!t) return null;
                return t
                  .replace(/\s*Add to My Bids[\s\S]*/i, '')
                  .replace(/\s*REMAINING[\s\S]*/i, '')
                  .replace(/\s+(?:[A-Z]{1,4}-\d{2}-\d{3,5}|\d{2,4}-\d{3,5})\s*$/, '')
                  .trim() || null;
              };

              // Parses the "Job Walk" / "Job Walk Information" / "Site Visit" section
              // from bodyText using the same architecture as extractPreBidMeetingSection.
              // Returns null when the heading is absent; an object of label→value pairs
              // when found.  Never falls back to field() — that regex leaks heading text.
              const extractJobWalkSection = () => {
                const trimLine = (s) => String(s ?? '').trim();
                const KNOWN_LABELS = [
                  'date & time', 'date/time', 'meeting date', 'meeting time',
                  'location', 'meeting location', 'address', 'venue',
                  'attendance required', 'attendance mandatory', 'mandatory',
                  'meeting type', 'meeting link',
                  'additional details', 'notes',
                  'job walk', 'site visit',
                ];
                const labelKey = (s) => trimLine(s).toLowerCase().replace(/\s+/g, ' ');
                const labelSet = new Set(KNOWN_LABELS);

                const headingRe = /^(?:job\s+walk|site\s+visit|mandatory\s+pre[-\s]?bid|pre[-\s]?bid\s+site\s+visit)(?:\s+information)?\s*$/im;
                const headingMatch = bodyText.match(headingRe);
                if (!headingMatch) return null;

                const afterHeading = headingMatch.index + headingMatch[0].length;

                const STOP_RE = /^(?:online\s+q\s*&\s*a|contact\s+information|bid\s+bond|project\s+information|plan\s+holders|required\s+documents|addenda|pre[-\s]?bid\s+meeting(?:\s+information)?|q\s*&\s*a|documents?|submission)\s*$/im;
                const stopMatch = bodyText.substring(afterHeading).match(STOP_RE);
                const sectionEnd = stopMatch
                  ? afterHeading + stopMatch.index
                  : Math.min(afterHeading + 2000, bodyText.length);

                const sectionText = bodyText.substring(afterHeading, sectionEnd);
                const lines = sectionText.split('\n').map(trimLine).filter(Boolean);

                const pairs = {};
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  const colonIdx = line.indexOf(':');
                  if (colonIdx > 0 && colonIdx < 70) {
                    const rawKey = labelKey(line.substring(0, colonIdx));
                    const rawVal = trimLine(line.substring(colonIdx + 1));
                    if (labelSet.has(rawKey) && rawVal) { pairs[rawKey] = rawVal; continue; }
                  }
                  const lineKey = labelKey(line);
                  if (labelSet.has(lineKey)) {
                    const nextLine = i + 1 < lines.length ? trimLine(lines[i + 1]) : null;
                    if (nextLine && !labelSet.has(labelKey(nextLine))) {
                      pairs[lineKey] = nextLine; i++;
                    } else {
                      pairs[lineKey] = null;
                    }
                  }
                }
                return pairs;
              };

              const titleEl = document.querySelector(
                "h1, h2, [class*='title'], [class*='bid-name'], [class*='project-name']"
              );
              const raw_title = cleanTitle(
                (titleEl && titleEl.innerText && titleEl.innerText.trim()) ||
                field('Bid Title') ||
                field('Project Title') ||
                field('Project Name') ||
                null
              );

              const due_date_raw =
                field('Closing Date') ||
                field('Bid Due Date') ||
                field('Bid Due') ||
                field('Due Date') ||
                null;

              const findEstimateRaw = () => {
                const labels = [
                  "Engineer's Estimate",
                  'Engineers Estimate',
                  'Estimated Value',
                  'Estimated Bid Value',
                  'Estimated Amount',
                  'Estimated Cost',
                  'Estimate Range',
                  'Project Estimate',
                  'Project Value',
                  'Construction Estimate',
                  'Cost Estimate',
                  'Budget',
                ];

                for (const label of labels) {
                  const direct = field(label);
                  if (direct) return `${label}: ${direct}`;
                }

                const normalized = bodyText.replace(/\s+/g, ' ');
                const labelPattern = labels
                  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "'?"))
                  .join('|');
                const moneyPattern = '(?:\\$\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[KkMmBb]|thousand|million|billion)?';
                const re = new RegExp(
                  `(?:${labelPattern})\\s*[:\\-]?\\s*(?:between\\s+)?(${moneyPattern}(?:\\s*(?:-|–|—|to|and)\\s*${moneyPattern})?)`,
                  'i'
                );
                const m = normalized.match(re);
                return m ? m[0].trim().substring(0, 300) : null;
              };

              const estimated_value_raw = findEstimateRaw();

              const license_requirements =
                field('License Requirements') ||
                field('License Type') ||
                field('Required License') ||
                field('License') ||
                null;

              const county = field('County') || field('Location County') || null;
              const department = field('Department') || field('Agency Department') || null;
              const liquidated_damages =
                field('Liquidated Damages') ||
                field('Liquidated Damage') ||
                field('LDs') ||
                null;
              const contract_duration =
                field('Contract Duration') ||
                field('Duration') ||
                field('Project Duration') ||
                field('Time of Completion') ||
                field('Completion Time') ||
                null;
              const bid_validity =
                field('Bid Validity') ||
                field('Bid Valid Until') ||
                field('Bid Hold') ||
                field('Validity') ||
                null;
              const delivery_dates =
                field('Delivery Dates') ||
                field('Delivery Date') ||
                field('Start Date') ||
                field('Completion Date') ||
                null;
              const project_address =
                field('Project Address') ||
                field('Work Location') ||
                field('Location') ||
                field('Project Location') ||
                null;
              // Job walk and pre-bid sections are parsed from bodyText as key/value pairs.
              // field() is not used for these — its regex leaks heading text into values.
              const jobWalkPairs = extractJobWalkSection();
              const preBidPairs = extractPreBidMeetingSection();

              const commodity_codes = [
                ...new Set((bodyText.match(/\b91\d{2,4}\b/g) ?? [])),
              ];

              const scopeMatch = bodyText.match(
                /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i
              );
              const scope_text = scopeMatch ? scopeMatch[1].trim().substring(0, 3000) : null;

              return {
                raw_title: raw_title ? raw_title.substring(0, 500) : null,
                due_date_raw,
                estimated_value_raw,
                license_requirements,
                department,
                liquidated_damages,
                contract_duration,
                bid_validity,
                delivery_dates,
                project_address,
                // Job walk fields — from section parser only.  No field() fallback:
                // field('Job Walk') matches "Job Walk Information" and captures "Information".
                job_walk_at: jobWalkPairs !== null
                  ? (jobWalkPairs['date & time'] || jobWalkPairs['date/time'] || jobWalkPairs['meeting date'] || null)
                  : null,
                job_walk_details: jobWalkPairs !== null
                  ? (jobWalkPairs['additional details'] || jobWalkPairs['notes'] || null)
                  : null,
                job_walk_location: jobWalkPairs !== null
                  ? (jobWalkPairs['meeting location'] || jobWalkPairs['location'] || jobWalkPairs['address'] || jobWalkPairs['venue'] || null)
                  : null,
                // Pre-bid fields — from pre-bid section parser only.
                pre_bid_meeting: preBidPairs !== null
                  ? (preBidPairs['pre-bid meeting'] ?? null)
                  : null,
                pre_bid_meeting_at: preBidPairs !== null
                  ? (preBidPairs['date & time'] || preBidPairs['date/time'] || preBidPairs['meeting date'] || null)
                  : null,
                pre_bid_meeting_location: preBidPairs !== null
                  ? (preBidPairs['meeting location'] || preBidPairs['location'] || preBidPairs['address'] || preBidPairs['venue'] || null)
                  : null,
                // meeting_type and meeting_link: job walk section takes precedence,
                // pre-bid section as fallback.
                meeting_type:
                  (jobWalkPairs !== null ? jobWalkPairs['meeting type'] : null) ||
                  (preBidPairs !== null ? preBidPairs['meeting type'] : null) ||
                  null,
                meeting_link:
                  (jobWalkPairs !== null ? jobWalkPairs['meeting link'] : null) ||
                  (preBidPairs !== null ? preBidPairs['meeting link'] : null) ||
                  null,
                additional_details: preBidPairs !== null
                  ? (preBidPairs['additional details'] || preBidPairs['notes'] || null)
                  : null,
                // attendance_required: job walk section → pre-bid section → null.
                attendance_required:
                  (jobWalkPairs !== null
                    ? (jobWalkPairs['attendance required'] || jobWalkPairs['attendance mandatory'] || jobWalkPairs['mandatory'] || null)
                    : null) ||
                  (preBidPairs !== null
                    ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
                    : null) ||
                  null,
                // section_scoped_* carry section-derived values into normalizeJobWalkMetadata.
                section_scoped_job_walk_at: jobWalkPairs !== null
                  ? (jobWalkPairs['date & time'] || jobWalkPairs['date/time'] || jobWalkPairs['meeting date'] || null)
                  : null,
                section_scoped_job_walk_details: jobWalkPairs !== null
                  ? (jobWalkPairs['additional details'] || jobWalkPairs['notes'] || null)
                  : null,
                section_scoped_attendance_required:
                  (jobWalkPairs !== null
                    ? (jobWalkPairs['attendance required'] || jobWalkPairs['attendance mandatory'] || jobWalkPairs['mandatory'] || null)
                    : null) ||
                  (preBidPairs !== null
                    ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
                    : null) ||
                  null,
                county,
                commodity_codes,
                scope_text,
                // Debug-only fields — never used by pipeline logic, stripped before DB write.
                _debug_preBidPairs: preBidPairs,
                _debug_body_preBid: (() => {
                  const headingRe = /^pre[-\s]?bid\s+meeting(?:\s+information)?\s*$/im;
                  const m = bodyText.match(headingRe);
                  if (!m) return 'SECTION NOT FOUND';
                  return bodyText.substring(Math.max(0, m.index - 80), m.index + 1800);
                })(),
              };
            });

            const authoritative = readiness.api ?? apiMetadataByBidId.get(String(bidId));
            if (authoritative) {
              raw.raw_title = authoritative.raw_title ?? raw.raw_title;
              raw.due_date_raw = authoritative.due_date_raw ?? raw.due_date_raw;
              raw.department = authoritative.project_type ?? raw.department;
              raw.county = authoritative.county ?? raw.county;
              raw.project_address = authoritative.project_address ?? raw.project_address;
              raw.scope_text = authoritative.scope_text ?? raw.scope_text;
            }

            if (!raw.raw_title || !raw.due_date_raw) {
              const detailDiagnostics = await page.evaluate(() => ({
                page_title: document.title,
                root_containers: {
                  bo_detail_content: Boolean(document.querySelector('#bo-detail-content')),
                  ember_application: Boolean(document.querySelector('.ember-application, [class*="ember-view"]')),
                  app_root: Boolean(document.querySelector('#app, [data-test-root], main')),
                  body: Boolean(document.body),
                },
                body_preview: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().substring(0, 800),
                body_chars: (document.body?.innerText ?? '').length,
              })).catch(() => null);
              log(`[${source_name}] Detail metadata incomplete before normalization: url=${detailUrl}; parser=planetbids_scan_detail_body_text_v1; title=${JSON.stringify(raw.raw_title ?? null)}; bid_due=${JSON.stringify(raw.due_date_raw ?? null)}; department=${JSON.stringify(raw.department ?? null)}; county=${JSON.stringify(raw.county ?? null)}; roots=${JSON.stringify(detailDiagnostics?.root_containers ?? {})}; page_title=${JSON.stringify(detailDiagnostics?.page_title ?? '')}; body_chars=${detailDiagnostics?.body_chars ?? 0}; body_preview=${detailDiagnostics?.body_preview ?? ''}`);
              if (!raw.raw_title) {
                const code = (detailDiagnostics?.body_chars ?? 0) === 0 ||
                  (detailDiagnostics?.root_containers?.ember_application && !detailDiagnostics?.root_containers?.bo_detail_content)
                  ? 'empty_detail_shell'
                  : /something went wrong|service unavailable/i.test(detailDiagnostics?.body_preview ?? '')
                    ? 'portal_error_page'
                    : 'missing_required_title';
                telemetry.extraction_failures++;
                telemetry.retryable_failures++;
                if (code === 'empty_detail_shell') telemetry.empty_shells++;
                if (code === 'portal_error_page') telemetry.portal_errors++;
                recordError(`${code}: target_bid_id=${bidId}; url=${detailUrl}; page_title=${detailDiagnostics?.page_title ?? ''}; body_chars=${detailDiagnostics?.body_chars ?? 0}`);
                telemetry.recovery_candidates.push({ portal_bid_id: bidId, source_url: detailUrl, error_code: code });
                errors++;
                continue;
              }
            }

            // Preserve failed detail extraction as a traceable quarantined row;
            // persistScannedCandidate assigns ingestion_status and keeps it out
            // of every end-user opportunity view.

            const _debugTitle = (raw.raw_title ?? '');
            const _isDebugTarget = detailUrl.includes('142261');

            // FIX 2: skip non-construction bids when codes are present and none are 91xxx
            if (raw.commodity_codes.length > 0) {
              const isConstruction = raw.commodity_codes.some((c) => {
                const n = parseInt(c, 10);
                return n >= 91000 && n <= 91999;
              });
              if (!isConstruction) {
                log(`[${source_name}] Skipping non-construction bid: ${(raw.raw_title ?? '').substring(0, 60)} (codes: ${raw.commodity_codes.join(', ')})`);
                continue;
              }
            }

            const estimate = parseEstimatedValueDetails(raw.estimated_value_raw);

            // Snapshot normalization inputs before calling (Stage 3 data).
            const _normInput = !_isDebugTarget ? null : {
              pre_bid_meeting:                    raw.pre_bid_meeting,
              pre_bid_meeting_at:                 raw.pre_bid_meeting_at,
              pre_bid_meeting_location:           raw.pre_bid_meeting_location,
              job_walk_at:                        raw.job_walk_at,
              job_walk_details:                   raw.job_walk_details,
              job_walk_location:                  raw.job_walk_location,
              attendance_required:                raw.attendance_required,
              meeting_type:                       raw.meeting_type,
              meeting_link:                       raw.meeting_link,
              additional_details:                 raw.additional_details,
              section_scoped_job_walk_at:         raw.section_scoped_job_walk_at,
              section_scoped_job_walk_details:    raw.section_scoped_job_walk_details,
              section_scoped_attendance_required: raw.section_scoped_attendance_required,
            };

            const jobWalkMetadata = normalizeJobWalkMetadata(raw);

            const _PRE_BID_KEYS = [
              'pre_bid_exists','pre_bid_meeting','pre_bid_meeting_at','meeting_datetime',
              'meeting_type','meeting_link','meeting_location','pre_bid_location',
              'pre_bid_meeting_link','pre_bid_notes','attendance_required',
              'job_walk_exists','job_walk_mandatory','job_walk_at',
              'job_walk_details','job_walk_location','additional_details',
            ];

            const crawl_data = {
              bid_id: bidId,
              due_date_raw: raw.due_date_raw,
              estimated_value: estimate.estimated_value,
              estimated_value_raw: estimate.estimated_value_raw,
              estimated_value_low: estimate.estimated_value_low,
              estimated_value_high: estimate.estimated_value_high,
              license_requirements: raw.license_requirements,
              department: raw.department,
              liquidated_damages: raw.liquidated_damages,
              contract_duration: raw.contract_duration,
              bid_validity: raw.bid_validity,
              delivery_dates: raw.delivery_dates,
              project_address: raw.project_address,
              ...jobWalkMetadata,
              meeting_type: raw.meeting_type,
              meeting_link: raw.meeting_link,
              additional_details: raw.additional_details,
              county: raw.county,
              commodity_codes: raw.commodity_codes,
              scope_text: raw.scope_text,
              scraped_at: new Date().toISOString(),
              extraction_source: authoritative ? 'detail_api' : 'rendered_page',
              extraction_confidence: authoritative ? 'authoritative' : 'high',
              api_response_url: authoritative?.api_response_url ?? null,
              api_response_status: authoritative?.api_response_status ?? null,
            };

            // Debug state travels on the candidate object, not in crawl_data.
            // index.js strips this before/after the Supabase write and prints the report.
            const _debugPreBid = !_isDebugTarget ? null : {
              correlationTs: new Date().toISOString(),
              stage1_rawBodyExcerpt: raw._debug_body_preBid,
              stage2_parserOutput: {
                _preBidPairs:        raw._debug_preBidPairs,
                pre_bid_meeting:     raw.pre_bid_meeting,
                meeting_type:        raw.meeting_type,
                pre_bid_meeting_at:  raw.pre_bid_meeting_at,
                attendance_required: raw.attendance_required,
                meeting_link:        raw.meeting_link,
                pre_bid_meeting_location: raw.pre_bid_meeting_location,
                additional_details:  raw.additional_details,
              },
              stage3_normInput:  _normInput,
              stage4_normOutput: jobWalkMetadata,
              stage5_crawlData:  Object.fromEntries(_PRE_BID_KEYS.map(k => [k, crawl_data[k] ?? null])),
            };

            candidates.push({
              source_url: detailUrl,
              raw_title: raw.raw_title,
              bid_due_at: parseBidDueDate(raw.due_date_raw),
              // OML normalized columns — promoted from crawl_data for typed access
              estimated_value:      estimate.estimated_value ?? null,
              estimated_value_low:  estimate.estimated_value_low ?? null,
              estimated_value_high: estimate.estimated_value_high ?? null,
              county:               raw.county ?? null,
              project_address:      raw.project_address ?? null,
              required_licenses:    null, // populated by future crawl-project phase
              required_naics:       null,
              portal_bid_id:        bidId ?? null,
              portal_department:    raw.department ?? null,
              crawl_data,
              _debugPreBid,
              _domInspection,
            });
            telemetry.candidates_fully_extracted++;

            log(`[${source_name}] Row ${i + 1}: bid_id=${bidId} title="${(raw.raw_title ?? '').substring(0, 60)}"`);
          } catch (e) {
            recordError(`Item ${i}: error — ${e.message}`);
            telemetry.extraction_failures++;
            telemetry.retryable_failures++;
            if (/context.*closed|target.*closed|browser.*closed/i.test(e.message)) telemetry.context_deaths++;
            errors++;
          }
        }

        if (bearerToken) {
          log(`[${source_name}] Bearer token captured — fetching ${candidates.length} manifest(s)`);
          for (const candidate of candidates) {
            const bidId = candidate.crawl_data?.bid_id;
            if (!bidId) continue;
            try {
              const manifestRes = await fetch(
                `https://api-external.prod.planetbids.com/papi/bid-downloadable-files?bid_id=${bidId}`,
                {
                  headers: {
                    Authorization: `Bearer ${bearerToken}`,
                    Referer: 'https://vendors.planetbids.com/',
                    Origin: 'https://vendors.planetbids.com',
                  },
                }
              );
              if (manifestRes.ok) {
                const json = await manifestRes.json();
                const documents = (json.data ?? []).map((item) => {
                  const a = item.attributes ?? {};
                  return {
                    file_title: String(a.fileTitle ?? a.file_title ?? ''),
                    filename: String(a.filename ?? ''),
                    file_size: typeof a.fileSize === 'number' ? a.fileSize : null,
                    server_full_path: String(a.serverFullPath ?? a.server_full_path ?? ''),
                    server_filename: String(a.serverFilename ?? a.server_filename ?? ''),
                  };
                });
                candidate.crawl_data.documents = documents;
                log(`[${source_name}] bid_id=${bidId}: ${documents.length} document(s)`);
              } else {
                log(`[${source_name}] bid_id=${bidId}: manifest HTTP ${manifestRes.status} — skipping`);
              }
            } catch (e) {
              log(`[${source_name}] bid_id=${bidId}: manifest error — ${e.message}`);
            }
          }
        } else {
          log(`[${source_name}] No bearer token captured — file manifests skipped`);
        }

        log(`[${source_name}] Scan complete. candidates=${candidates.length} errors=${errors} extraction_mode=${extractionMode} api_responses=${apiResponsesObserved}`);
      })(),
      timeoutPromise,
    ]);
  } catch (e) {
    if (e.message.includes('timed out')) {
      recordError(`${e.message} — returning ${candidates.length} partial result(s)`);
      errors++;
    } else {
      recordError(`Scrape error: ${e.message}`);
      errors++;
    }
  } finally {
    clearTimeout(timeoutHandle);
    if (hydrationDiagnostics) {
      // Compact summaries are retained for successful scans; detailed evidence
      // stays in the existing task-result path only on failed listing states.
      telemetry.planetbids_hydration_diagnostics_v1 = hydrationDiagnostics.build({ failure: errors > 0 });
    }
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }

  return { candidates, errors, errorMessages, telemetry };
}

module.exports = {
  scrapePlanetBids,
  parseBidDueDate,
  parseEstimatedValue,
  parseEstimatedValueDetails,
  openPlanetBidsRowWithRetry,
  waitForPlanetBidsDetailNavigation,
  waitForPlanetBidsListingState,
  isPlanetBidsListingResponseUrl,
  isPlanetBidsClockOrBeaconUrl,
  detectPlanetBidsInvalidPortal,
  PLANETBIDS_LISTING_WAIT_MS,
};
