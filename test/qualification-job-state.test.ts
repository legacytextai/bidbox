import test from "node:test";
import assert from "node:assert/strict";
import { isJobForCurrentProfileVersion, isQualificationUpdating } from "../src/lib/qualificationJobState.ts";

test("old queued profile versions cannot keep the banner active", () => {
  const profile = { id: "profile-1", profile_version: 3 };
  assert.equal(isJobForCurrentProfileVersion(profile, {
    bid_profile_id: "profile-1", profile_version: 2, status: "running",
  }), false);
  assert.equal(isJobForCurrentProfileVersion(profile, {
    bid_profile_id: "profile-1", profile_version: 3, status: "complete",
  }), true);
});

test("only queued and running jobs activate the update banner", () => {
  assert.equal(isQualificationUpdating("queued"), true);
  assert.equal(isQualificationUpdating("running"), true);
  assert.equal(isQualificationUpdating("complete"), false);
  assert.equal(isQualificationUpdating("failed"), false);
  assert.equal(isQualificationUpdating("superseded"), false);
});
