export interface StoredQualification {
  status: "red" | "yellow" | "green";
  primary_reason: string;
  reasons: string[];
}

export interface VisibilityCandidate {
  auto_status?: string | null;
  auto_status_reason?: string | null;
  crawl_data?: Record<string, unknown> | null;
  global_exclusion_code?: string | null;
  global_exclusion_reason?: string | null;
  ingestion_status?: string | null;
  ingestion_issue_reason?: string | null;
  raw_title?: string | null;
  // Triage status: qualification rebuilds only evaluate "pending" candidates,
  // so only pending candidates can have a legitimate evaluation gap.
  status?: string | null;
}

const LEGACY_GLOBAL_REASONS = [
  /^Duplicate of Caltrans(?:-native)? opportunity/i,
  /^Bid closed$/i,
  /^Non-public-works /i,
  /^Municipal operations outside construction scope$/i,
  /^Unsupported opportunity type$/i,
  /^Archived opportunity$/i,
];

export function isQuarantined(candidate: VisibilityCandidate): boolean {
  if (candidate.ingestion_status === "quarantined") return true;
  // Compatibility for pre-migration PlanetBids artifacts. New rows receive an
  // authoritative ingestion_status/reason in the worker.
  return !String(candidate.raw_title ?? "").trim();
}

export const NOT_YET_EVALUATED_REASON =
  "Not yet evaluated against your Bid Profile";

export function getStoredFilterReasons(
  candidate: VisibilityCandidate,
  qualification?: StoredQualification | null,
  // Pass true when the viewer has an active qualification result set. A
  // candidate with no row in that set is an evaluation gap and must fail
  // closed (filtered), never render as a profile match. Defaults to false so
  // accounts without a Bid Profile keep seeing the globally valid inventory.
  hasActiveQualifications = false,
): string[] {
  if (candidate.global_exclusion_reason) return [candidate.global_exclusion_reason];

  const crawl = candidate.crawl_data ?? {};
  if (crawl.duplicate_of_caltrans === true && candidate.auto_status_reason) {
    return [candidate.auto_status_reason];
  }

  // Read-only compatibility for globally classified rows created before the
  // dedicated global columns. User-specific legacy reasons are intentionally
  // excluded so one account cannot inherit another account's profile result.
  if (
    candidate.auto_status === "red" &&
    candidate.auto_status_reason &&
    LEGACY_GLOBAL_REASONS.some((pattern) => pattern.test(candidate.auto_status_reason!))
  ) {
    return [candidate.auto_status_reason];
  }

  if (qualification?.status === "red") {
    const reasons = qualification.reasons?.filter(Boolean) ?? [];
    return reasons.length ? reasons : [qualification.primary_reason];
  }

  // Converted or manually triaged candidates are explicit user decisions and
  // are intentionally outside the rebuild's scope — never fail them closed.
  if (hasActiveQualifications && !qualification && (candidate.status ?? "pending") === "pending") {
    return [NOT_YET_EVALUATED_REASON];
  }
  return [];
}
