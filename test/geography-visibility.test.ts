import test from "node:test";
import assert from "node:assert/strict";
import { proposedGeographyPopulation } from "../src/lib/geographyVisibility.ts";

test("a missing qualification row is never treated as a confirmed match", () => {
  assert.equal(proposedGeographyPopulation("confirmed_match", false), "location_uncertain");
  assert.equal(proposedGeographyPopulation(null, false), "location_uncertain");
});

test("approved match, outside, and uncertain states form separate populations", () => {
  assert.equal(proposedGeographyPopulation("probable_match", true), "main");
  assert.equal(proposedGeographyPopulation("confirmed_outside", true), "filtered");
  assert.equal(proposedGeographyPopulation("conflict", true), "location_uncertain");
  assert.equal(proposedGeographyPopulation("unresolved", true), "location_uncertain");
});
