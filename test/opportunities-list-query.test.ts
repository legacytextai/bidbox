import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/Opportunities.tsx", import.meta.url), "utf8");
const select = source.slice(source.indexOf("const OPPORTUNITY_LIST_SELECT"), source.indexOf("function withTimeout"));

test("Opportunities loads the bounded solicitation identifier but not full crawl_data", () => {
  assert.match(select, /\n\s*portal_bid_id,/);
  assert.doesNotMatch(select, /\n\s*crawl_data,/);
});

test("Opportunities list select retains classifier + hardening inputs", () => {
  // Explicit keeps: For You construction classifier, LA Metro hardening, and
  // list-view surface reads. Removing any of these silently breaks
  // classifyForYouSection / bidProfileMatching / visibility predicates.
  const required = [
    "portal_summary",
    "scope_text",
    "required_licenses",
    "required_naics",
    "agency",
    "county",
    "bid_due_at",
    "estimated_value",
    "estimated_value_low",
    "estimated_value_high",
    "ingestion_status",
    "global_exclusion_code",
    "canonical_candidate_id",
    "qualification_score",
    "qualified_at",
    "auto_status",
    "auto_status_reason",
  ];
  for (const col of required) {
    assert.match(select, new RegExp(`\\n\\s*${col},?`), `missing required column: ${col}`);
  }
});

test("Opportunities list select drops fields the list view never reads", () => {
  // Field-usage inventory (docs/perf/2026-07-14-opportunity-list-field-usage.md)
  // confirmed zero list-view consumers. Detail page re-fetches these on demand.
  const removed = [
    "analysis_task_id",
    "opportunity_intelligence_task_id",
    "analysis_requested_at",
    "analysis_started_at",
    "analysis_completed_at",
    "document_acquisition_started_at",
    "document_acquisition_completed_at",
    "document_processing_started_at",
    "document_processing_completed_at",
    "analysis_error",
    "document_acquisition_error",
    "document_processing_error",
  ];
  for (const col of removed) {
    assert.doesNotMatch(
      select,
      new RegExp(`\\n\\s*${col},?`),
      `column should be removed from list select: ${col}`,
    );
  }
});
