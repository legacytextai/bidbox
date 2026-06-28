// Bid Readiness — domain model for the Project Workspace.
//
// M1 Foundation:
// - A fixed catalog of readiness items the estimator cares about per project.
// - Each item carries a *derived* status (what the system detected from
//   Opportunity Intelligence findings) and a *manual* status (what the
//   estimator explicitly confirmed).
// - The UI consumes EffectiveReadiness, which collapses derived + manual into
//   one of three estimator-facing labels: Ready / Not Ready / Needs Review.

import type { DossierFinding } from "@/hooks/useOpportunityDossier";

// ─── Stored statuses ─────────────────────────────────────────────────────────

export type DerivedStatus = "unknown" | "detected" | "missing" | "conflicting";
export type ManualStatus = "unset" | "needs_review" | "confirmed";

// ─── Effective (UI-facing) status ────────────────────────────────────────────

export type EffectiveStatus = "ready" | "not_ready" | "needs_review";

export const EFFECTIVE_LABEL: Record<EffectiveStatus, string> = {
  ready: "Ready",
  not_ready: "Not Ready",
  needs_review: "Needs Review",
};

// Tailwind class set for badge rendering. Kept here so the UI never invents
// readiness colors of its own.
export const EFFECTIVE_BADGE_CLASS: Record<EffectiveStatus, string> = {
  ready: "bg-green-50 text-green-700 border-green-200",
  not_ready: "bg-red-50 text-red-700 border-red-200",
  needs_review: "bg-amber-50 text-amber-700 border-amber-200",
};

// ─── Catalog ─────────────────────────────────────────────────────────────────

export interface ReadinessItemDef {
  key: string;
  label: string;
  description: string;
  // Tokens used to match intelligence findings (lowercased, substring match
  // against field_key / category / label).
  matchTokens: string[];
}

export const READINESS_CATALOG: ReadinessItemDef[] = [
  {
    key: "bid_bond",
    label: "Bid Bond",
    description: "Bid security or bid bond requirement.",
    matchTokens: ["bid_bond", "bid bond", "bid security"],
  },
  {
    key: "performance_bond",
    label: "Performance Bond",
    description: "Performance bond requirement.",
    matchTokens: ["performance_bond", "performance bond"],
  },
  {
    key: "payment_bond",
    label: "Payment Bond",
    description: "Labor & material / payment bond requirement.",
    matchTokens: ["payment_bond", "payment bond", "labor and material"],
  },
  {
    key: "license_class",
    label: "Contractor License",
    description: "Required contractor license class(es).",
    matchTokens: ["license", "contractor_license", "license_class"],
  },
  {
    key: "prevailing_wage",
    label: "Prevailing Wage / DIR",
    description: "Prevailing wage and DIR registration requirement.",
    matchTokens: ["prevailing_wage", "prevailing wage", "dir"],
  },
  {
    key: "insurance",
    label: "Insurance",
    description: "Insurance coverage requirements.",
    matchTokens: ["insurance"],
  },
  {
    key: "job_walk",
    label: "Job Walk / Pre-Bid Meeting",
    description: "Pre-bid meeting or mandatory job walk.",
    matchTokens: ["job_walk", "job walk", "pre_bid", "pre-bid", "prebid"],
  },
  {
    key: "addenda",
    label: "Addenda Acknowledgment",
    description: "Acknowledgment of all issued addenda.",
    matchTokens: ["addenda", "addendum"],
  },
  {
    key: "bid_forms",
    label: "Bid Forms / Bid Schedule",
    description: "Required bid forms and bid schedule complete.",
    matchTokens: ["bid_form", "bid form", "bid schedule", "bid_schedule"],
  },
  {
    key: "submission_format",
    label: "Submission Format",
    description: "How and where the sealed/online bid is submitted.",
    matchTokens: ["submission", "submit", "delivery_method", "sealed"],
  },
];

// ─── Derivation from findings ────────────────────────────────────────────────

const STATUS_NEGATIVE = new Set([
  "missing",
  "not_found",
  "not_required",
  "not_applicable",
  "n_a",
  "na",
  "absent",
]);

function findingMatches(item: ReadinessItemDef, finding: DossierFinding): boolean {
  const haystack = `${finding.field_key ?? ""} ${finding.category ?? ""} ${finding.label ?? ""}`.toLowerCase();
  return item.matchTokens.some((tok) => haystack.includes(tok));
}

function normalizeValue(finding: DossierFinding): string | null {
  if (finding.value_text && finding.value_text.trim().length > 0) {
    return finding.value_text.trim().toLowerCase();
  }
  if (finding.value_jsonb != null) {
    try {
      return JSON.stringify(finding.value_jsonb).toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

export function deriveItemStatus(
  item: ReadinessItemDef,
  findings: DossierFinding[],
): DerivedStatus {
  const matches = findings.filter((f) => findingMatches(item, f));
  if (matches.length === 0) return "unknown";

  const values = new Set<string>();
  let anyPositive = false;
  let anyNegative = false;

  for (const m of matches) {
    const status = (m.status ?? "").toLowerCase();
    const v = normalizeValue(m);

    if (STATUS_NEGATIVE.has(status)) {
      anyNegative = true;
      continue;
    }
    if (v) {
      values.add(v);
      anyPositive = true;
    } else if (status === "available" || status === "confirmed") {
      anyPositive = true;
    }
  }

  if (anyPositive && anyNegative) return "conflicting";
  if (values.size > 1) return "conflicting";
  if (anyPositive) return "detected";
  if (anyNegative) return "missing";
  return "unknown";
}

// ─── Effective status mapping ────────────────────────────────────────────────
//
// Estimator-facing question: "Can I bid this?"
//
// Manual confirmation always wins:
//   confirmed     → Ready
//   needs_review  → Needs Review
//
// Otherwise derived state maps as:
//   detected      → Ready
//   missing       → Not Ready
//   conflicting   → Needs Review
//   unknown       → Needs Review

export function effectiveStatus(
  derived: DerivedStatus,
  manual: ManualStatus,
): EffectiveStatus {
  if (manual === "confirmed") return "ready";
  if (manual === "needs_review") return "needs_review";
  switch (derived) {
    case "detected":
      return "ready";
    case "missing":
      return "not_ready";
    case "conflicting":
    case "unknown":
    default:
      return "needs_review";
  }
}

// ─── Row shape persisted in `project_readiness_items` ────────────────────────

export interface ReadinessItemRow {
  id: string;
  project_id: string;
  key: string;
  derived_status: DerivedStatus;
  manual_status: ManualStatus;
  derived_source: unknown | null;
  notes: string | null;
  updated_at: string;
}

// ─── Composed view consumed by the UI ────────────────────────────────────────

export interface ReadinessItemView {
  def: ReadinessItemDef;
  derived: DerivedStatus;
  manual: ManualStatus;
  effective: EffectiveStatus;
  notes: string | null;
  // Findings that contributed to derivation, for the evidence panel.
  evidence: DossierFinding[];
}

export function composeReadinessView(
  def: ReadinessItemDef,
  findings: DossierFinding[],
  row: ReadinessItemRow | null,
): ReadinessItemView {
  const evidence = findings.filter((f) => findingMatches(def, f));
  const derived = deriveItemStatus(def, findings);
  const manual = row?.manual_status ?? "unset";
  return {
    def,
    derived,
    manual,
    effective: effectiveStatus(derived, manual),
    notes: row?.notes ?? null,
    evidence,
  };
}

// ─── Summary for the workspace header ────────────────────────────────────────

export interface ReadinessSummary {
  total: number;
  ready: number;
  notReady: number;
  needsReview: number;
}

export function summarizeReadiness(items: ReadinessItemView[]): ReadinessSummary {
  const summary: ReadinessSummary = { total: items.length, ready: 0, notReady: 0, needsReview: 0 };
  for (const item of items) {
    if (item.effective === "ready") summary.ready += 1;
    else if (item.effective === "not_ready") summary.notReady += 1;
    else summary.needsReview += 1;
  }
  return summary;
}
