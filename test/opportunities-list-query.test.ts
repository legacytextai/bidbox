import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/Opportunities.tsx", import.meta.url), "utf8");
const select = source.slice(source.indexOf("const OPPORTUNITY_LIST_SELECT"), source.indexOf("function withTimeout"));

test("Opportunities loads the bounded solicitation identifier but not full crawl_data", () => {
  assert.match(select, /\n\s*portal_bid_id,/);
  assert.doesNotMatch(select, /\n\s*crawl_data,/);
});
