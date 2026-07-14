// Direct Bid Profile filtering for the For You tab.
//
// For You is governed by the two Bid Profile parameters that are operational
// today — geography (target_counties) and project size (min/max_project_value)
// from gc_qualification_profiles. Licensing and NAICS exist on the profile but
// do not participate in filtering and must not affect membership here.
// Green/yellow/red qualification output (user_opportunity_qualifications) is
// deliberately NOT consulted.
//
// Confirmed estimate definition — normalized, source-derived fields only:
//   - opportunity_candidates.estimated_value (single engineer estimate)
//   - opportunity_candidates.estimated_value_low / estimated_value_high
//     (estimate range)
// These OML columns are populated exclusively from portal crawl data
// (migrations 20260630200000 / 20260630214219), so their presence means the
// value came from the source portal. The single-value path reuses the
// canonical selection logic in opportunityDomain.resolveEstimatedValueRaw
// (crawl_data.estimated_value → opengov_visible_metadata.estimated_value →
// typed column). Values are never inferred from titles, descriptions, or
// category defaults; a candidate with none of these fields is "unpriced".

import { resolveEstimatedValueRaw } from "./opportunityDomain.ts";
import { getCandidateCounty, type TabCandidate } from "./opportunityTabs.ts";

export interface BidProfileParams {
  targetCounties: string[];
  minProjectValue: number | null;
  maxProjectValue: number | null;
}

export const EMPTY_BID_PROFILE: BidProfileParams = {
  targetCounties: [],
  minProjectValue: null,
  maxProjectValue: null,
};

export interface EstimateCandidate extends Pick<TabCandidate, "county" | "crawl_data"> {
  estimated_value?: number | null;
  estimated_value_low?: number | null;
  estimated_value_high?: number | null;
}

// A confirmed estimate expressed as an inclusive band. A single-value
// estimate is the degenerate band low === high. A one-sided range keeps the
// missing bound null (unknown in that direction).
export interface ConfirmedEstimate {
  low: number | null;
  high: number | null;
}

function usableValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

// Deterministic estimate resolution. An explicit low/high range takes
// precedence over the single value (it carries strictly more information);
// otherwise the canonical single-value selection applies.
export function resolveConfirmedEstimate(c: EstimateCandidate): ConfirmedEstimate | null {
  const low = usableValue(c.estimated_value_low) ?? usableValue(c.crawl_data?.estimated_value_low);
  const high = usableValue(c.estimated_value_high) ?? usableValue(c.crawl_data?.estimated_value_high);
  if (low !== null || high !== null) return { low, high };
  const single = usableValue(resolveEstimatedValueRaw(c.crawl_data, c.estimated_value ?? null));
  if (single !== null) return { low: single, high: single };
  return null;
}

export function isPriced(c: EstimateCandidate): boolean {
  return resolveConfirmedEstimate(c) !== null;
}

// Overlap rule: the confirmed estimate band matches when it overlaps the
// profile's [min, max] range. A missing profile bound is unbounded on that
// side; a missing estimate bound is unknown and does not exclude.
//   user 1M–5M vs estimate 2M–3M → match; 4M–7M → match; 6M–8M → no match.
export function estimateMatchesProjectSize(
  estimate: ConfirmedEstimate,
  minProjectValue: number | null,
  maxProjectValue: number | null,
): boolean {
  if (maxProjectValue !== null && estimate.low !== null && estimate.low > maxProjectValue) return false;
  if (minProjectValue !== null && estimate.high !== null && estimate.high < minProjectValue) return false;
  return true;
}

// Geography: case-insensitive county match against the profile's selected
// counties, mirroring the production qualify-candidates comparison. No
// selected counties → no geography restriction. When counties are selected,
// a candidate with no resolvable county is not a geography match.
export function matchesGeography(
  c: Pick<TabCandidate, "county" | "crawl_data">,
  targetCounties: string[],
): boolean {
  if (targetCounties.length === 0) return true;
  const county = getCandidateCounty(c);
  if (!county) return false;
  const normalized = county.toLowerCase();
  return targetCounties.some((tc) => tc.trim().toLowerCase() === normalized);
}

export type ForYouSection = "confirmed" | "unpriced";

// Section classification for a candidate that already passed the shared base
// membership (globally valid ∧ canonical ∧ open — see opportunityTabs.ts):
//   - null: outside the selected geography, or priced outside the selected
//     project-size range → not in For You at all.
//   - "confirmed": usable confirmed estimate within/overlapping the range
//     (or any confirmed estimate when no range is configured).
//   - "unpriced": geography match with no usable confirmed estimate. The
//     project-size range never excludes unpriced records — their size is
//     unknown, and the section copy must not imply a size match.
export function classifyForYouSection(
  c: EstimateCandidate,
  profile: BidProfileParams,
): ForYouSection | null {
  if (!matchesGeography(c, profile.targetCounties)) return null;
  const estimate = resolveConfirmedEstimate(c);
  if (estimate === null) return "unpriced";
  return estimateMatchesProjectSize(estimate, profile.minProjectValue, profile.maxProjectValue)
    ? "confirmed"
    : null;
}
