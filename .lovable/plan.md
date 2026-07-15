## Revised plan — Corrected Phase 1 only

Direction approved. All nine corrections folded in. No DB index in this pass; realtime work stays a follow-up.

---

### Step 0 — Preflight measurement (no code changes yet)

1. Add lightweight `performance.mark` / `performance.measure` instrumentation around `mount → tab first-paint` and each side query. Emit one `[opps-perf]` console line per load.
2. Capture baseline timings, three trials each, on the admin account and `publicworkschannel@gmail.com` for: cold first visit, warm back-nav from detail, hard refresh — across tabs `for-you` / `all` / `saved`, plus one Fast-3G throttle run.
3. Verify PostgREST row cap: `SELECT current_setting('pgrst.db_max_rows', true)`, and inspect network `Content-Range` on the current 1000-page request. Record whether >1000 in one request is actually permitted.
4. Snapshot exact tab counts against a raw dump so the Step 5 filter can be reconciled to zero drift:

   ```sql
   SELECT
     count(*) FILTER (WHERE canonical_candidate_id IS NULL OR canonical_candidate_id = id) AS canonical_total,
     count(*) FILTER (WHERE ingestion_status = 'valid')       AS ingest_valid,
     count(*) FILTER (WHERE ingestion_status = 'quarantined') AS quarantined,
     count(*) FILTER (WHERE canonical_candidate_id IS NOT NULL
                        AND canonical_candidate_id <> id)      AS non_canonical,
     count(*) FILTER (WHERE global_exclusion_code IS NOT NULL) AS globally_excluded,
     count(*) FILTER (WHERE bid_due_at < now())               AS closed
   FROM opportunity_candidates;
   ```

   Then run the client tab predicates against the dump to record: All main, All Filtered Out, For You, Saved (sampled), Closed.

Deliverable: `docs/perf/2026-07-14-opportunities-baseline.md` — six-scenario timing table + tab-count reference table.

---

### Step 1 — Field-usage inventory (drives Step 4; no removals yet)

Grep every consumer of `Candidate` and produce a table listing each field in `OPPORTUNITY_LIST_SELECT` alongside every use site.

**Explicit keeps regardless of grep result:** `portal_summary`, `scope_text`, `required_licenses`, `required_naics` (For You construction classifier + LA Metro hardening — normalized `scope_text` is frequently absent), plus every field read by cards, `opportunityDomain`, `opportunityVisibility`, `opportunityTabs`, `bidProfileMatching`, geography visibility, viewed state, Add to Calendar, dedup, ingestion filtering.

**Candidates for possible removal** (only if grep proves zero list-view consumers): `analysis_task_id`, `opportunity_intelligence_task_id`, `analysis_requested_at`, `analysis_started_at`, `analysis_completed_at`, `document_acquisition_started_at`, `document_acquisition_completed_at`, `document_processing_started_at`, `document_processing_completed_at`, and the six granular `*_error` strings. Each removal requires (a) grep evidence in the inventory doc, (b) confirmation the detail page re-fetches it, (c) a new assertion in `test/opportunities-list-query.test.ts` that the column is absent.

Deliverable: `docs/perf/2026-07-14-opportunity-list-field-usage.md`.

---

### Step 2 — Parallelize the loader with tab-specific first-paint gates

In `src/pages/Opportunities.tsx` `loadCandidates`:

1. Drop the redundant `supabase.auth.getSession()` waterfall — use `user.id` from the already-memoized `useAuth`.
2. Kick off all requests in one `Promise.allSettled` at the same time: candidates, saved, pursuits, qualifications (paginated), bid profile.
3. Tab-scoped first-paint gate (per correction #2):
   - `all` → candidates only
   - `closed` → candidates only
   - `saved` → candidates + saved IDs
   - `for-you` → candidates + bid profile
4. Qualifications and pursuits hydrate independently in the background and re-render in place. For You's existing fail-closed rules still fire on qualification errors — background hydration replaces state atomically or the error handler runs; there is no partial-state path.
5. Notes fall back to `''` before pursuits arrive; existing pursuit-wins-legacy merge runs when the pursuits map lands.
6. Preserve every current guard: in-flight guard, watchdog, realtime, scroll anchor.

---

### Step 3 — Render the shell immediately (correction #7)

Replace the current full-page `loading` placeholder with an always-rendered shell:

- Header (title + subtitle), tab bar, sort/facet controls, and ~6 card skeletons on cold mount.
- Warm-cache path (Step 5) paints cached cards immediately with a subtle "Refreshing…" affordance during revalidation.
- Scroll-anchor restore currently waits for `loading` to flip — rewire it to fire once the active tab's first-paint gate resolves.

---

### Step 4 — Slim `OPPORTUNITY_LIST_SELECT` (bounded by Step 1)

Apply only removals proven safe by the field-usage inventory. Update `test/opportunities-list-query.test.ts`:

- Keep existing `portal_bid_id` present assertion.
- Add: `portal_summary`, `scope_text`, `required_licenses`, `required_naics` present.
- Add: each removed column asserted absent.

Add `test/opportunities-classifier-inputs.test.ts` — a fixture confirming the row shape passed to `classifyForYouSection` still contains every field referenced by `bidProfileMatching`.

---

### Step 5 — Server-side `ingestion_status = 'valid'` filter (correction #4)

Change the candidate query to `.eq('ingestion_status', 'valid')`.

- Quarantined rows are already excluded from every rendered tab by `isQuarantined`, so grid membership is unchanged.
- The **bottom Filtered Out section** on All (`isAllTabFilteredOutMember` = globally excluded but not quarantined, per `opportunityTabs.ts`) is unaffected — verify via the count matrix.
- Required PR table (any non-zero Δ blocks the PR):

  | Set                 | Before | After | Δ (must be 0) |
  |---------------------|--------|-------|---------------|
  | All (main)          |        |       |               |
  | All (Filtered Out)  |        |       |               |
  | For You             |        |       |               |
  | Saved               |        |       |               |
  | Closed              |        |       |               |
  | Global exclusions   |        |       |               |
  | Duplicates          |        |       |               |

---

### Step 6 — Page size: verified bump with pagination fallback (correction #3)

Only after Step 0 point 3 is complete:

- If PostgREST caps at 1000, **keep** `PAGE_SIZE = 1000`. Fire page 1 and page 2 in parallel (`range(0, 999)` + `range(1000, 1999)`); fall through to the sequential loop if page 2 comes back full.
- If the cap is higher, set `PAGE_SIZE` to `min(measured cap, 2000)` and keep the loop with `MAX_CANDIDATE_ROWS` as the truncation guard.
- Either way: retain the existing safety-ceiling warning and add a log whenever a page returns exactly `PAGE_SIZE` rows, so future silent capping is visible.

---

### Step 7 — Stale-while-revalidate cache (correction #5)

Small module `src/lib/opportunitiesCache.ts` (~80 lines, no library):

- **Two independent caches**, version-prefixed keys so we can bust:
  - `candidatesCache`: single global entry `{ rows, fetchedAt }`.
  - `userSideCache`: keyed by `user.id` → `{ saved: Set, pursuits: Map, qualification: Map, bidProfile, fetchedAt }`.
- TTL 60s. On mount:
  1. If a cache entry exists, seed React state from it and mark `revalidating = true`.
  2. Kick off Step 2's parallel fetch regardless.
  3. On resolution, **merge, don't clobber**: each slice tracks a `dirty` bit set by `handleToggleSaved`, `handleNotesSave`, and the bid-profile save event. If dirty, skip that slice's overwrite. Realtime INSERT/UPDATE handlers write through to `candidatesCache` after updating state.
- **Isolation on logout / account switch**: subscribe to `supabase.auth.onAuthStateChange`; on `SIGNED_OUT` or `user.id` change, drop `userSideCache` entirely and reset `candidatesCache.fetchedAt = 0`. Staleness across accounts is unacceptable.
- Bootstrap effect uses a synchronous cache-hit read to seed state before the fetch fires, so shell + cached cards land in the same paint.

---

### Step 8 — Final measurement + regression gate (correction #8)

Re-run the six-scenario matrix from Step 0. Commit the before/after table into `docs/perf/2026-07-14-opportunities-baseline.md`.

**Regression gate — all must pass:**

- `bunx vitest run` (full frontend suite)
- LA Metro 53-record classifier matrix
- `tsgo`
- `bun run build`
- `bunx eslint` scoped to `src/pages/Opportunities.tsx`, `src/lib/opportunitiesCache.ts`, `src/lib/opportunityTabs.ts`, `src/components/opportunities/**`
- Exact tab-count reconciliation matches Step 5 table
- Manual smoke on admin + `publicworkschannel@gmail.com`: cold load lands on For You, back-nav restores scroll, Add to Calendar does not redirect, Save toggle round-trips, Filtered Out section populated on All, viewed indicator persists

---

### Explicitly deferred (correction #9 + Phase 3 punt)

- **DB index** `idx_opportunity_candidates_valid_created_at`: run `EXPLAIN (ANALYZE, BUFFERS)` before and after Step 5's filter goes live. If sequential scan + sort still dominates server time, propose the migration in a follow-up with plan diffs attached. Otherwise drop the idea.
- **Realtime debounce + hydrate-source-name-from-local-map** (previous Phase 3): follow-up ticket.
- **Search index / embeddings work** (`docs/initiatives/opportunities-page-facelift-task-list.md` Task 7): unrelated; unaffected.

### Preserved behavior (non-negotiable, verified in the regression gate)

For You construction hardening · geography and project-size filtering · priced / unpriced sections · All as complete inventory · bottom global Filtered Out section · Saved and Closed semantics · viewed state · Add to Calendar without redirect · protected `OpportunityCard` surface (no markup / style / prop changes).
