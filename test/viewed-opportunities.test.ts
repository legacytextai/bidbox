import test from "node:test";
import assert from "node:assert/strict";
import {
  addViewedId,
  readViewedIds,
  viewedStorageKey,
  MAX_VIEWED_IDS,
  type ViewedStorage,
} from "../src/lib/viewedOpportunities.ts";

const makeStorage = (initial: Record<string, string> = {}): ViewedStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
};

test("marking a candidate viewed persists across a fresh read (refresh survival)", () => {
  const storage = makeStorage();
  addViewedId(storage, "user-a", "cand-1");
  assert.deepEqual(readViewedIds(storage, "user-a"), ["cand-1"]);
  // Simulate a new session reading the same storage payload.
  const rehydrated = makeStorage(Object.fromEntries(storage.data));
  assert.deepEqual(readViewedIds(rehydrated, "user-a"), ["cand-1"]);
});

test("viewed ids are stored as ids only and deduped, most recent last", () => {
  const storage = makeStorage();
  addViewedId(storage, "user-a", "cand-1");
  addViewedId(storage, "user-a", "cand-2");
  addViewedId(storage, "user-a", "cand-1");
  assert.deepEqual(readViewedIds(storage, "user-a"), ["cand-2", "cand-1"]);
});

test("different authenticated users never share viewed-state storage", () => {
  const storage = makeStorage();
  addViewedId(storage, "user-a", "cand-1");
  assert.deepEqual(readViewedIds(storage, "user-b"), []);
  assert.notEqual(viewedStorageKey("user-a"), viewedStorageKey("user-b"));
});

test("payload stays capped", () => {
  const storage = makeStorage();
  for (let i = 0; i < MAX_VIEWED_IDS + 25; i++) {
    addViewedId(storage, "user-a", `cand-${i}`);
  }
  const ids = readViewedIds(storage, "user-a");
  assert.equal(ids.length, MAX_VIEWED_IDS);
  // Oldest entries evicted first; the most recent id is retained.
  assert.equal(ids[ids.length - 1], `cand-${MAX_VIEWED_IDS + 24}`);
  assert.equal(ids.includes("cand-0"), false);
});

test("corrupt or foreign payloads degrade to empty, never throw", () => {
  const key = viewedStorageKey("user-a");
  assert.deepEqual(readViewedIds(makeStorage({ [key]: "not json {" }), "user-a"), []);
  assert.deepEqual(readViewedIds(makeStorage({ [key]: '{"a":1}' }), "user-a"), []);
  assert.deepEqual(readViewedIds(makeStorage({ [key]: '["ok", 42, null]' }), "user-a"), ["ok"]);
});

test("storage write failures are non-fatal and still return the updated set", () => {
  const storage: ViewedStorage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota exceeded");
    },
  };
  assert.deepEqual(addViewedId(storage, "user-a", "cand-1"), ["cand-1"]);
});
