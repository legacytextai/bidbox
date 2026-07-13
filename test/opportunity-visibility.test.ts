import test from "node:test";
import assert from "node:assert/strict";
import { getStoredFilterReasons, isQuarantined } from "../src/lib/opportunityVisibility.ts";

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

test("incomplete ingestion artifacts are quarantined, not user-filtered", () => {
  assert.equal(isQuarantined({ ingestion_status: "quarantined", raw_title: null }), true);
  assert.equal(isQuarantined({ ingestion_status: "valid", raw_title: "Road paving" }), false);
});
