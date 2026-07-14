# Bug: Opportunities page stuck on "Loading opportunities..." for fresh account

**Reported:** 2026-07-13
**Reporter:** publicworkschannel@gmail.com (user id `257363d6-196f-496d-bcef-4e1dd894b00d`)
**Route:** `/opportunities`
**Severity:** P1 — blocks the primary feature for fresh accounts
**Env:** Production (Lovable preview, branch `phase1-opportunity-intelligence`)

---

## Symptom

After signing in, the Opportunities page renders the loading placeholder ("Loading opportunities...") and never advances to the results view — observed for at least 5 minutes.

## What the server sees (verified)

For user `257363d6-…` the backend is healthy and every request the page issues is returning `200 OK`:

- `opportunity_candidates?select=*,opportunity_sources(name,last_scanned_at)&offset=0&limit=1000` → 200 (both pages, 1739 total rows)
- `saved_opportunities?user_id=eq.257363d6-…` → 200
- `pursuits?...` → 200
- `user_opportunity_qualifications?user_id=eq.257363d6-…&active=eq.true` → 200
- `gc_qualification_profiles?profile_id=eq.257363d6-…` → 200 (row exists; created 2026-07-13 19:41)
- `qualification_jobs?user_id=eq.257363d6-…` → 200 (0 rows — user has never queued a rebuild)

The 1739-row candidate payload is only ~4.6 MB total (crawl_data included) and the underlying query plan runs in **~12 ms** server side. Not a query, RLS, or grant problem.

The paginated `opportunity_candidates` request keeps re-firing every ~7 s from this account (matches `POLLING_INTERVAL_MS = 7000`), so the browser IS making progress — the frontend just never leaves the `loading===true` branch.

## Diagnosis (frontend)

`src/pages/Opportunities.tsx`:

- `loading` is initialized `true` (line 308).
- The bootstrap effect (lines 484–517) unconditionally runs `setLoading(true)` on every fire, then calls `loadCandidates()` without awaiting it. Deps: `[navigate, loadCandidates, user, authReady]`.
- `loadCandidates()` only sets `setLoading(false)` on the non-silent path at line 480, i.e. after the pagination loop **and** the follow-up `saved_opportunities` / `pursuits` / `user_opportunity_qualifications` reads all resolve.
- The 7-second polling effect (lines 624–641) calls `loadCandidates({ silent: true })`, which intentionally does **not** flip loading.

Two concrete failure modes are consistent with the observed logs and the "never leaves loading" symptom:

1. **Bootstrap effect re-firing.** If any dep in `[navigate, loadCandidates, user, authReady]` gets a new reference, `setLoading(true)` runs again and a fresh (non-silent) `loadCandidates()` starts. The logs show multiple `opportunity_candidates?offset=0` requests spaced 1–2 s apart (e.g. ts `…193306`, `…194550`), which is faster than the 7 s poller — proof that non-silent loads are being kicked more than once. `pollInFlightRef` gates the poller, so this can only come from the bootstrap effect. `user` from `useAuth` gets a fresh object reference every time `onAuthStateChange` fires (`INITIAL_SESSION`, `TOKEN_REFRESHED`, cross-tab `SIGNED_IN`); each of those flips `setLoading(true)` again.

2. **Silent load never resolves the initial non-silent one.** If the 7 s poller's silent load starts while the initial load is still in flight, both end up hitting the same `setLoading` path and the "final" write from the initial load can race against the effect being re-triggered, leaving `loading` pinned to `true`.

Either way, the visible behaviour is exactly what the user reported: the network keeps working, the data is there, but the UI is stuck on the loading text.

## Repro (server-side, no browser needed)

```sql
-- confirm the user has everything the page needs
select id, email, company_name from public.profiles where id='257363d6-196f-496d-bcef-4e1dd894b00d';
select company_id from public.company_members where profile_id='257363d6-196f-496d-bcef-4e1dd894b00d';
select id from public.gc_qualification_profiles where profile_id='257363d6-196f-496d-bcef-4e1dd894b00d';
select count(*) from public.opportunity_candidates;  -- 1739
```

All succeed; the account has a profile, company membership, and a bid profile, but zero `user_opportunity_qualifications` and zero `qualification_jobs`.

## Proposed fix (frontend only — no schema, no worker changes)

1. **Guard the bootstrap effect from re-firing.**
   - Split it into two effects: one that handles the `!user` redirect (deps `[user, authReady, navigate]`), and one that runs `loadCandidates()` exactly once per authenticated user id (deps `[user?.id, authReady]`). Do not depend on `loadCandidates` identity.
   - Drop `setLoading(true)` from re-runs; only set it on the very first mount, then rely on `loadCandidates` to flip it to `false` when done.

2. **Make `loadCandidates` self-guarded.**
   - Track an in-flight ref for the non-silent path (mirror `pollInFlightRef`) and no-op re-entrant calls.
   - Move `setLoading(false)` into a `try/finally` so a thrown error inside the follow-up reads (`saved_opportunities`, `pursuits`, `user_opportunity_qualifications`) can never leave `loading===true`.

3. **Stabilize `useAuth` output.** In `src/hooks/useAuth.tsx`, wrap the context value in `useMemo(() => ({ user, loading, authReady }), [user, loading, authReady])` so consumers don't see reference churn on unrelated re-renders. This is cheap insurance even after (1) and (2) land.

4. **Add a visible watchdog.** If `loading` is still true after 15 s, log `[opps] loading watchdog tripped` with the counts of `candidates`, `savedCandidateIds`, `pursuitByCandidate`, and the last error — so the next time this shows up we get a signal in the console instead of a silent hang.

## Non-goals / explicitly out of scope

- No schema migration.
- No Edge Function change.
- No PlanetBids recovery or qualification queue action for this user.
- No frontend Publish — this file is a diagnosis only; the fix is a separate turn.

## Evidence bundle

- Postgres query plan for the 1000-row page: 12.9 ms execution time (Seq Scan + Hash Join, external sort 2.7 MB).
- `pg_column_size` total for `opportunity_candidates`: 4.66 MB across 1739 rows.
- Edge log window inspected: last ~120 s of `rest/v1/opportunity_candidates` and `rest/v1/saved_opportunities` requests for user `257363d6-…`, all `200`.
- RLS policies confirmed: `opportunity_candidates` SELECT `USING (true)`; `saved_opportunities` / `pursuits` / `user_opportunity_qualifications` scoped to `auth.uid()` / `is_company_member(company_id)` and returning without error.
