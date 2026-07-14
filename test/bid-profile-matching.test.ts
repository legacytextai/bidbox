import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfirmedEstimate,
  isPriced,
  estimateMatchesProjectSize,
  matchesGeography,
  classifyForYouSection,
  EMPTY_BID_PROFILE,
  type BidProfileParams,
} from "../src/lib/bidProfileMatching.ts";

const M = 1_000_000;

const profile = (overrides: Partial<BidProfileParams> = {}): BidProfileParams => ({
  ...EMPTY_BID_PROFILE,
  ...overrides,
});

// --- Geography -------------------------------------------------------------

test("selected county includes matching opportunity (case-insensitive)", () => {
  assert.equal(matchesGeography({ county: "Riverside" }, ["Riverside"]), true);
  assert.equal(matchesGeography({ county: "riverside" }, ["Riverside"]), true);
  assert.equal(matchesGeography({ county: "Riverside" }, ["Los Angeles", "riverside "]), true);
});

test("selected county excludes nonmatching opportunity", () => {
  assert.equal(matchesGeography({ county: "Kern" }, ["Riverside"]), false);
});

test("selected counties exclude opportunities with no resolvable county", () => {
  assert.equal(matchesGeography({ county: null }, ["Riverside"]), false);
});

test("no selected county imposes no geography restriction", () => {
  assert.equal(matchesGeography({ county: "Kern" }, []), true);
  assert.equal(matchesGeography({ county: null }, []), true);
});

// --- Confirmed estimate resolution ------------------------------------------

test("normalized single estimate resolves as a degenerate band", () => {
  assert.deepEqual(resolveConfirmedEstimate({ estimated_value: 2 * M }), { low: 2 * M, high: 2 * M });
});

test("crawl-level estimate resolves through the canonical selection logic", () => {
  assert.deepEqual(
    resolveConfirmedEstimate({ crawl_data: { estimated_value: 3 * M } }),
    { low: 3 * M, high: 3 * M },
  );
  assert.deepEqual(
    resolveConfirmedEstimate({ crawl_data: { opengov_visible_metadata: { estimated_value: 4 * M } } }),
    { low: 4 * M, high: 4 * M },
  );
});

test("explicit low/high range takes precedence over the single value", () => {
  assert.deepEqual(
    resolveConfirmedEstimate({ estimated_value: 9 * M, estimated_value_low: 2 * M, estimated_value_high: 3 * M }),
    { low: 2 * M, high: 3 * M },
  );
});

test("no normalized estimate means unpriced — values are never invented", () => {
  assert.equal(resolveConfirmedEstimate({}), null);
  assert.equal(resolveConfirmedEstimate({ crawl_data: { title: "Big $5M project" } }), null);
  assert.equal(resolveConfirmedEstimate({ estimated_value: 0 }), null);
  assert.equal(resolveConfirmedEstimate({ estimated_value: -5 }), null);
  assert.equal(isPriced({}), false);
  assert.equal(isPriced({ estimated_value: 1 * M }), true);
});

// --- Project-size matching ---------------------------------------------------

const band = (low: number | null, high: number | null) => ({ low, high });

test("confirmed single estimate inside range is included", () => {
  assert.equal(estimateMatchesProjectSize(band(2 * M, 2 * M), 1 * M, 5 * M), true);
});

test("confirmed single estimate outside range is excluded", () => {
  assert.equal(estimateMatchesProjectSize(band(6 * M, 6 * M), 1 * M, 5 * M), false);
  assert.equal(estimateMatchesProjectSize(band(0.5 * M, 0.5 * M), 1 * M, 5 * M), false);
});

test("range overlap rule matches the specification examples", () => {
  // User range $1M–$5M
  assert.equal(estimateMatchesProjectSize(band(2 * M, 3 * M), 1 * M, 5 * M), true);
  assert.equal(estimateMatchesProjectSize(band(4 * M, 7 * M), 1 * M, 5 * M), true);
  assert.equal(estimateMatchesProjectSize(band(6 * M, 8 * M), 1 * M, 5 * M), false);
});

test("minimum-only profile works", () => {
  assert.equal(estimateMatchesProjectSize(band(2 * M, 2 * M), 1 * M, null), true);
  assert.equal(estimateMatchesProjectSize(band(0.5 * M, 0.5 * M), 1 * M, null), false);
  assert.equal(estimateMatchesProjectSize(band(1 * M, 1 * M), 1 * M, null), true); // inclusive
});

test("maximum-only profile works", () => {
  assert.equal(estimateMatchesProjectSize(band(2 * M, 2 * M), null, 5 * M), true);
  assert.equal(estimateMatchesProjectSize(band(6 * M, 6 * M), null, 5 * M), false);
  assert.equal(estimateMatchesProjectSize(band(5 * M, 5 * M), null, 5 * M), true); // inclusive
});

test("empty project-size range permits every confirmed estimate", () => {
  assert.equal(estimateMatchesProjectSize(band(1, 1), null, null), true);
  assert.equal(estimateMatchesProjectSize(band(900 * M, 900 * M), null, null), true);
});

// --- For You section classification ------------------------------------------

const CONFIGURED: BidProfileParams = profile({
  targetCounties: ["Riverside"],
  minProjectValue: 1 * M,
  maxProjectValue: 5 * M,
});

const constructionCandidate = (overrides: Record<string, unknown> = {}) => ({
  raw_title: "Building renovation and site improvements",
  ...overrides,
});

test("geography + size configured: priced-in-range → confirmed section", () => {
  assert.equal(
    classifyForYouSection(constructionCandidate({ county: "Riverside", estimated_value: 2 * M }), CONFIGURED),
    "confirmed",
  );
});

test("geography + size configured: priced-outside-range → excluded from For You entirely", () => {
  assert.equal(
    classifyForYouSection(constructionCandidate({ county: "Riverside", estimated_value: 9 * M }), CONFIGURED),
    null,
  );
});

test("geography + size configured: unpriced geography match → unpriced section, size never excludes it", () => {
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Riverside" }), CONFIGURED), "unpriced");
});

test("unpriced non-geography match is excluded when counties are selected", () => {
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Kern" }), CONFIGURED), null);
  assert.equal(classifyForYouSection(constructionCandidate({ county: null }), CONFIGURED), null);
});

test("geography only (no size range): any confirmed estimate in geography → confirmed", () => {
  const geoOnly = profile({ targetCounties: ["Riverside"] });
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Riverside", estimated_value: 90 * M }), geoOnly), "confirmed");
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Riverside" }), geoOnly), "unpriced");
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Kern", estimated_value: 2 * M }), geoOnly), null);
});

test("size only (no geography): any geography, estimate governs the section", () => {
  const sizeOnly = profile({ minProjectValue: 1 * M, maxProjectValue: 5 * M });
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Kern", estimated_value: 2 * M }), sizeOnly), "confirmed");
  assert.equal(classifyForYouSection(constructionCandidate({ county: null, estimated_value: 9 * M }), sizeOnly), null);
  assert.equal(classifyForYouSection(constructionCandidate({ county: null }), sizeOnly), "unpriced");
});

test("entirely empty profile: every construction record classifies as confirmed or unpriced", () => {
  assert.equal(classifyForYouSection(constructionCandidate({ county: "Kern", estimated_value: 2 * M }), EMPTY_BID_PROFILE), "confirmed");
  assert.equal(classifyForYouSection(constructionCandidate({ county: null }), EMPTY_BID_PROFILE), "unpriced");
});

test("construction gate runs before the priced/unpriced split", () => {
  assert.equal(
    classifyForYouSection({ county: "Riverside", raw_title: "Software subscription", estimated_value: 2 * M }, CONFIGURED),
    null,
  );
  assert.equal(
    classifyForYouSection({ county: "Riverside", raw_title: "Software subscription" }, CONFIGURED),
    null,
  );
});
