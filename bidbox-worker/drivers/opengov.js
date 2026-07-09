// OpenGov Procurement scan driver — Phase 1 (discovery / metadata only).
//
// Platform: OpenGov Procurement (procurement.opengov.com), a React/MUI SPA
// backed by a clean authenticated JSON API at api.procurement.opengov.com.
// Fully reconned live (docs/handoff/2026-07-07-opengov-*.md):
//   - Auth: same-origin session cookies. Direct login endpoint
//     POST /api/v1/auth/login { username, password } (username = email).
//   - Cloudflare: app/API paths return `cf-mitigated: challenge` (403) to
//     unauthenticated/non-browser clients; an authenticated *browser* session
//     passes cleanly. => Browserbase is used ONLY to obtain a real browser
//     context (Cloudflare clearance) and log in; every data call after that
//     is a plain in-page fetch with credentials:'include'. No page navigation
//     per project, no DOM scraping.
//   - Discovery: POST /api/v1/project/search?page=&limit= with body
//     { categories:[<internal ids>], states:['CA'] } -> { projects, count }.
//     Category IDs are OpenGov-internal (resolved from taxonomy codes, §below).
//   - The three taxonomies (NAICS/NIGP/UNSPSC) are DISJOINT for the same
//     construction universe, so all three are queried and merged; dedupe is by
//     the stable integer OpenGov project id.
//
// This driver does discovery + normalization only. Project detail enrichment
// (Phase 2) and document acquisition via pre-signed S3 URLs (Phase 3) are
// deliberately out of scope — the list object alone carries every candidate
// field (title, agency, due date, description, source URL, bid id, contacts-
// via-org, categories).
//
// Transport: Browserbase, same path as drivers/planetbids.js / lacmta.js.
// No local-Chromium fallback (Cloudflare blocks non-browser transports) unless
// OPENGOV_ALLOW_LOCAL_PLAYWRIGHT=true is set for local debugging.

const { chromium } = require('playwright');
const { connectBrowserbaseSession } = require('../lib/browserbase');

const API_BASE = 'https://api.procurement.opengov.com/api/v1';
const PORTAL_BASE = 'https://procurement.opengov.com';
const DEFAULT_LISTING_URL = `${PORTAL_BASE}/vendors/open-bids`;
const DEFAULT_STATES = ['CA'];

// Categorization systems -> `set` query param on /categories/search.
const SET = { NAICS: 200, NIGP: 100, UNSPSC: 300 };

// Canonical construction dictionary, expressed as STRUCTURAL RULES (not a
// frozen id list). See docs/handoff/2026-07-07-opengov-category-dictionary.md.
// The driver resolves live category ids from these rules each refresh and
// caches them per worker process. Tier 1 = high-confidence construction.
const DICTIONARY_RULE = {
  tier1: {
    // NAICS: sector 23 (parent id rolls up all children — verified). Rule kept
    // for snapshot generation; parent alone is sufficient for the search.
    NAICS: (code) => /^23/.test(code),
    // NIGP construction service classes (3-digit class prefix).
    NIGP: (code) => ['906', '909', '910', '911', '912', '913', '918', '925', '926', '988'].includes(String(code).slice(0, 3)),
    // UNSPSC segment 72 = Building and Facility Construction and Maintenance Services.
    UNSPSC: (code) => String(code).slice(0, 2) === '72',
  },
  tier2: {
    NAICS: (code) => /^5413/.test(code),                                   // Architectural/Engineering
    NIGP: (code) => ['914', '961', '968'].includes(String(code).slice(0, 3)),
    UNSPSC: (code) => ['30', '81', '95'].includes(String(code).slice(0, 2)),
  },
};

// Seed terms exist only to surface categories past the /categories/search
// 100-result cap; the structural rule above does the actual precision. This
// focused list surfaces all Tier-1 construction classes/segments.
const SEED_TERMS = [
  'construction', 'contractor', 'building', 'road', 'roadway', 'highway', 'bridge',
  'pavement', 'paving', 'asphalt', 'concrete', 'sewer', 'water', 'storm drain', 'utility',
  'electrical', 'plumbing', 'hvac', 'roofing', 'demolition', 'excavation', 'grading',
  'earthwork', 'landscaping', 'irrigation', 'painting', 'structural', 'engineering',
  'environmental', 'abatement', 'masonry', 'fencing', 'lighting', 'traffic', 'well',
  'pump', 'architect', 'inspection', 'permit', 'sandblasting', 'facility',
];

// Process-level dictionary cache (avoids re-resolving ~130 category calls on
// every scan within the same worker lifetime). Refreshed after TTL.
const DICT_TTL_MS = 12 * 60 * 60 * 1000; // 12h
let _dictCache = null; // { at:number, ids:number[] }

function sourceLabel(source) {
  return source?.source_name ?? source?.name ?? 'OpenGov';
}

function parseBool(name) {
  return String(process.env[name] ?? '').toLowerCase() === 'true';
}

// Boolean env with an explicit default when the var is unset/empty.
function parseBool2(name, dflt) {
  const v = process.env[name];
  if (v === undefined || v === '') return dflt;
  return String(v).toLowerCase() === 'true';
}

function parseNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function detailUrl(governmentCode, projectId) {
  return `${PORTAL_BASE}/portal/${governmentCode}/projects/${projectId}`;
}

async function openBrowser(log) {
  if (process.env.BROWSERBASE_API_KEY) {
    return { ...(await connectBrowserbaseSession(log)), transport: 'browserbase' };
  }
  if (!parseBool('OPENGOV_ALLOW_LOCAL_PLAYWRIGHT')) {
    throw new Error('BROWSERBASE_API_KEY not configured. OpenGov is behind Cloudflare, which blocks non-browser transports; run this driver through Browserbase.');
  }
  const executablePath = process.env.OPENGOV_CHROME_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  return { browser, context, page, sessionId: null, transport: 'local_playwright' };
}

// Authenticate inside the browser context. Establishing a real page first gives
// Cloudflare clearance; the login POST then sets the session cookie.
async function openGovLogin(page, log) {
  const username = process.env.OPENGOV_EMAIL;
  const password = process.env.OPENGOV_PASSWORD;
  if (!username || !password) {
    throw new Error('OPENGOV_EMAIL / OPENGOV_PASSWORD not configured');
  }

  await page.goto(PORTAL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500); // let Cloudflare clearance settle

  const result = await page.evaluate(async ({ apiBase, username, password }) => {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    let body = null;
    try { body = await res.text(); } catch { /* ignore */ }
    return { status: res.status, ok: res.ok, body: (body || '').slice(0, 200) };
  }, { apiBase: API_BASE, username, password });

  if (!result.ok) {
    throw new Error(`OpenGov login failed (HTTP ${result.status}): ${result.body}`);
  }
  log(`OpenGov authenticated as ${username} (HTTP ${result.status})`);
}

// Resolve the live Tier-1 (optionally +Tier-2) construction category id set by
// enumerating each taxonomy via seed terms and applying the structural rule.
async function resolveCategoryDictionary(page, log) {
  const includeTier2 = parseBool('OPENGOV_INCLUDE_TIER2');

  if (_dictCache && Date.now() - _dictCache.at < DICT_TTL_MS) {
    log(`OpenGov category dictionary: using cached ${_dictCache.ids.length} ids`);
    return _dictCache.ids;
  }

  const resolved = await page.evaluate(async ({ apiBase, SET, SEED_TERMS, includeTier2 }) => {
    // Structural rules re-declared in-page (functions can't cross the bridge).
    const RULES = {
      tier1: {
        NAICS: (c) => /^23/.test(c),
        NIGP: (c) => ['906', '909', '910', '911', '912', '913', '918', '925', '926', '988'].includes(String(c).slice(0, 3)),
        UNSPSC: (c) => String(c).slice(0, 2) === '72',
      },
      tier2: {
        NAICS: (c) => /^5413/.test(c),
        NIGP: (c) => ['914', '961', '968'].includes(String(c).slice(0, 3)),
        UNSPSC: (c) => ['30', '81', '95'].includes(String(c).slice(0, 2)),
      },
    };
    const catSearch = (set, query) => fetch(`${apiBase}/categories/search?set=${set}`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    }).then((r) => (r.ok ? r.json() : [])).catch(() => []);

    const keep = new Map(); // id -> {taxonomy, code, tier}
    const perTaxonomy = { NAICS: 0, NIGP: 0, UNSPSC: 0 };
    for (const [taxonomy, set] of Object.entries(SET)) {
      const seen = new Map();
      for (const term of SEED_TERMS) {
        const arr = await catSearch(set, term);
        for (const c of (arr || [])) {
          if (c && c.id != null && !seen.has(c.id)) seen.set(c.id, c);
        }
      }
      for (const c of seen.values()) {
        const code = String(c.code);
        let tier = null;
        if (RULES.tier1[taxonomy](code)) tier = 1;
        else if (includeTier2 && RULES.tier2[taxonomy](code)) tier = 2;
        if (tier) { keep.set(c.id, { taxonomy, code, tier }); perTaxonomy[taxonomy]++; }
      }
    }
    // NAICS parent guarantee (rolls up all children even if seed terms miss one).
    keep.set(20000205, { taxonomy: 'NAICS', code: '23', tier: 1 });
    return { ids: [...keep.keys()], perTaxonomy };
  }, { apiBase: API_BASE, SET, SEED_TERMS, includeTier2 });

  const ids = resolved.ids;
  log(`OpenGov category dictionary resolved: ${ids.length} ids (NAICS ${resolved.perTaxonomy.NAICS}, NIGP ${resolved.perTaxonomy.NIGP}, UNSPSC ${resolved.perTaxonomy.UNSPSC}; tier2=${includeTier2})`);

  if (ids.length < 20) {
    // Safety net: never scan with a near-empty dictionary. Fall back to the
    // proven NAICS parent + NIGP construction-class seed at minimum.
    log(`OpenGov dictionary suspiciously small (${ids.length}); keeping NAICS parent as floor`);
    if (!ids.includes(20000205)) ids.push(20000205);
  }

  _dictCache = { at: Date.now(), ids };
  return ids;
}

// Discover CA construction projects across the resolved category set. project/
// search accepts a large categories[] array; a single high-limit request per
// page returns the full set. Dedup is by stable project id.
async function discoverProjects(page, categoryIds, states, log) {
  const pageSize = parseNumberEnv('OPENGOV_PAGE_SIZE', 100);
  const maxPages = parseNumberEnv('OPENGOV_MAX_PAGES', 20);

  const result = await page.evaluate(async ({ apiBase, categoryIds, states, pageSize, maxPages }) => {
    const byId = {};
    let count = null;
    let pages = 0;
    for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
      const res = await fetch(`${apiBase}/project/search?page=${pageNum}&limit=${pageSize}`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categories: categoryIds, states }),
      });
      if (!res.ok) return { error: `project/search HTTP ${res.status}`, byId, count, pages };
      const json = await res.json();
      count = json.count;
      const projects = json.projects || [];
      for (const p of projects) byId[p.id] = p;
      pages++;
      if (projects.length < pageSize) break;
    }
    return { byId, count, pages };
  }, { apiBase: API_BASE, categoryIds, states, pageSize, maxPages });

  if (result.error) throw new Error(result.error);
  const projects = Object.values(result.byId);
  log(`OpenGov discovery: server count=${result.count}, unique projects merged=${projects.length} across ${result.pages} page(s)`);
  return projects;
}

// Phase 2: per-project detail enrichment. GET /api/v1/project/:id for each
// discovered id, in bounded-concurrency batches inside the authenticated page
// context. Returns a map id -> slim detail (only the enrichment fields, to keep
// the cross-context payload small). Per-project failures are isolated: a missing
// detail degrades that candidate to list-only (Phase 1) rather than dropping it.
// Documents are captured as METADATA ONLY (no pre-signed url — that is Phase 3).
async function fetchProjectDetails(page, ids, log) {
  const concurrency = parseNumberEnv('OPENGOV_DETAIL_CONCURRENCY', 6);

  const maxBidItems = parseNumberEnv('OPENGOV_MAX_BID_ITEMS', 500);
  const enableVisible = parseBool2('OPENGOV_VISIBLE_METADATA', true);

  const out = await page.evaluate(async ({ apiBase, ids, concurrency, maxBidItems, enableVisible }) => {
    const cap = (s, n) => (typeof s === 'string' ? s.slice(0, n) : null);
    const slim = (p) => {
      const docManifest = (arr) => (Array.isArray(arr) ? arr : []).map((a) => ({
        id: a.id ?? null,
        shared_id: a.sharedId ?? null,
        name: a.name ?? null,
        title: a.title ?? null,
        filename: a.filename ?? null,
        file_extension: a.fileExtension ?? null,
        type: a.type ?? null,
      }));
      // Phase 2.5: addenda in their real shape (Phase 2 wrongly used the
      // attachment manifest shape). addendums[] carry number/description/
      // releasedAt/status/diff — not filename/fileExtension.
      const addendaList = (Array.isArray(p.addendums) ? p.addendums : []).map((a) => ({
        id: a.id ?? null,
        number: a.number ?? null,
        title: a.titleDisplay ?? a.title ?? null,
        description_excerpt: cap(a.description ?? null, 800),
        released_at: a.releasedAt ?? a.released_at ?? null,
        status: a.status ?? null,
        type: a.type ?? null,
        is_notice: a.isNotice ?? null,
        has_changes: Boolean(a.diff),
      }));
      // Phase 2.5: native bid items from priceTables[].priceItems[] (structured).
      const bidItems = [];
      let bidItemsTruncated = false;
      for (const table of (Array.isArray(p.priceTables) ? p.priceTables : [])) {
        const tableTitle = (table.title && typeof table.title === 'string') ? table.title : null;
        for (const it of (Array.isArray(table.priceItems) ? table.priceItems : [])) {
          if (it.isHeaderRow) continue;
          if (bidItems.length >= maxBidItems) { bidItemsTruncated = true; break; }
          bidItems.push({
            item_number: it.lineItem ?? it.number ?? null,
            description: cap(it.description ?? null, 1000),
            quantity: it.quantity ?? null,
            unit_of_measure: it.unitToMeasure ?? it.unitOfMeasure ?? null,
            unit_price: it.unitPrice ?? null,
            section_name: tableTitle,
            price_table_id: table.id ?? null,
            // Globally sequential across ALL price tables. orderById is
            // per-table (each table restarts at 1), so persisting it made
            // source_order collide across tables and the UI interleaved rows
            // (1, 5a, 2, 5b, …). bidItems.length is the running global index.
            source_order: bidItems.length + 1,
          });
        }
        if (bidItemsTruncated) break;
      }
      // Phase 2.5: criteria text (holds the engineer's estimate + notice/scope
      // prose) — returned capped for Node-side parsing.
      const criteria = (Array.isArray(p.criteria) ? p.criteria : []).map((c) => ({
        title: c.title ?? c.name ?? null,
        description: cap(c.description ?? null, 6000),
      })).filter((c) => c.description);
      // Section index (structure only).
      const sections = (Array.isArray(p.projectSections) ? p.projectSections : []).map((s) => ({
        title: s.title ?? null,
        short_name: s.shortName ?? null,
        order: s.orderById ?? null,
        section_type: s.section_type ?? null,
        section_number: s.sectionNumber ?? null,
      }));
      return {
        contact: {
          name: p.contactDisplayName ?? p.contactFullName ?? null,
          first_name: p.contactFirstName ?? null,
          last_name: p.contactLastName ?? null,
          title: p.contactTitle ?? null,
          email: p.contactEmail ?? null,
          phone: p.contactPhoneComplete ?? p.contactPhone ?? null,
          city: p.contactCity ?? null,
          state: p.contactState ?? null,
          zip: p.contactZipCode ?? null,
        },
        procurement_contact: {
          name: p.procurementDisplayName ?? p.procurementFullName ?? null,
          title: p.procurementTitle ?? null,
          email: p.procurementEmail ?? null,
          phone: p.procurementPhoneComplete ?? p.procurementPhone ?? null,
        },
        pre_bid: {
          text: p.preProposalText ?? null,
          location: p.preProposalLocation ?? null,
          date: p.preProposalDate ?? null,
        },
        timeline: p.timelineConfig ?? null,
        documents: docManifest(p.attachments),
        addenda: addendaList,
        flags: {
          show_bids: p.showBids ?? null,
          sealed_bid: p.showBidsWithPricing ?? null,
          is_doc_builder: p.isDocBuilder ?? null,
          uses_external_document: p.useExternalDocument ?? null,
          show_planholders: p.showPlanholders ?? null,
          has_sealed_bid: p.hasSealedBid ?? null,
        },
        // Phase 2.5 additions (parsed further in Node):
        visible: enableVisible ? {
          bid_items: bidItems,
          bid_items_truncated: bidItemsTruncated,
          criteria,
          sections,
        } : null,
      };
    };

    const result = {};
    const errors = [];
    for (let i = 0; i < ids.length; i += concurrency) {
      const batch = ids.slice(i, i + concurrency);
      await Promise.all(batch.map(async (id) => {
        try {
          const res = await fetch(`${apiBase}/project/${id}`, { credentials: 'include' });
          if (!res.ok) { errors.push(`project/${id} HTTP ${res.status}`); return; }
          const json = await res.json();
          const proj = json.project || json;
          result[id] = slim(proj);
        } catch (e) {
          errors.push(`project/${id}: ${String(e)}`);
        }
      }));
    }
    return { result, errors };
  }, { apiBase: API_BASE, ids, concurrency, maxBidItems, enableVisible });

  if (out.errors.length) {
    log(`OpenGov detail enrichment: ${Object.keys(out.result).length}/${ids.length} enriched, ${out.errors.length} detail error(s) (isolated): ${out.errors.slice(0, 3).join(' | ')}`);
  } else {
    log(`OpenGov detail enrichment: ${Object.keys(out.result).length}/${ids.length} enriched`);
  }
  return out.result;
}

function cleanBidId(financialId) {
  if (!financialId) return null;
  return String(financialId).replace(/[;\s]+$/g, '').trim() || null;
}

// ── Phase 2.5 parsers (pure Node, fixture-testable) ──────────────────────────

// OpenGov criteria/section descriptions are HTML with entities (e.g. the
// apostrophe in "Engineer's" arrives as &rsquo;, and "PROJECT NO." / the
// number can be split across <span> tags). Parsers MUST run on decoded plain
// text — otherwise entity/tag noise breaks the regexes (root cause of the
// first validation's null estimate + garbage solicitation).
function stripHtml(input) {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<[^>]+>/g, ' ');                 // drop tags
  const entities = {
    '&rsquo;': "'", '&lsquo;': "'", '&#39;': "'", '&apos;': "'", '&#8217;': "'", '&#8216;': "'",
    '&rdquo;': '"', '&ldquo;': '"', '&quot;': '"', '&#8220;': '"', '&#8221;': '"',
    '&ndash;': '-', '&mdash;': '-', '&#8211;': '-', '&#8212;': '-',
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  };
  s = s.replace(/&[a-z0-9#]+;/gi, (m) => entities[m.toLowerCase()] ?? ' ');
  return s.replace(/\s+/g, ' ').trim();
}

// Engineer's estimate: conservative parse over criteria descriptions. Only
// accepts a dollar amount that sits within ~120 chars of "estimate"/"engineer"
// to avoid picking arbitrary dollar figures out of body text. Returns the
// first confident match: { value:number, raw:string, source:string } or null.
function parseEngineerEstimate(criteria) {
  if (!Array.isArray(criteria)) return null;
  const near = /(engineer'?s?\s+estimate|estimated?\s+(?:construction\s+)?(?:cost|value|budget)|opinion of probable cost)[\s\S]{0,120}?\$\s*([\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,}(?:\.\d{2})?)/i;
  const nearRev = /\$\s*([\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,}(?:\.\d{2})?)[\s\S]{0,60}?(engineer'?s?\s+estimate|estimated?\s+(?:construction\s+)?(?:cost|value|budget))/i;
  for (const c of criteria) {
    const text = stripHtml(c.description);
    const m = text.match(near) || text.match(nearRev);
    if (m) {
      const rawAmount = (m[2] && /\d/.test(m[2])) ? m[2] : m[1];
      const value = Number(String(rawAmount).replace(/,/g, ''));
      if (Number.isFinite(value) && value >= 1000) {
        return { value, raw: `$${rawAmount}`, source: `criteria:${c.title || 'unknown'}` };
      }
    }
  }
  return null;
}

// Solicitation / project number, best-effort. Returns a string or null.
// Full compound formats (e.g. 26-IFB-029) are matched BEFORE the loose
// "IFB <token>" fallback so we never grab the trailing "029" out of "IFB-029".
function parseSolicitationNumber(criteria) {
  if (!Array.isArray(criteria)) return null;
  const patterns = [
    /\b(\d{2,4}-(?:IFB|RFP|RFQ|RFB)-[A-Z0-9][A-Z0-9\-]{1,24})/i,            // 26-IFB-029 (full, first)
    /\b(?:Project|Solicitation|Contract)\s*(?:ID|No\.?|Number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9._\-\/]{2,32})/i,
    /\b(?:IFB|RFP|RFQ|RFB)\s*(?:No\.?|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9._\-\/]{2,32})/i, // requires No./# to avoid mid-token
  ];
  const looksReal = (v) => v.length >= 5 || /[A-Za-z]/.test(v); // reject bare short numerics like "029"
  for (const c of criteria) {
    const text = stripHtml(c.description);
    for (const re of patterns) {
      const m = text.match(re);
      if (m && m[1]) {
        const val = m[1].replace(/[.,;]+$/, '').trim();
        if (val.length >= 3 && /[0-9]/.test(val) && looksReal(val)) return val;
      }
    }
  }
  return null;
}

// Short scope excerpt (capped) from a Scope-titled criteria, else the first
// non-Notice criteria. Purely for the lightweight summary — not full text.
function buildScopeExcerpt(criteria, maxLen = 1500) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;
  const scope = criteria.find((c) => /scope/i.test(c.title || ''));
  const chosen = scope || criteria.find((c) => !/notice/i.test(c.title || '')) || criteria[0];
  if (!chosen || !chosen.description) return null;
  const text = stripHtml(chosen.description);
  return text ? text.slice(0, maxLen) : null;
}

// Map OpenGov visible.bid_items into the shape bid_items.js normalizeBidItem
// consumes. Metadata only (unit_price is bidder-supplied/blank in solicitations).
function mapBidItemsForPersist(visibleBidItems, { projectId, sourceUrl }) {
  if (!Array.isArray(visibleBidItems)) return [];
  return visibleBidItems.map((it, i) => ({
    item_number: it.item_number != null ? String(it.item_number) : null,
    description: it.description || null,
    unit_of_measure: it.unit_of_measure || null,
    quantity: it.quantity ?? null,
    unit_price: it.unit_price ?? null,
    section_name: it.section_name || 'Schedule of Bid',
    source_portal: 'opengov',
    source_opportunity_id: projectId != null ? String(projectId) : null,
    source_url: sourceUrl || null,
    extraction_method: 'portal_tab',
    source_order: it.source_order ?? i + 1,
  })).filter((r) => r.description);
}

// Normalize an OpenGov project list object into a BidBox candidate. When a
// Phase 2 `detail` slice is supplied (from fetchProjectDetails) it is merged in:
// contacts, procurement contact, pre-bid/job-walk, timeline, and the document
// manifest (metadata only — no bytes, no expiring urls). Passing no detail
// yields the Phase 1 list-only candidate (graceful degradation).
//
// Note: OpenGov project detail exposes NO county/serviceArea field, so `county`
// stays null; locality is carried via agency + contact city/state instead.
function buildCandidate(project, detail = null) {
  const gov = project.government || {};
  const org = gov.organization || {};
  const dept = project.department || {};
  const bidId = cleanBidId(project.financialId);
  const source_url = detailUrl(gov.code, project.id);
  const agency = org.name || null;
  const matchedCategories = Array.isArray(project.categories)
    ? project.categories.map((c) => ({ id: c.id, code: c.code, set_id: c.setId, title: c.title }))
    : [];

  const enriched = Boolean(detail);
  const documents = enriched && Array.isArray(detail.documents) ? detail.documents : [];
  const addenda = enriched && Array.isArray(detail.addenda) ? detail.addenda : [];

  const crawl_data = {
    source: 'opengov_network',
    opengov_project_id: project.id,           // canonical stable dedup key
    financial_id: project.financialId || null,
    title: project.title || null,
    description: project.summary || null,
    status: project.status || null,
    release_date: project.releaseProjectDate || null,
    bid_due_at: project.proposalDeadline || null,
    source_url,
    detail_api: `${API_BASE}/project/${project.id}`,
    government_code: gov.code || null,
    agency,
    agency_website: org.website || null,
    agency_city: org.city || null,
    agency_state: org.state || null,
    agency_timezone: org.timezone || null,
    department: dept.name || null,
    department_id: dept.id ?? null,
    categories: matchedCategories,
    is_private: project.isPrivate ?? null,
    is_paused: project.isPaused ?? null,
    extracted_at: new Date().toISOString(),
    extraction_method: enriched ? 'opengov_v2_api_detail' : 'opengov_v1_api_discovery',
    detail_enriched: enriched,
    document_acquisition_supported: false,
    document_acquisition_note: 'Detail metadata via Phase 2. Document bytes (pre-signed S3 urls in project detail) are acquired in Phase 3.',
  };

  if (enriched) {
    crawl_data.contact = detail.contact ?? null;
    crawl_data.procurement_contact = detail.procurement_contact ?? null;
    crawl_data.pre_bid = detail.pre_bid ?? null;
    crawl_data.timeline = detail.timeline ?? null;
    crawl_data.flags = detail.flags ?? null;
    // Document manifest: metadata only (id, sharedId, filename, type) so
    // Phase 3 knows what to fetch and the UI can show availability now.
    crawl_data.documents = documents;
    crawl_data.document_count = documents.length;
    // Addenda: corrected shape (number, description, releasedAt, status, has_changes).
    crawl_data.addenda = addenda;
    crawl_data.addenda_count = addenda.length;
  }

  // ── Phase 2.5: portal-visible metadata (parsed from the same payload) ──
  let estimatedValue = null;
  let promotedBidId = bidId;
  let bidItemsForPersist = [];
  const visible = enriched && detail.visible ? detail.visible : null;
  if (visible) {
    const estimate = parseEngineerEstimate(visible.criteria);
    const solicitation = parseSolicitationNumber(visible.criteria);
    const scopeExcerpt = buildScopeExcerpt(visible.criteria);
    const bidItems = Array.isArray(visible.bid_items) ? visible.bid_items : [];
    bidItemsForPersist = mapBidItemsForPersist(bidItems, { projectId: project.id, sourceUrl: source_url });

    crawl_data.extraction_method = 'opengov_v2_5_visible_metadata';
    crawl_data.opengov_visible_metadata = {
      estimated_value: estimate ? estimate.value : null,
      estimated_value_raw: estimate ? estimate.raw : null,
      estimated_value_source: estimate ? estimate.source : null,
      solicitation_number: solicitation,
      scope_excerpt: scopeExcerpt,
      sections: Array.isArray(visible.sections) ? visible.sections : [],
      bid_item_count: bidItemsForPersist.length,
      bid_items_truncated: Boolean(visible.bid_items_truncated),
      extracted_at: new Date().toISOString(),
    };

    if (estimate) estimatedValue = estimate.value;                 // promote to typed column
    if (solicitation) promotedBidId = solicitation;               // prefer real solicitation number
  }

  // Prefer org address for locality; fall back to contact city/state from detail.
  const localityParts = [org.address1, org.city, org.state, org.zipCode].filter(Boolean);
  const project_address = localityParts.length > 0
    ? localityParts.join(', ')
    : (enriched && detail.contact
        ? [detail.contact.city, detail.contact.state, detail.contact.zip].filter(Boolean).join(', ') || null
        : null);

  const candidate = {
    source_url,
    raw_title: project.title || promotedBidId || String(project.id),
    agency,
    bid_due_at: project.proposalDeadline || null,
    estimated_value: estimatedValue,          // Phase 2.5: engineer's estimate when confidently parsed
    estimated_value_low: null,
    estimated_value_high: null,
    county: null,            // OpenGov detail exposes no county field
    project_address: project_address || null,
    required_licenses: null,
    required_naics: null,
    portal_bid_id: promotedBidId || String(project.id),
    portal_department: dept.name || null,
    crawl_data,
  };
  // Transient field consumed by runScan to persist opportunity_bid_items after
  // the candidate is upserted. Not part of portalOwnedCandidateFields, so it is
  // never written to opportunity_candidates.
  if (bidItemsForPersist.length > 0) {
    Object.defineProperty(candidate, '_bidItems', { value: bidItemsForPersist, enumerable: false });
  }
  return candidate;
}

async function scrapeOpenGov(source, log = console.log) {
  const sourceName = sourceLabel(source);
  const states = Array.isArray(source?.states) && source.states.length ? source.states : DEFAULT_STATES;
  const candidates = [];
  const errorMessages = [];
  let session;

  const recordError = (message) => {
    errorMessages.push(message);
    log(`[${sourceName}] ${message}`);
  };

  try {
    session = await openBrowser(log);
    const { page, transport } = session;
    log(`[${sourceName}] Opening OpenGov via ${transport}`);

    await openGovLogin(page, log);

    const categoryIds = await resolveCategoryDictionary(page, log);
    if (!categoryIds.length) {
      recordError('OpenGov category dictionary resolved to 0 ids — aborting scan (would return all-or-nothing)');
      return { candidates, errors: errorMessages.length, errorMessages };
    }

    const projects = await discoverProjects(page, categoryIds, states, log);

    // Phase 2: enrich each discovered project with detail (contacts, pre-bid,
    // timeline, document manifest). Enabled by default; failures are isolated
    // per project and degrade that candidate to list-only.
    let detailById = {};
    if (parseBool2('OPENGOV_ENRICH_DETAIL', true)) {
      const ids = projects.map((p) => p.id).filter((id) => id != null);
      try {
        detailById = await fetchProjectDetails(page, ids, log);
      } catch (e) {
        recordError(`OpenGov detail enrichment failed (falling back to list-only): ${e.message}`);
        detailById = {};
      }
    } else {
      log(`[${sourceName}] OpenGov detail enrichment disabled (OPENGOV_ENRICH_DETAIL=false)`);
    }

    let enrichedCount = 0;
    for (const project of projects) {
      try {
        const gov = project.government || {};
        if (!gov.code || project.id == null) {
          recordError(`Skipping project ${project.id ?? '(no id)'}: missing government.code`);
          continue;
        }
        const detail = detailById[project.id] ?? null;
        if (detail) enrichedCount++;
        const candidate = buildCandidate(project, detail);
        if (!candidate.raw_title || !candidate.source_url) {
          recordError(`Metadata incomplete for project ${project.id}: title/source_url missing`);
          continue;
        }
        candidates.push(candidate);
      } catch (e) {
        recordError(`Normalization failed for project ${project?.id ?? '(unknown)'}: ${e.message}`);
      }
    }

    log(`[${sourceName}] OpenGov complete: ${candidates.length} candidate(s) normalized (${enrichedCount} detail-enriched)`);
  } catch (e) {
    recordError(`OpenGov scrape failed: ${e.message}`);
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }

  return {
    candidates,
    errors: errorMessages.length,
    errorMessages,
  };
}

module.exports = {
  DEFAULT_LISTING_URL,
  API_BASE,
  PORTAL_BASE,
  SET,
  DICTIONARY_RULE,
  SEED_TERMS,
  buildCandidate,
  cleanBidId,
  detailUrl,
  scrapeOpenGov,
  // Phase 3 document acquisition reuses the authenticated browser transport.
  openBrowser,
  openGovLogin,
  // Phase 2.5 parsers (exported for fixture tests)
  stripHtml,
  parseEngineerEstimate,
  parseSolicitationNumber,
  buildScopeExcerpt,
  mapBidItemsForPersist,
};
