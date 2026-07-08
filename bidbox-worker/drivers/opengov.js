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

  const out = await page.evaluate(async ({ apiBase, ids, concurrency }) => {
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
        addenda: docManifest(p.addendums),
        flags: {
          show_bids: p.showBids ?? null,
          sealed_bid: p.showBidsWithPricing ?? null,
          is_doc_builder: p.isDocBuilder ?? null,
          uses_external_document: p.useExternalDocument ?? null,
        },
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
  }, { apiBase: API_BASE, ids, concurrency });

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
    // Document/addenda manifest: metadata only (id, sharedId, filename, type) so
    // Phase 3 knows what to fetch and the UI can show availability now.
    crawl_data.documents = documents;
    crawl_data.document_count = documents.length;
    crawl_data.addenda = addenda;
    crawl_data.addenda_count = addenda.length;
  }

  // Prefer org address for locality; fall back to contact city/state from detail.
  const localityParts = [org.address1, org.city, org.state, org.zipCode].filter(Boolean);
  const project_address = localityParts.length > 0
    ? localityParts.join(', ')
    : (enriched && detail.contact
        ? [detail.contact.city, detail.contact.state, detail.contact.zip].filter(Boolean).join(', ') || null
        : null);

  return {
    source_url,
    raw_title: project.title || bidId || String(project.id),
    agency,
    bid_due_at: project.proposalDeadline || null,
    estimated_value: null,
    estimated_value_low: null,
    estimated_value_high: null,
    county: null,            // OpenGov detail exposes no county field
    project_address: project_address || null,
    required_licenses: null,
    required_naics: null,
    portal_bid_id: bidId || String(project.id),
    portal_department: dept.name || null,
    crawl_data,
  };
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
  SET,
  DICTIONARY_RULE,
  SEED_TERMS,
  buildCandidate,
  cleanBidId,
  detailUrl,
  scrapeOpenGov,
};
