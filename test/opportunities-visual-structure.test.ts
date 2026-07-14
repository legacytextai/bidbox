import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/pages/Opportunities.tsx", import.meta.url), "utf8");

test("Unpriced section owns distinct section chrome outside its card grid", () => {
  const section = source.indexOf('data-testid="unpriced-opportunities-section"');
  const header = source.indexOf('data-testid="unpriced-opportunities-section-header"', section);
  const grid = source.indexOf('data-testid="unpriced-opportunities-card-grid"', section);
  const cards = source.indexOf("tabLists.forYouUnpriced.map", grid);
  assert.ok(section >= 0);
  assert.ok(header > section);
  assert.ok(grid > header);
  assert.ok(cards > grid);
  assert.match(source.slice(section, header), /bg-slate-100\/80/);
  assert.match(source.slice(section, header), /border-t-4/);
});

test("Confirmed section stays before and outside the contrasting Unpriced wrapper", () => {
  const confirmed = source.indexOf('title="Confirmed Price Matches"');
  const unpriced = source.indexOf('data-testid="unpriced-opportunities-section"');
  assert.ok(confirmed >= 0 && confirmed < unpriced);
  assert.doesNotMatch(source.slice(confirmed, unpriced), /bg-slate-100\/80/);
});

test("Unpriced empty state describes the post-construction population", () => {
  assert.match(
    source,
    /No unpriced construction opportunities currently match your selected geography\./,
  );
});
