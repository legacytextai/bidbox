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

// Generic label→value extractor for a flat DPW detail page. Detail templates
// wrap fields two ways: `<div.row><label>Foo:</label><div>value</div></div>`
// (aed_bid/asd_rfp/rfb) and `<div.col><label>Foo:</label></div><div.col>value`
// (cons). Trying label.next() then label.parent().next() covers both. Returns a
// raw { "Label": "value" } map; template-specific interpretation is Step 3.
function extractDetailFields($) {
  const fields = {};
  $('label').each((_i, el) => {
    const rawLabel = collapseWs($(el).text());
    if (!/:\s*$/.test(rawLabel)) return;
    const key = rawLabel.replace(/:\s*$/, '').trim();
    if (!key || key in fields) return;
    let value = collapseWs($(el).next().text());
    if (!value) value = collapseWs($(el).parent().next().text());
    fields[key] = value || null;
  });
  return fields;
}

// Documents are an ASP.NET GridView (#gvProjectDocuments): a header row + one
// row per file. The first body row is a sort-control row with empty cells. File
// links point at the SSO-gated OpportunitiesNewRegister.aspx (metadata is public
// even though the file download requires login). A trailing "*" on the title
// marks a registered-users-only document.
function extractDocuments($, detailUrl) {
  const table = $('table')
    .filter((_i, t) => /^\s*Document\b/i.test($(t).find('th').first().text()))
    .first();
  if (!table.length) return [];

  const headers = table
    .find('thead th, tr').first().find('th')
    .map((_i, th) => collapseWs($(th).text()).toLowerCase())
    .get();
  const colIndex = (name) => headers.findIndex((h) => h.includes(name));
  const idxNotes = colIndex('note') >= 0 ? colIndex('note') : colIndex('description');
  const idxPages = colIndex('page');
  const idxSize = colIndex('size');

  const documents = [];
  table.find('tbody tr').each((_i, tr) => {
    const cells = $(tr).find('td');
    const titleCellRaw = collapseWs(cells.eq(0).text());
    if (!titleCellRaw) return; // skip the sort-control / empty rows
    const registeredOnly = /\*\s*$/.test(titleCellRaw);
    const title = titleCellRaw.replace(/\s*\*\s*$/, '').trim();
    const href = $(tr).find('a[href]').first().attr('href') || null;
    const registerHref = href && !/^javascript:/i.test(href)
      ? new URL(href, detailUrl).toString()
      : null;
    documents.push({
      title,
      notes: idxNotes >= 0 ? collapseWs(cells.eq(idxNotes).text()) || null : null,
      pages: idxPages >= 0 ? collapseWs(cells.eq(idxPages).text()) || null : null,
      size: idxSize >= 0 ? collapseWs(cells.eq(idxSize).text()) || null : null,
      registered_only: registeredOnly,
      register_href: registerHref,
    });
  });
  return documents;
}

// ── Template registry ────────────────────────────────────────────────────────
// DPW routes each opportunity to one of several flat detail templates with
// different field vocabularies. Each template is expressed declaratively as a
// canonical-field → source-label(s) mapping — no per-template logic, no switch.
// The row's detail path segment selects the template; unknown segments (e.g.
// aed_rfp, which is not currently live) fall back to a union mapping so a new
// division still yields a usable candidate instead of crashing the scan.
//
// `typeLabel` mirrors the portal's own Opportunities.aspx type filter labels.

const TEMPLATE_REGISTRY = [
  {
    id: 'aed_bid',
    pathSegment: 'aed_bid',
    typeLabel: 'Building Projects',
    mapping: {
      title: ['Project Name'],
      description: ['Description'],
      location: ['Project Location(s)'],
      bid_due_raw: ['Closing Date'],
      advertised_raw: ['Open Date'],
      estimate_raw: ['Estimate'],
      pre_bid_raw: ['Proposers Conference(s)'],
      spec_no: ['Spec No'],
      category: ['Category'],
    },
  },
  {
    id: 'cons',
    pathSegment: 'cons',
    typeLabel: 'Infrastructure Projects',
    mapping: {
      title: ['Project Name'],
      description: ['Scope'],
      location: ['Cities/ Communities', 'Project Limit'],
      bid_due_raw: ['Bid Opening Date'],
      advertised_raw: ['Advertise Date'],
      federal_no: ['Federal No'],
      addenda_raw: ['Addenda'],
      category: ['Category'],
    },
  },
  {
    id: 'asd_rfp',
    pathSegment: 'asd_rfp',
    typeLabel: 'Sundry Services',
    mapping: {
      title: ['Project Name'],
      description: ['Description', 'Scope'],
      bid_due_raw: ['Proposal Due Date'],
      advertised_raw: ['RFP Issue Date'],
      estimate_raw: ['Estimate'],
      pre_bid_raw: ['Proposers Conference Date'],
      category: ['Category'],
    },
  },
  {
    id: 'rfb',
    pathSegment: 'rfb',
    typeLabel: 'Purchasing Opportunities',
    mapping: {
      title: ['Bid Title'],
      description: ['Bid Description'],
      bid_due_raw: ['Bid Closing Date'],
      advertised_raw: ['Bid Open Date'],
      department_explicit: ['Department'],
      category: ['Bid Type'],
    },
  },
];

// Union fallback for unrecognized templates: covers every known label so a new
// or inferred template (e.g. aed_rfp) still produces a usable candidate.
const GENERIC_TEMPLATE = {
  id: 'generic',
  typeLabel: null,
  mapping: {
    title: ['Project Name', 'Bid Title'],
    description: ['Scope', 'Description', 'Bid Description'],
    location: ['Project Location(s)', 'Cities/ Communities', 'Project Limit'],
    bid_due_raw: ['Closing Date', 'Bid Opening Date', 'Proposal Due Date', 'Bid Closing Date'],
    advertised_raw: ['Open Date', 'Advertise Date', 'RFP Issue Date', 'Bid Open Date'],
    estimate_raw: ['Estimate'],
    pre_bid_raw: ['Proposers Conference(s)', 'Proposers Conference Date'],
    addenda_raw: ['Addenda'],
    department_explicit: ['Department'],
    category: ['Category', 'Bid Type'],
  },
};

function selectTemplate(detailUrl) {
  const segment = (detailUrl.match(/\/contracts\/([a-z_]+)\//i) || [])[1];
  return TEMPLATE_REGISTRY.find((t) => t.pathSegment === segment) || GENERIC_TEMPLATE;
}

function pickField(fields, aliases) {
  for (const alias of aliases || []) {
    const value = fields[alias];
    if (value != null && value !== '') return value;
  }
  return null;
}

// Apply a template's declarative mapping to the raw field map, producing a
// canonical extraction. Contact and portal_bid_id are common to all templates.
function applyTemplate(template, fields, projectId) {
  const extraction = { template_id: template.id };
  for (const [canonicalKey, aliases] of Object.entries(template.mapping)) {
    extraction[canonicalKey] = pickField(fields, aliases);
  }
  extraction.portal_bid_id = projectId;
  extraction.department = extraction.department_explicit || template.typeLabel || null;
  extraction.contact_name = pickField(fields, ['Name']);
  extraction.contact_phone = pickField(fields, ['Phone']);
  extraction.contact_email = pickField(fields, ['Email']);
  return extraction;
}

// Step 2: fetch a candidate's detail page and merge raw extracted fields +
// document metadata into crawl_data. Step 3: select the template and produce a
// canonical extraction. Non-fatal on failure — the listing-level candidate is
// still returned. OML normalization (bid_due_at, estimate) is Step 4, so those
// typed columns stay unset here.
async function enrichCandidateFromDetail(candidate, log) {
  const html = await fetchHtml(candidate.source_url, log);
  const $ = cheerio.load(html);
  const fields = extractDetailFields($);
  const documents = extractDocuments($, candidate.source_url);
  const template = selectTemplate(candidate.source_url);
  const extraction = applyTemplate(template, fields, candidate.portal_bid_id);

  candidate.crawl_data.detail_fields = fields;
  candidate.crawl_data.documents = documents;
  candidate.crawl_data.document_count = documents.length;
  candidate.crawl_data.template_id = template.id;
  candidate.crawl_data.template_unrecognized = template.id === 'generic';
  candidate.crawl_data.extraction = extraction;
  candidate.crawl_data.extraction_method = 'lacounty_dpw_v1_detail';

  if (extraction.title) candidate.crawl_data.project_name = extraction.title;
  if (extraction.description) candidate.crawl_data.scope = extraction.description;
  return candidate;
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

      const candidate = buildListingCandidate(row, listingUrl);
      try {
        await enrichCandidateFromDetail(candidate, log);
        log(`[${source.source_name}] Parsed opportunity ${row.projectId}: ${row.rawTitle} (${candidate.crawl_data.document_count} docs)`);
      } catch (e) {
        // Detail fetch/parse failed — keep the listing-level candidate and flag it.
        candidate.crawl_data.detail_error = e.message;
        recordError(`Detail extraction failed for ${row.projectId}: ${e.message}`);
      }
      candidates.push(candidate);

      // Small politeness delay between detail fetches to stay under the WAF.
      await new Promise((r) => setTimeout(r, 150));
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
  extractDetailFields,
  extractDocuments,
  selectTemplate,
  applyTemplate,
  TEMPLATE_REGISTRY,
  fetchHtml,
  DEFAULT_LISTING_URL,
  CONTRACTS_BASE,
};
