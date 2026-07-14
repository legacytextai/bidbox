// Client-side viewed-state persistence for opportunity cards on /opportunities.
//
// Pre-meeting slice: no database migration for viewed state. Viewed candidate
// ids are stored in localStorage, namespaced by authenticated user id so two
// accounts on the same browser never share history. Only ids are stored
// (never candidate objects), most-recently-viewed last, capped so the payload
// stays bounded. A candidate becomes viewed only on deliberate activation of
// its project-detail path — never merely by rendering in the viewport.
//
// Storage access is injected so the logic is testable under node:test.

export interface ViewedStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const VIEWED_KEY_PREFIX = "bidbox:opportunities:viewed:v1:";

// Generous ceiling relative to current inventory; oldest entries are evicted
// first once exceeded.
export const MAX_VIEWED_IDS = 1000;

export function viewedStorageKey(userId: string): string {
  return `${VIEWED_KEY_PREFIX}${userId}`;
}

export function readViewedIds(storage: ViewedStorage, userId: string): string[] {
  try {
    const raw = storage.getItem(viewedStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    // Corrupt or inaccessible payloads degrade to "nothing viewed" — never
    // throw into the page.
    return [];
  }
}

export function addViewedId(storage: ViewedStorage, userId: string, candidateId: string): string[] {
  const existing = readViewedIds(storage, userId);
  const next = existing.filter((id) => id !== candidateId);
  next.push(candidateId);
  const capped = next.length > MAX_VIEWED_IDS ? next.slice(next.length - MAX_VIEWED_IDS) : next;
  try {
    storage.setItem(viewedStorageKey(userId), JSON.stringify(capped));
  } catch {
    // Quota/privacy-mode failures are non-fatal; in-memory state still updates.
  }
  return capped;
}
