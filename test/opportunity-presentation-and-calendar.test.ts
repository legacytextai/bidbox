import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const opportunities = readFileSync(new URL("../src/pages/Opportunities.tsx", import.meta.url), "utf8");
const report = readFileSync(new URL("../src/pages/OpportunityReport.tsx", import.meta.url), "utf8");

test("All main, Filtered Out, and other tabs pass explicit card-reason contexts", () => {
  assert.match(opportunities, /activeTab === "all" \? "all-main" : activeTab/);
  assert.match(opportunities, /renderCandidateCard\(c, undefined, "all-filtered"\)/);
  assert.match(opportunities, /renderCandidateCard\(c, forYouNavIds, "for-you"\)/);
});

test("Add to Calendar keeps successful opportunity actions on the current route", () => {
  const handlerStart = report.indexOf("const handleAddToCalendar = async () => {");
  const handlerEnd = report.indexOf("  const handleToggleSaved", handlerStart);
  const handler = report.slice(handlerStart, handlerEnd);

  assert.doesNotMatch(handler, /navigate\(`\/projects\/\$\{(?:existing|recovered|project)\.id\}`\)/);
  assert.doesNotMatch(handler, /navigate\("\/auth"\)/);
  assert.match(handler, /title: "Added to Calendar"/);
  assert.match(handler, /title: "Failed to add"/);
});
