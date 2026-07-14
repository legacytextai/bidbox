import test from "node:test";
import assert from "node:assert/strict";
import { getStoredFilterReasons, isQuarantined, NOT_YET_EVALUATED_REASON } from "../src/lib/opportunityVisibility.ts";

test("stored global duplicate reason wins over user qualification", () => {
  assert.deepEqual(getStoredFilterReasons({
    global_exclusion_reason: "Duplicate of Caltrans opportunity 04-1J7104",
  }, {
    status: "red", primary_reason: "Location outside target counties (Alameda)", reasons: [],
  }), ["Duplicate of Caltrans opportunity 04-1J7104"]);
});

test("user-specific county mismatch is scoped to the supplied user result", () => {
  const candidate = { auto_status: "red", auto_status_reason: "Location outside target counties (Alameda)" };
  assert.deepEqual(getStoredFilterReasons(candidate, null), []);
  assert.deepEqual(getStoredFilterReasons(candidate, {
    status: "red", primary_reason: "Location outside target counties (Alameda)",
    reasons: ["Location outside target counties (Alameda)"],
  }), ["Location outside target counties (Alameda)"]);
});

test("new account with no qualification sees globally valid opportunities", () => {
  assert.deepEqual(getStoredFilterReasons({ raw_title: "Valid paving project" }, null), []);
});

test("yellow qualification stays visible", () => {
  const reasons = getStoredFilterReasons(
    { raw_title: "Road improvement", ingestion_status: "valid" },
    { status: "yellow", primary_reason: "Value not determinable", reasons: ["Value not determinable"] },
  );
  assert.deepEqual(reasons, []);
});

test("missing qualification row fails closed when the user has active results", () => {
  const candidate = { raw_title: "Road improvement", ingestion_status: "valid" };
  assert.deepEqual(
    getStoredFilterReasons(candidate, null, true),
    [NOT_YET_EVALUATED_REASON],
  );
  assert.deepEqual(
    getStoredFilterReasons(candidate, undefined, true),
    [NOT_YET_EVALUATED_REASON],
  );
});

test("missing qualification row stays visible for accounts without results", () => {
  const candidate = { raw_title: "Road improvement", ingestion_status: "valid" };
  assert.deepEqual(getStoredFilterReasons(candidate, null, false), []);
  assert.deepEqual(getStoredFilterReasons(candidate, null), []);
});

test("converted candidates are never failed closed by a missing row", () => {
  // Rebuilds only evaluate pending candidates; a converted (on-calendar)
  // candidate legitimately has no qualification row and must stay visible.
  assert.deepEqual(
    getStoredFilterReasons({ raw_title: "Tracked project", ingestion_status: "valid", status: "converted" }, null, true),
    [],
  );
  assert.deepEqual(
    getStoredFilterReasons({ raw_title: "Pending project", ingestion_status: "valid", status: "pending" }, null, true),
    [NOT_YET_EVALUATED_REASON],
  );
});

test("evaluated rows are unaffected by the fail-closed flag", () => {
  const candidate = { raw_title: "Road improvement", ingestion_status: "valid" };
  assert.deepEqual(
    getStoredFilterReasons(candidate, { status: "green", primary_reason: "No disqualifying flags", reasons: [] }, true),
    [],
  );
  assert.deepEqual(
    getStoredFilterReasons(candidate, { status: "red", primary_reason: "County not verified — cannot confirm location within target counties (Riverside)", reasons: ["County not verified — cannot confirm location within target counties (Riverside)"] }, true),
    ["County not verified — cannot confirm location within target counties (Riverside)"],
  );
});

test("incomplete ingestion artifacts are quarantined, not user-filtered", () => {
  assert.equal(isQuarantined({ ingestion_status: "quarantined", raw_title: null }), true);
  assert.equal(isQuarantined({ ingestion_status: "valid", raw_title: "Road paving" }), false);
});
