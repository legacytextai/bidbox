// Pure tab-membership predicates for the Opportunities page.
//
// Four distinct concepts, deliberately kept separate (do not conflate):
//   1. Bid Profile filtering — per-user parameters (geography, project size)
//      applied ONLY to the For You tab (see bidProfileMatching.ts). Never a
//      visibility rule for All.
//   2. Internal qualification output — user_opportunity_qualifications rows
//      (green/yellow/red). Surfaces only as the existing card-internal
//      "Filtered out" messaging; never tab membership.
//   3. Global validity — system artifacts invalid for everyone: quarantined
//      ingestion records, broken placeholders, records with a global
//      exclusion. Excluded from every tab's main grid; globally excluded
//      records surface in All's collapsed Filtered Out section.
//   4. Portal deduplication — a non-canonical duplicate (canonical_candidate_id
//      points at another record) never renders anywhere.
// Closed (bid_due_at in the past) moves a record to the Closed tab and is
// independent of everything above.
//
// The route container and the tab counts must both derive from these
// predicates so a badge count always equals the rendered membership.

import { getStoredFilterReasons, isQuarantined } from "./opportunityVisibility.ts";

export type OpportunityTab = "all" | "for-you" | "saved" | "closed";

// Rendered order is fixed by product decision: All · For You · Saved · Closed.
export const OPPORTUNITY_TAB_ORDER: { label: string; value: OpportunityTab }[] = [
  { label: "All", value: "all" },
  { label: "For You", value: "for-you" },
  { label: "Saved", value: "saved" },
  { label: "Closed", value: "closed" },
];

export const DEFAULT_OPPORTUNITY_TAB: OpportunityTab = "for-you";

// URL `?tab=` parsing: missing or invalid values always fall back to For You.
export function parseOpportunityTab(value: string | null | undefined): OpportunityTab {
  if (value === "all" || value === "for-you" || value === "saved" || value === "closed") {
    return value;
  }
  return DEFAULT_OPPORTUNITY_TAB;
}

export interface TabCandidate {
  id: string;
  bid_due_at: string | null;
  county?: string | null;
  crawl_data?: Record<string, unknown> | null;
  ingestion_status?: string | null;
  raw_title?: string | null;
  status?: string | null;
  auto_status?: string | null;
  auto_status_reason?: string | null;
  global_exclusion_code?: string | null;
  global_exclusion_reason?: string | null;
  canonical_candidate_id?: string | null;
}

export function isClosed(c: Pick<TabCandidate, "bid_due_at">): boolean {
  if (!c.bid_due_at) return false;
  const t = new Date(c.bid_due_at).getTime();
  return !isNaN(t) && t < Date.now();
}

export function isCanonical(c: Pick<TabCandidate, "id" | "canonical_candidate_id">): boolean {
  return !c.canonical_candidate_id || c.canonical_candidate_id === c.id;
}

// Global (everyone-sees-the-same) exclusion reasons. Passing no qualification
// and hasActiveQualifications=false restricts getStoredFilterReasons to its
// global branches: global_exclusion_reason, legacy global classifications, and
// the crawl-level duplicate flag. Per-user qualification branches cannot fire.
export function getGlobalFilterReasons(c: TabCandidate): string[] {
  return getStoredFilterReasons(c, undefined, false);
}

export function isGloballyExcluded(c: TabCandidate): boolean {
  return getGlobalFilterReasons(c).length > 0;
}

// A record eligible to render as a normal open opportunity somewhere on the
// page: not quarantined, canonical, and not past its bid due date.
export function isOpenInventory(c: TabCandidate): boolean {
  return !isQuarantined(c) && isCanonical(c) && !isClosed(c);
}

// All tab main grid: the true complete inventory. Globally valid, canonical,
// open. No per-user input of any kind.
export function isAllTabMember(c: TabCandidate): boolean {
  return isOpenInventory(c) && !isGloballyExcluded(c);
}

// All tab's collapsed Filtered Out section: globally excluded (for everyone)
// open records — the "why was this removed for everyone" view.
export function isAllTabFilteredOutMember(c: TabCandidate): boolean {
  return isOpenInventory(c) && isGloballyExcluded(c);
}

// Saved tab: user-bookmarked, open. Mirrors the pre-facelift rendered
// membership (quarantine hidden; no global-exclusion or dedup pruning beyond
// what existed before).
export function isSavedTabMember(c: TabCandidate, savedIds: ReadonlySet<string>): boolean {
  return !isQuarantined(c) && !isClosed(c) && savedIds.has(c.id);
}

// Closed tab: bid due date in the past, independent of profile, qualification,
// or saved state.
export function isClosedTabMember(c: TabCandidate): boolean {
  return !isQuarantined(c) && isClosed(c);
}

export function getCandidateCounty(c: Pick<TabCandidate, "county" | "crawl_data">): string | null {
  const v = c.county ?? c.crawl_data?.county;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
