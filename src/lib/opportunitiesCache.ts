// Stale-while-revalidate cache for the Opportunities page.
//
// Two independent, in-memory caches so late-arriving revalidations for one
// slice never clobber unrelated local edits in another:
//
//   * candidatesCache — single global entry keyed by the SELECT signature
//     (`CACHE_VERSION`). Bumped whenever `OPPORTUNITY_LIST_SELECT` shape
//     changes so a stale cached row shape can never be resurrected.
//
//   * userSideCache — user-scoped slices (saved, pursuits, qualification,
//     bid profile). Namespaced by `user.id` so an account switch cannot
//     hand one account another account's private state.
//
// On logout / account switch the auth listener already clears sessionStorage;
// we ALSO drop both caches so the next mount does a fresh fetch. Dirty-bit
// tracking lives in the page component: local writes flip a dirty flag which
// suppresses the corresponding slice write for the remainder of the load.

import type { PursuitLite } from "@/lib/tenant";
import type { BidProfileParams } from "@/lib/bidProfileMatching";
import type { StoredQualification } from "@/lib/opportunityVisibility";
import type { Candidate } from "@/components/opportunities/types";
import { supabase } from "@/integrations/supabase/client";

const CACHE_VERSION = "v3";
export const OPPORTUNITIES_CACHE_TTL_MS = 60_000;

interface CandidatesEntry {
  version: string;
  rows: Candidate[];
  lastScannedAt: string | null;
  fetchedAt: number;
}

interface UserSideEntry {
  saved: Set<string>;
  pursuits: Map<string, PursuitLite>;
  qualification: Map<string, StoredQualification>;
  bidProfile: BidProfileParams;
  hasBidProfile: boolean;
  fetchedAt: number;
}

let candidatesEntry: CandidatesEntry | null = null;
const userSideEntries = new Map<string, UserSideEntry>();

export function readCandidatesCache(): CandidatesEntry | null {
  if (!candidatesEntry) return null;
  if (candidatesEntry.version !== CACHE_VERSION) {
    candidatesEntry = null;
    return null;
  }
  return candidatesEntry;
}

export function writeCandidatesCache(rows: Candidate[], lastScannedAt: string | null): void {
  candidatesEntry = {
    version: CACHE_VERSION,
    rows,
    lastScannedAt,
    fetchedAt: Date.now(),
  };
}

export function readUserSideCache(userId: string | null | undefined): UserSideEntry | null {
  if (!userId) return null;
  return userSideEntries.get(userId) ?? null;
}

export function writeUserSideCache(
  userId: string,
  entry: Omit<UserSideEntry, "fetchedAt">,
): void {
  userSideEntries.set(userId, { ...entry, fetchedAt: Date.now() });
}

export function isFresh(entry: { fetchedAt: number } | null | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < OPPORTUNITIES_CACHE_TTL_MS;
}

export function clearOpportunitiesCache(userId?: string | null): void {
  if (userId) {
    userSideEntries.delete(userId);
    return;
  }
  candidatesEntry = null;
  userSideEntries.clear();
}

// Bootstrap: drop all in-memory state whenever Supabase reports SIGNED_OUT or
// a different user. Runs once at module load in the browser only.
if (typeof window !== "undefined") {
  let lastUserId: string | null | undefined;
  supabase.auth.onAuthStateChange((event, session) => {
    const nextId = session?.user?.id ?? null;
    if (event === "SIGNED_OUT" || (lastUserId !== undefined && lastUserId !== nextId)) {
      candidatesEntry = null;
      userSideEntries.clear();
    }
    lastUserId = nextId;
  });
}
