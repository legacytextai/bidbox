export type GeographyMatchStatus =
  | "confirmed_match"
  | "probable_match"
  | "confirmed_outside"
  | "probable_outside"
  | "conflict"
  | "unresolved";

export type GeographyPopulation = "main" | "filtered" | "location_uncertain";

/**
 * Proposed v1 geography policy. This is intentionally not wired into the live
 * Opportunities query until the shadow accuracy gates are approved.
 */
export function proposedGeographyPopulation(
  status: GeographyMatchStatus | null | undefined,
  hasActiveQualification: boolean,
): GeographyPopulation {
  // Absence is an evaluation gap, never evidence of a match.
  if (!hasActiveQualification || !status || status === "conflict" || status === "unresolved") {
    return "location_uncertain";
  }
  if (status === "confirmed_outside" || status === "probable_outside") return "filtered";
  return "main";
}
