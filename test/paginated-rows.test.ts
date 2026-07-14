import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "../src/lib/paginatedRows.ts";

test("loads every qualification when the result exceeds Supabase's 1,000-row cap", async () => {
  const source = Array.from({ length: 1_712 }, (_, index) => ({ id: `candidate-${index}` }));
  const ranges: Array<[number, number]> = [];
  const rows = await fetchAllPages(async (from, to) => {
    ranges.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.equal(rows.length, 1_712);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]]);
  assert.equal(rows.at(-1)?.id, "candidate-1711");
});

test("does not return a partial qualification map when a later page fails", async () => {
  await assert.rejects(
    fetchAllPages(async (from) => from === 0
      ? { data: Array.from({ length: 1_000 }, (_, id) => ({ id })), error: null }
      : { data: null, error: { message: "second page unavailable" } }),
    /second page unavailable/,
  );
});
