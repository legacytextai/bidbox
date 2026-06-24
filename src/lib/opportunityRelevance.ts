export type OpportunityTitleRelevance = "high" | "low";

export type OpportunityTitleFilterReason =
  | "software_it"
  | "professional_services"
  | "food_services"
  | "staffing_training"
  | "municipal_operations"
  | "real_estate";

export interface OpportunityTitleClassification {
  relevance: OpportunityTitleRelevance;
  reason: OpportunityTitleFilterReason | null;
}

const normalize = (title: string | null | undefined) =>
  String(title ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9/&+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const includesAny = (title: string, patterns: RegExp[]) =>
  patterns.some((pattern) => pattern.test(title));

const CONSTRUCTION_ADJACENT_PATTERNS = [
  /\barchitectural\b/,
  /\barchitecture\b/,
  /\bengineering\b/,
  /\bdesign\b/,
  /\bceqa\b/,
  /\benvironmental\b/,
  /\binspection\b/,
  /\bconstruction\b/,
  /\bconstruction management\b/,
  /\bprogram management\b/,
  /\bowner'?s rep\b/,
  /\bowner representative\b/,
  /\bproject controls?\b/,
  /\bspecialty inspection\b/,
  /\bimprovement(s)?\b/,
  /\brehabilitation\b/,
  /\brehab\b/,
  /\breplacement\b/,
  /\bupgrade(s)?\b/,
  /\broadway\b/,
  /\bpaving\b/,
  /\bpavement\b/,
  /\bsignal\b/,
  /\bsewer\b/,
  /\bwater\b/,
  /\bwastewater\b/,
  /\bpump\b/,
  /\breservoir\b/,
  /\bpark\b/,
  /\bfacilit(y|ies)\b/,
  /\bbuilding(s)?\b/,
  /\bhvac\b/,
  /\belectrical\b/,
  /\butility\b/,
  /\butilities\b/,
  /\bpipeline\b/,
  /\bsidewalk\b/,
  /\bbridge\b/,
  /\btraffic\b/,
  /\bschool modernization\b/,
  /\bmodernization\b/,
  /\brenovation\b/,
];

const CATEGORY_PATTERNS: Array<{
  reason: OpportunityTitleFilterReason;
  patterns: RegExp[];
}> = [
  {
    reason: "software_it",
    patterns: [
      /\bsplunk\b/,
      /\bsoftware\b/,
      /\bsaas\b/,
      /\berp\b/,
      /\bserver(s)?\b/,
      /\bdata query\b/,
      /\bcloud subscription\b/,
      /\blicense plate reader\b/,
      /\bvideo camera program\b/,
      /\binformation technology\b/,
      /\bit services?\b/,
    ],
  },
  {
    reason: "professional_services",
    patterns: [
      /\btax consulting\b/,
      /\bunderwriter services?\b/,
      /\bcollection services?\b/,
      /\bexecutive recruitment\b/,
      /\bfinancial consulting\b/,
      /\blegislative advocacy\b/,
      /\baudit services?\b/,
    ],
  },
  {
    reason: "food_services",
    patterns: [
      /\bfood products?\b/,
      /\bcatering\b/,
      /\bchicken products?\b/,
      /\bfood services?\b/,
      /\bmeal services?\b/,
    ],
  },
  {
    reason: "staffing_training",
    patterns: [
      /\bstaffing support\b/,
      /\bstaffing services?\b/,
      /\btraining services?\b/,
      /\beducational programs?\b/,
      /\bdj services?\b/,
      /\bphotobooth services?\b/,
      /\bphoto booth services?\b/,
    ],
  },
  {
    reason: "municipal_operations",
    patterns: [
      /\bjanitorial\b/,
      /\baviary operations?\b/,
      /\banimal care\b/,
      /\bfarmers market operations?\b/,
      /\btransit program operations?\b/,
      /\btowing services?\b/,
      /\bguard services?\b/,
    ],
  },
  {
    reason: "real_estate",
    patterns: [
      /\bsale of property\b/,
      /\breal estate services?\b/,
      /\bproperty consulting\b/,
      /\bbrokerage services?\b/,
    ],
  },
];

export const OPPORTUNITY_FILTER_REASON_LABELS: Record<OpportunityTitleFilterReason, string> = {
  software_it: "Software / IT",
  professional_services: "Professional Services",
  food_services: "Food Services",
  staffing_training: "Staffing / Training",
  municipal_operations: "Municipal Operations",
  real_estate: "Real Estate",
};

export function classifyOpportunityTitle(title: string | null | undefined): OpportunityTitleClassification {
  const normalized = normalize(title);
  if (!normalized) return { relevance: "high", reason: null };

  if (includesAny(normalized, CONSTRUCTION_ADJACENT_PATTERNS)) {
    return { relevance: "high", reason: null };
  }

  const matched = CATEGORY_PATTERNS.find(({ patterns }) => includesAny(normalized, patterns));
  if (!matched) return { relevance: "high", reason: null };

  return { relevance: "low", reason: matched.reason };
}
