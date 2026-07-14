import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOpportunityTab,
  isClosed,
  isCanonical,
  isGloballyExcluded,
  isAllTabMember,
  isAllTabFilteredOutMember,
  isSavedTabMember,
  isClosedTabMember,
  getCandidateCounty,
  OPPORTUNITY_TAB_ORDER,
} from "../src/lib/opportunityTabs.ts";

const FUTURE = new Date(Date.now() + 30 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 30 * 86_400_000).toISOString();

const openCandidate = (overrides: Record<string, unknown> = {}) => ({
  id: "cand-1",
  bid_due_at: FUTURE,
  raw_title: "Storm Drain Improvements",
  ingestion_status: "valid",
  ...overrides,
});

test("tab order is All · For You · Saved · Closed", () => {
  assert.deepEqual(OPPORTUNITY_TAB_ORDER.map((t) => t.value), ["all", "for-you", "saved", "closed"]);
});

test("missing and invalid ?tab= values fall back to for-you", () => {
  assert.equal(parseOpportunityTab(null), "for-you");
  assert.equal(parseOpportunityTab(undefined), "for-you");
  assert.equal(parseOpportunityTab(""), "for-you");
  assert.equal(parseOpportunityTab("bogus"), "for-you");
  assert.equal(parseOpportunityTab("ALL"), "for-you");
});

test("valid ?tab= values round-trip", () => {
  for (const tab of ["all", "for-you", "saved", "closed"] as const) {
    assert.equal(parseOpportunityTab(tab), tab);
  }
});

test("closed membership is due-date only", () => {
  assert.equal(isClosed({ bid_due_at: PAST }), true);
  assert.equal(isClosed({ bid_due_at: FUTURE }), false);
  assert.equal(isClosed({ bid_due_at: null }), false);
  assert.equal(isClosed({ bid_due_at: "not-a-date" }), false);
});

test("canonical record appears; non-canonical duplicate does not", () => {
  const canonical = openCandidate({ canonical_candidate_id: null });
  const selfCanonical = openCandidate({ canonical_candidate_id: "cand-1" });
  const duplicate = openCandidate({ canonical_candidate_id: "cand-999" });
  assert.equal(isCanonical(canonical as any), true);
  assert.equal(isCanonical(selfCanonical as any), true);
  assert.equal(isCanonical(duplicate as any), false);
  assert.equal(isAllTabMember(canonical as any), true);
  assert.equal(isAllTabMember(duplicate as any), false);
  assert.equal(isAllTabFilteredOutMember(duplicate as any), false);
});

test("a valid open opportunity is an All member regardless of any per-user input", () => {
  // isAllTabMember takes no profile and no qualification argument at all —
  // Bid Profile parameters and green/yellow/red qualification cannot affect it.
  const c = openCandidate({ county: "Alameda", auto_status: "red" });
  assert.equal(isAllTabMember(c as any), true);
});

test("globally excluded records leave the main grid and enter Filtered Out", () => {
  const excluded = openCandidate({ global_exclusion_reason: "Duplicate of Caltrans opportunity 04-1J7104" });
  assert.equal(isGloballyExcluded(excluded as any), true);
  assert.equal(isAllTabMember(excluded as any), false);
  assert.equal(isAllTabFilteredOutMember(excluded as any), true);
});

test("legacy global classifications are treated as global exclusions", () => {
  const legacy = openCandidate({ auto_status: "red", auto_status_reason: "Bid closed" });
  assert.equal(isGloballyExcluded(legacy as any), true);
});

test("user-specific red reasons never count as global exclusions", () => {
  const userRed = openCandidate({ auto_status: "red", auto_status_reason: "Location outside target counties (Alameda)" });
  assert.equal(isGloballyExcluded(userRed as any), false);
  assert.equal(isAllTabMember(userRed as any), true);
});

test("quarantined records appear nowhere", () => {
  const quarantined = openCandidate({ ingestion_status: "quarantined" });
  const placeholder = openCandidate({ raw_title: "  " });
  for (const c of [quarantined, placeholder]) {
    assert.equal(isAllTabMember(c as any), false);
    assert.equal(isAllTabFilteredOutMember(c as any), false);
    assert.equal(isSavedTabMember(c as any, new Set(["cand-1"])), false);
    assert.equal(isClosedTabMember({ ...c, bid_due_at: PAST } as any), false);
  }
});

test("closed records appear only under Closed", () => {
  const closed = openCandidate({ bid_due_at: PAST });
  assert.equal(isClosedTabMember(closed as any), true);
  assert.equal(isAllTabMember(closed as any), false);
  assert.equal(isSavedTabMember(closed as any, new Set(["cand-1"])), false);
});

test("closed membership ignores saved state and qualification", () => {
  const closedSaved = openCandidate({ bid_due_at: PAST, auto_status: "red" });
  assert.equal(isClosedTabMember(closedSaved as any), true);
});

test("saved membership is bookmark ∧ open", () => {
  const c = openCandidate();
  assert.equal(isSavedTabMember(c as any, new Set(["cand-1"])), true);
  assert.equal(isSavedTabMember(c as any, new Set(["other"])), false);
});

test("candidate county resolves from the normalized column with crawl fallback", () => {
  assert.equal(getCandidateCounty({ county: "Riverside" }), "Riverside");
  assert.equal(getCandidateCounty({ county: null, crawl_data: { county: " Orange " } }), "Orange");
  assert.equal(getCandidateCounty({ county: "  ", crawl_data: {} }), null);
  assert.equal(getCandidateCounty({}), null);
});
