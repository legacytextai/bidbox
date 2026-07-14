// Pure construction classification for For You membership only.
//
// This deliberately does not mutate or globally classify candidates. All keeps
// its existing complete-inventory semantics; callers use `isConstruction`
// only after the candidate has passed the shared valid/canonical/open gates.

export type ConstructionConfidence = "authoritative" | "strong" | "insufficient";

export interface ConstructionClassification {
  isConstruction: boolean;
  confidence: ConstructionConfidence;
  reasons: string[];
}

export interface ConstructionCandidate {
  portal_type?: string | null;
  raw_title?: string | null;
  scope_text?: string | null;
  portal_summary?: string | null;
  required_licenses?: string[] | null;
  required_naics?: string[] | null;
  crawl_data?: Record<string, unknown> | null;
}

// opportunity_candidates.portal_type is copied from the owning
// opportunity_sources row by the scan worker. Only the dedicated Caltrans
// advertised-projects driver writes the canonical value `caltrans`.
export function isCaltransAdvertisedProject(candidate: ConstructionCandidate): boolean {
  return candidate.portal_type === "caltrans";
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value
      .replace(/[._/]+/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
    : "";
}

function crawlString(candidate: ConstructionCandidate, key: string): string {
  return normalize(candidate.crawl_data?.[key]);
}

const STRUCTURED_CONSTRUCTION_VALUES = new Set([
  "construction",
  "construction project",
  "construction services",
  "public works",
  "public works construction",
  "capital construction",
  "capital improvement project",
]);

const STRUCTURED_NON_CONSTRUCTION_VALUES = new Set([
  "asset data collection",
  "clothing linen",
  "goods supplies",
  "janitorial custodial",
  "medical services",
  "professional services",
  "real estate transactional",
  "software it",
]);

function establishedClassification(candidate: ConstructionCandidate): ConstructionClassification | null {
  const crawl = candidate.crawl_data ?? {};
  if (crawl.public_works === true || crawl.is_construction === true) {
    return {
      isConstruction: true,
      confidence: "authoritative",
      reasons: ["Existing normalized metadata explicitly identifies construction/public works"],
    };
  }

  const normalizedValues = [
    crawlString(candidate, "construction_classification"),
    crawlString(candidate, "project_type"),
    crawlString(candidate, "procurement_type"),
    crawlString(candidate, "procurement_category"),
  ].filter(Boolean);
  const positive = normalizedValues.find((value) => STRUCTURED_CONSTRUCTION_VALUES.has(value));
  if (positive) {
    return {
      isConstruction: true,
      confidence: "authoritative",
      reasons: [`Existing normalized classification: ${positive}`],
    };
  }

  if (crawl.public_works === false || crawl.is_construction === false) {
    return {
      isConstruction: false,
      confidence: "strong",
      reasons: ["Existing normalized metadata explicitly identifies non-construction work"],
    };
  }

  const relevanceCategory = crawlString(candidate, "relevance_category").replace(/_/g, " ");
  const negative = [relevanceCategory, ...normalizedValues]
    .find((value) => STRUCTURED_NON_CONSTRUCTION_VALUES.has(value));
  if (negative) {
    return {
      isConstruction: false,
      confidence: "strong",
      reasons: [`Existing normalized non-construction classification: ${negative}`],
    };
  }
  return null;
}

function normalizeLicense(value: string): string {
  return value.toUpperCase().replace(/\b(?:CLASS|LICENSE|LICENCE)\b/g, "").replace(/[\s_]/g, "").trim();
}

function constructionLicense(candidate: ConstructionCandidate): string | null {
  return (candidate.required_licenses ?? []).find((raw) => {
    const value = normalizeLicense(raw);
    return /^(?:A|B|B-2|C-?\d{1,2}(?:\/D-?\d{1,2})?)$/.test(value);
  }) ?? null;
}

function constructionNaics(candidate: ConstructionCandidate): string | null {
  return (candidate.required_naics ?? []).find((raw) => {
    const digits = String(raw).replace(/\D/g, "");
    return /^23\d{0,4}$/.test(digits);
  }) ?? null;
}

interface EvidenceRule {
  reason: string;
  pattern: RegExp;
}

// These patterns describe a specifically non-construction procurement intent,
// not merely a word that sometimes appears in construction records. They are
// checked before general text evidence to avoid cases such as "construction
// management consulting" and "software installation".
const DEFINITIVE_NON_CONSTRUCTION: EvidenceRule[] = [
  {
    reason: "Software, SaaS, subscription, licensing, IT, or cybersecurity procurement",
    pattern: /\b(?:software|saas|subscription|license renewal|licensing renewal|information technology|it services?|cybersecurity|cloud services?|data platform)\b/,
  },
  {
    reason: "Staffing, recruiting, temporary labor, or training services",
    pattern: /\b(?:staffing|recruiting|recruitment|temporary labor|temporary staffing|training services?|training courses?)\b/,
  },
  {
    reason: "Consulting or professional-services engagement rather than a construction contract",
    pattern: /\b(?:construction management|project management) services?\b|\b(?:construction management|project management)\b.{0,60}\b(?:consulting|consultant|professional|support) services?\b|\b(?:architectural|engineering|design|consulting|consultant|professional|financial|marketing|advertising) services?\b/,
  },
  {
    reason: "Janitorial or custodial services without construction scope",
    pattern: /\b(?:janitorial|custodial|housekeeping|cleaning services?)\b/,
  },
  {
    reason: "Printing, uniforms, or office-supply procurement",
    pattern: /\b(?:printing|mailing|uniforms?|office supplies|linen services?)\b/,
  },
];

const GOODS_ONLY: EvidenceRule[] = [
  {
    reason: "Commodity, tools, parts, equipment, or materials purchase without field construction",
    pattern: /\b(?:purchase|procurement|supply|furnish|rental|lease)\b.{0,80}\b(?:screws?|fasteners?|screwdrivers?|hand tools?|light bulbs?|lamps?|replacement parts?|equipment|vehicles?|roofing materials?|asphalt materials?|concrete mix|supplies)\b/,
  },
  {
    reason: "Commodity, tools, parts, equipment, or materials purchase without field construction",
    pattern: /\b(?:screws?|fasteners?|screwdrivers?|hand tools?|light bulbs?|lamps?|replacement parts?|equipment|vehicles?|roofing materials?|supplies)\b.{0,80}\b(?:purchase|procurement|supply only|materials? only|without installation)\b/,
  },
  {
    reason: "Material or equipment supply only",
    pattern: /\b(?:materials?|equipment)\s+(?:purchase|procurement|supply)\b|\b(?:material|equipment) supply only\b|\bpurchase of (?:roofing |construction )?materials\b/,
  },
];

const PHYSICAL_ASSET = "(?:storm ?drains?|sewers?|wastewater|water mains?|water lines?|pipelines?|utilities|electrical systems?|mechanical systems?|roofs?|roofing|fences?|fencing|hvac|sidewalks?|curbs?|gutters?|roads?|roadways?|streets?|bridges?|drainage|buildings?|facilities|pump stations?|parks?|playgrounds?)";
const PHYSICAL_ACTION = "(?:construct(?:ion)?|reconstruct(?:ion)?|install(?:ation|ing)?|replace(?:ment|ing)?|repair(?:ing)?|rehabilitat(?:e|ion|ing)|renovat(?:e|ion|ing)|improv(?:e|ement|ing)s?|upgrade|moderniz(?:e|ation|ing)|modif(?:y|ication))";

const STRONG_CONSTRUCTION: EvidenceRule[] = [
  {
    reason: "Explicit construction/public-works delivery method",
    pattern: /\b(?:public works|construction|design[- ]build|job order contract(?:ing)?|joc|cm[- ]?at[- ]?risk)\b/,
  },
  {
    reason: "Physical construction or civil-work activity",
    pattern: /\b(?:reconstruction|rehabilitation|renovation|modernization|tenant improvements?|site improvements?|demolition|grading|excavation|earthwork|paving|resurfacing|asphalt overlay)\b/,
  },
  {
    reason: "Named physical asset with construction, installation, repair, replacement, or improvement work",
    pattern: new RegExp(`\\b${PHYSICAL_ASSET}\\b.{0,90}\\b${PHYSICAL_ACTION}\\b|\\b${PHYSICAL_ACTION}\\b.{0,90}\\b${PHYSICAL_ASSET}\\b`, "i"),
  },
  {
    reason: "Physical infrastructure improvement scope",
    pattern: /\b(?:park|facility|building|street|roadway|bridge|sidewalk|ada|drainage|sewer|storm ?drain|water main|pipeline|utility)\s+(?:improvements?|renovation|rehabilitation|replacement|upgrade|construction)\b/,
  },
  {
    reason: "Concrete, curb, gutter, roadway, or utility field work",
    pattern: /\b(?:concrete sidewalk|curb and gutter|road paving|roadway excavation|utility relocation|underground utilities|water main replacement|storm ?drain rehabilitation)\b/,
  },
  {
    reason: "Supply-and-install scope tied to physical infrastructure",
    pattern: new RegExp(`\\bsupply and install\\b.{0,90}\\b${PHYSICAL_ASSET}\\b|\\b${PHYSICAL_ASSET}\\b.{0,90}\\bsupply and install\\b`, "i"),
  },
];

function classificationText(candidate: ConstructionCandidate): string {
  const crawl = candidate.crawl_data ?? {};
  return [
    candidate.raw_title,
    candidate.scope_text,
    candidate.portal_summary,
    crawl.description,
    crawl.scope,
    crawl.scope_text,
    crawl.project_description,
    crawl.summary,
  ].map(normalize).filter(Boolean).join(" ");
}

export function classifyConstructionOpportunity(
  candidate: ConstructionCandidate,
): ConstructionClassification {
  if (isCaltransAdvertisedProject(candidate)) {
    return {
      isConstruction: true,
      confidence: "authoritative",
      reasons: ["Dedicated Caltrans advertised-projects driver (portal_type=caltrans)"],
    };
  }

  const existing = establishedClassification(candidate);
  if (existing) return existing;

  const license = constructionLicense(candidate);
  if (license) {
    return {
      isConstruction: true,
      confidence: "strong",
      reasons: [`Required California contractor license: ${license}`],
    };
  }

  const naics = constructionNaics(candidate);
  if (naics) {
    return {
      isConstruction: true,
      confidence: "strong",
      reasons: [`Construction-sector NAICS requirement: ${naics}`],
    };
  }

  const text = classificationText(candidate);
  if (!text) {
    return {
      isConstruction: false,
      confidence: "insufficient",
      reasons: ["No affirmative construction evidence"],
    };
  }

  const definitiveNegative = DEFINITIVE_NON_CONSTRUCTION.find(({ pattern }) => pattern.test(text));
  if (definitiveNegative) {
    return {
      isConstruction: false,
      confidence: "strong",
      reasons: [definitiveNegative.reason],
    };
  }

  const goodsOnly = GOODS_ONLY.find(({ pattern }) => pattern.test(text));
  const construction = STRONG_CONSTRUCTION.find(({ pattern }) => pattern.test(text));
  if (construction && !goodsOnly) {
    return {
      isConstruction: true,
      confidence: "strong",
      reasons: [construction.reason],
    };
  }
  if (goodsOnly) {
    return {
      isConstruction: false,
      confidence: "strong",
      reasons: [goodsOnly.reason],
    };
  }

  return {
    isConstruction: false,
    confidence: "insufficient",
    reasons: ["Insufficient affirmative construction evidence"],
  };
}
