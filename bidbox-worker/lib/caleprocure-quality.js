'use strict';

// Cal eProcure data-quality rules: title validity and construction relevance.
//
// Title problem: the event detail page is a client-rendered template whose
// event-name node contains the literal text "[Event Title]" until data
// binding completes. A scrape that runs before hydration captures that
// placeholder, and `detail.title || row.title` lets the truthy placeholder
// beat the real listing title. These helpers centralize placeholder
// detection so extraction, persistence, and recovery all agree on what a
// valid title is.
//
// Relevance problem: Cal eProcure is a statewide everything-portal (linen
// services, physicals, escrow, IT) with no UNSPSC/license data currently
// captured (0/337 in production on 2026-07-13), so classification runs on
// title + description text. The classifier is deliberately conservative:
// a record is excluded only when a specific non-construction category
// matches AND no positive construction evidence is present.

const PLACEHOLDER_TITLE_PATTERNS = [
  /^\[?\s*event\s*title\s*\]?$/i,
  /^\[?\s*title\s*\]?$/i,
  /^\[?\s*event\s*name\s*\]?$/i,
  /^event\s+details?$/i,
  /^details?$/i,
  /^untitled$/i,
  /^n\/?a$/i,
];

function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ');
}

function normalizeEventTitle(raw) {
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
  return text || null;
}

// Strip a leading/duplicated event id so "0000039519 - X" and "X" compare equal.
function titleWithoutEventId(title, eventId) {
  if (!title) return null;
  let text = title;
  const id = String(eventId ?? '').trim();
  if (id) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(`^\\s*${escaped}\\s*[-–—:]*\\s*`, 'i'), '');
    text = text.replace(new RegExp(`\\s*[-–—:]*\\s*${escaped}\\s*$`, 'i'), '');
  }
  return text.trim() || null;
}

// True when a title carries no real information: empty, a template
// placeholder, portal boilerplate, or nothing beyond the event id itself.
function isPlaceholderEventTitle(rawTitle, eventId = null) {
  const title = normalizeEventTitle(rawTitle);
  if (!title) return true;
  const core = titleWithoutEventId(title, eventId);
  if (!core) return true;
  // "[Event Title]" may appear embedded ("0000039519 - [Event Title]").
  if (/\[\s*event\s*title\s*\]/i.test(title)) return true;
  return PLACEHOLDER_TITLE_PATTERNS.some((pattern) => pattern.test(core));
}

// Prioritized title selection. `sources` is ordered highest quality first;
// the first entry whose value is a valid (non-placeholder) title wins.
// Returns { title, source } or { title: null, source: null }.
function chooseBestEventTitle(sources, eventId = null) {
  for (const { value, source } of sources) {
    const normalized = normalizeEventTitle(value);
    if (normalized && !isPlaceholderEventTitle(normalized, eventId)) {
      return { title: normalized, source };
    }
  }
  return { title: null, source: null };
}

// Refresh guard: true when a persisted valid title would be downgraded by an
// incoming placeholder (e.g. a later scan that raced hydration). Callers keep
// the existing title in that case.
function shouldPreserveExistingTitle(existing, incoming) {
  const eventId = incoming?.portal_bid_id ?? existing?.portal_bid_id ?? null;
  const existingValid = !isPlaceholderEventTitle(existing?.raw_title, existing?.portal_bid_id ?? eventId);
  const incomingInvalid = isPlaceholderEventTitle(incoming?.raw_title, eventId);
  return existingValid && incomingInvalid;
}

// ---------------------------------------------------------------------------
// Relevance classification
// ---------------------------------------------------------------------------

// Cal eProcure titles are frequently concatenated ("25-305722.FMD.
// AVSystemMaintenance"). Split camelCase and dotted segments so
// word-boundary patterns can see the real words.
function normalizeClassificationText(text) {
  return String(text ?? '')
    .replace(/[._/]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Strong positive construction evidence. Deliberately excludes bare generic
// words (system, maintenance, installation, repair, services, equipment) —
// those appear in IT and operational procurements too. Compound phrases tie
// the generic word to physical infrastructure.
const CONSTRUCTION_EVIDENCE = [
  /\bconstructions?\b/i,
  /\bpublic works\b/i,
  /\bpav(?:ing|ement)\b/i, /\basphalt\b/i, /\bconcrete\b/i, /\bslurry seal\b/i,
  /\bdemolition\b/i, /\bgrading\b/i, /\bearthwork\b/i, /\bexcavat(?:e|ion|ing)\b/i,
  /\bdrainage\b/i, /\bstorm ?drains?\b/i, /\bsewer\b/i, /\bwastewater\b/i,
  /\bwater (?:main|line|well|system|treatment)s?\b/i, /\bgrey ?water\b/i, /\bpotable water\b/i,
  /\bpipelines?\b/i, /\bculverts?\b/i, /\baqueducts?\b/i,
  /\broof(?:ing|s)?\b/i, /\bre-?roof\b/i,
  /\bhvac\b/i, /\bchillers?\b/i, /\bboilers?\b/i, /\bcooling towers?\b/i,
  /\belectrical (?:upgrade|improvement|install|installation|infrastructure|distribution|service|work|system)s?\b/i,
  /\bswitchgear\b/i, /\bsubstations?\b/i, /\bgenerators?\b/i, /\bev (?:charging|supply)\b/i, /\belectric vehicle supply\b/i,
  /\belevator (?:modernization|maintenance|repair|replacement|installation)\b/i,
  /\bfire (?:sprinkler|suppression|alarm|life safety)\b/i,
  /\bsynthetic turf\b/i, /\bplaygrounds?\b/i, /\bfencing\b/i, /\bfence (?:repair|replacement|installation)\b/i,
  /\blandscap(?:e|ing) (?:construction|improvement|installation|renovation)\b/i,
  /\bsite (?:work|improvement|preparation)s?\b/i, /\btenant improvements?\b/i,
  /\brenovat(?:e|ion|ing)\b/i, /\bremodel(?:ing)?\b/i, /\brehabilitat(?:e|ion|ing)\b/i, /\bmodernizat?ion\b/i,
  /\bbuilding (?:improvement|repair|maintenance|construction|systems?)\b/i,
  /\bfacilit(?:y|ies) (?:improvement|repair|maintenance|construction|modification)s?\b/i,
  /\bstructural\b/i, /\bretaining walls?\b/i, /\bbridges?\b/i, /\bbuildings? #?\d+\b/i,
  /\bstreets?\b/i, /\broadway\b/i, /\bhighway\b/i, /\bsidewalks?\b/i, /\bcurb\b/i, /\bgutter\b/i, /\bada ramps?\b/i,
  /\bresurfac(?:e|ing)\b/i, /\boverlay\b/i, /\bstriping\b/i, /\bguardrails?\b/i,
  /\bwindow systems?\b/i, /\bgrille doors?\b/i, /\bstorage tanks?\b/i, /\bpumping plants?\b/i, /\bpump stations?\b/i,
  /\bsite utilities\b/i, /\butilit(?:y|ies) (?:replacement|relocation|installation|infrastructure|undergrounding)\b/i,
  /\bjob order contract(?:ing)?\b/i, /\bjoc\b/i, /\bdesign[- ]build\b/i, /\bcm[- ]?at[- ]?risk\b/i,
  /\bprevailing wage\b/i, /\bcontractor'?s? license\b/i, /\bcslb\b/i, /\bclass [a-c]\d* licen[sc]e\b/i,
  /\bengineer'?s? estimate\b/i, /\bbid schedule\b/i, /\bplans? and specifications?\b/i,
  /\bbonds? (?:required|payment|performance)\b/i, /\bperformance bond\b/i,
];

// Non-construction categories. Each entry: [machine code, human label,
// patterns]. Matched against normalized title + description.
const NON_CONSTRUCTION_CATEGORIES = [
  ['clothing_linen', 'Clothing, uniform, or linen services', [
    /\bclothing\b/i, /\buniforms?\b/i, /\blinens?\b/i, /\blaundry\b/i, /\bgarments?\b/i, /\bapparel\b/i, /\bembroider(?:y|ed)\b/i,
  ]],
  ['medical_services', 'Medical or healthcare services', [
    /\bphysicals?\b/i, /\bphysical exam(?:ination)?s?\b/i, /\bmedical exam(?:ination)?s?\b/i,
    /\bhealth ?care\b/i, /\bnursing\b/i, /\bdental\b/i, /\boptometr/i, /\bpsychiatr/i, /\bpsycholog/i,
    /\bpharmac/i, /\bclinical\b/i, /\bpatient\b/i, /\bimmunization\b/i, /\bvaccin/i,
  ]],
  ['real_estate_transactional', 'Title, escrow, appraisal, or real-estate transaction services', [
    /\btitle and escrow\b/i, /\btitle\s*\/\s*escrow\b/i, /\bescrow services?\b/i,
    /\bappraisal services?\b/i, /\breal estate (?:broker|services|transaction)/i, /\bwanted to lease\b/i, /\blease of (?:office|space)\b/i,
  ]],
  ['software_it', 'Software, IT, or data-system procurement', [
    /\bsoftwares?\b/i, /\bsaas\b/i, /\bcybersecurity\b/i, /\binformation technology\b/i, /\bit services?\b/i,
    /\bdata (?:system|platform|warehouse|analytics)s?\b/i, /\bdatabases?\b/i, /\bcloud (?:services?|hosting|subscription|platform)\b/i,
    /\btelecommunications? system\b/i, /\bcall processing\b/i, /\bweb(?:site)? (?:development|hosting|redesign)\b/i,
    /\baudio ?visual\b/i, /\bav (?:system|equipment)s?\b/i,
  ]],
  ['asset_data_collection', 'Data or asset inventory collection services', [
    /\basset data collection\b/i, /\bdata collection\b/i, /\basset inventory\b/i, /\bgeodatabase\b/i,
  ]],
  ['janitorial_custodial', 'Janitorial or custodial services', [
    /\bjanitorial\b/i, /\bcustodial\b/i, /\bhousekeeping\b/i,
  ]],
  ['professional_services', 'Professional or administrative services without construction scope', [
    /\bhearing officer\b/i, /\bcourt report(?:ing|ers?)\b/i, /\binterpret(?:ing|ers?|ations?)\b/i, /\btranslation\b/i,
    /\bstaffing\b/i, /\bpayroll\b/i, /\bactuarial\b/i, /\baudit(?:ing)? services?\b/i,
    /\bmarketing\b/i, /\badvertising\b/i, /\bfocus groups?\b/i, /\btraining courses?\b/i, /\bcurriculum\b/i,
    /\bbargaining facilitator\b/i, /\blegal services?\b/i, /\bconsult(?:ing|ant)s? services?\b/i,
  ]],
  ['goods_supplies', 'Goods, supplies, or equipment unrelated to construction', [
    /\boffice suppl(?:y|ies)\b/i, /\bgeneral suppl(?:y|ies)\b/i, /\blab(?:oratory)? suppl(?:y|ies)\b/i,
    /\btoner\b/i, /\benvelopes?\b/i, /\bprinting\b/i, /\bcourier\b/i, /\bfreight\b/i,
    /\bfood\b/i, /\bcatering\b/i, /\bvehicle (?:purchase|lease|rental)s?\b/i, /\btires?\b/i,
    /\bfurniture\b/i, /\btowing\b/i, /\bfuel\b/i, /\bpropane\b/i,
  ]],
];

function findCategory(text) {
  for (const [category, label, patterns] of NON_CONSTRUCTION_CATEGORIES) {
    const matched = patterns.find((pattern) => pattern.test(text));
    if (matched) return { category, label, evidence: String(matched) };
  }
  return null;
}

// Classify a Cal eProcure candidate's construction relevance.
// Returns { verdict: 'retain'|'excluded', category, reason, evidence }.
//
// Order of precedence:
// 1. Construction evidence in the TITLE always retains.
// 2. A non-construction category in the TITLE excludes — the title states
//    what is being procured; descriptions of service contracts routinely
//    name physical infrastructure ("inventory of highway signs") that must
//    not rescue them.
// 3. Otherwise the full text is considered: exclude only when a category
//    matches and no construction evidence appears anywhere.
// 4. Anything uncertain is retained (precision over aggressive filtering).
function classifyCalEprocureRelevance({ title, description }) {
  const titleText = normalizeClassificationText(title);
  const fullText = normalizeClassificationText(`${title ?? ''} ${description ?? ''}`);
  if (!fullText) return { verdict: 'retain', category: null, reason: null, evidence: null };

  const titleConstruction = CONSTRUCTION_EVIDENCE.find((pattern) => pattern.test(titleText));
  if (titleConstruction) {
    return { verdict: 'retain', category: null, reason: null, evidence: String(titleConstruction) };
  }

  const titleCategory = titleText ? findCategory(titleText) : null;
  if (titleCategory) {
    return {
      verdict: 'excluded',
      category: titleCategory.category,
      reason: `Non-public-works procurement: ${titleCategory.label}`,
      evidence: titleCategory.evidence,
    };
  }

  const fullConstruction = CONSTRUCTION_EVIDENCE.find((pattern) => pattern.test(fullText));
  if (fullConstruction) {
    return { verdict: 'retain', category: null, reason: null, evidence: String(fullConstruction) };
  }

  const fullCategory = findCategory(fullText);
  if (fullCategory) {
    return {
      verdict: 'excluded',
      category: fullCategory.category,
      reason: `Non-public-works procurement: ${fullCategory.label}`,
      evidence: fullCategory.evidence,
    };
  }

  return { verdict: 'retain', category: null, reason: null, evidence: null };
}

const NON_PUBLIC_WORKS_EXCLUSION_CODE = 'non_public_works';

module.exports = {
  NON_PUBLIC_WORKS_EXCLUSION_CODE,
  chooseBestEventTitle,
  classifyCalEprocureRelevance,
  isPlaceholderEventTitle,
  normalizeClassificationText,
  normalizeEventTitle,
  shouldPreserveExistingTitle,
  titleWithoutEventId,
};
