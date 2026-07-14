# Opportunities Page Facelift — Engineering Task List

Status: 📋 PLANNED — no tasks started
Document type: Engineering task list
Source implementation plan: `docs/initiatives/opportunities-page-facelift-implementation-plan.md`
Initiative document: `docs/initiatives/opportunities-page-facelift.md`
Branch: `phase1-opportunity-intelligence`

> **Protected card rule (binding on every task):** no task below may modify the markup, styling, props, or behavior of the opportunity card component. Tasks that render results render the existing card unchanged. If a task appears to require a card change, stop and escalate — do not implement.

> **Concurrency rule:** `src/pages/Opportunities.tsx` is being modified concurrently (geography/qualification work). Do not start Task 1 until the working tree is clean and any in-flight rebase on that file is resolved by its owner. Rebase before each task's commit; resolve only conflicts your own changes caused.

Recommended execution order: 1 → 2 → (3, 4, 5 in any order) → 6 → 7 (7 can start any time after 1) → 8 → 9 → 10 → 11 → 12 → 13. Task 7 (index backend) is dark and parallelizable with Tasks 3–6.

---

## Task 1 - PAGE DECOMPOSITION AND PROTECTED CARD EXTRACTION 📋 PLANNED
Objective: shrink `Opportunities.tsx` into a route container plus extracted components, with the card renderer isolated as the protected surface, and zero behavior change.
Dependencies: clean merge state of `src/pages/Opportunities.tsx`.
Subtasks:
### 1.1. Extract the card renderer verbatim
- Move `renderCard` into `src/components/opportunities/OpportunityCard.tsx` as a verbatim lift — the JSX inside the card subtree must not change.
- Add a file-header comment stating the Protected Opportunity Card Rule and linking to the initiative document.
### 1.2. Extract page sections
- `OpportunityTabs.tsx` (tab bar + counts), `OpportunityGrid.tsx` (grid + Filtered Out collapsible), `OpportunityEmptyState.tsx` (placeholder shell for Task 6), leaving data loading, realtime, scan panel, and qualification banner in the page container.
### 1.3. Extract membership predicates into pure functions
- Create `src/lib/opportunityTabs.ts` with pure predicates: `isClosed`, `isGloballyValid` (quarantine + global exclusion), `isCanonical` (dedup), `isSaved`, and the tab-membership function; the page and tab counts must both call these.
### 1.4. Card DOM parity test
- Render a fixture candidate before/after extraction and assert identical card HTML (snapshot on the card subtree only).
### 1.5. Acceptance criteria
- No user-visible change; all existing behaviors (scroll anchor, realtime, facets, sort, saved toggle) work; parity test green; `Opportunities.tsx` reduced to container + composition.

## Task 2 - FOUR-TAB ARCHITECTURE WITH URL STATE 📋 PLANNED
Objective: tabs become All · For You · Saved · Closed with For You default, persisted in the URL.
Dependencies: Task 1.
Subtasks:
### 2.1. Tab definition and order
- Replace the `FILTERS` array with the four tabs in the specified order. Do not remove, rename, or repurpose All/Saved/Closed.
### 2.2. URL-backed tab state
- `useOpportunitiesPageState` hook: `?tab=` search param (values `all|for-you|saved|closed`), default and unknown-value fallback `for-you`; reserve `?q=` for Task 8. Replace `useState(activeFilter)` usage.
- No conditional default logic of any kind (profile completeness, job state, account age, user type, onboarding).
### 2.3. Back-navigation and scroll anchor
- Verify detail-page back-nav restores tab from URL and the existing sessionStorage scroll anchor still fires after the grid renders.
### 2.4. Tests
- URL round-trip unit tests (default, deep link, unknown value, refresh); tab-count consistency test.
### 2.5. Acceptance criteria
- Opening `/opportunities` lands on For You always; `?tab=saved` deep link works; refresh and back-nav preserve tab; the three legacy tabs behave exactly as before.

## Task 3 - FOR YOU MEMBERSHIP 📋 PLANNED
Objective: For You renders exactly the globally valid, open, canonical candidates with active user qualification green or yellow.
Dependencies: Task 2.
Subtasks:
### 3.1. Membership predicate
- `forYouMembership(candidate, qualification)` in `opportunityTabs.ts`: valid ∧ open ∧ canonical ∧ qualification.status ∈ {green, yellow}. No qualification row → excluded.
- Fail-closed: if the qualification map failed to load completely (existing loader semantics), For You shows the load-error state, never a partial feed.
### 3.2. Ordering bias
- Within the active sort, order green before yellow (page-level comparator wrapper; cards untouched).
### 3.3. Live update on qualification completion
- Verify the existing qualification-job completion reload updates For You count and grid without manual refresh.
### 3.4. Tab chrome
- Subtitle/affordance "Based on your Bid Profile" in page chrome near the tab or grid header (not on cards).
### 3.5. Tests
- Predicate matrix: green in, yellow in, red out, no-row out, quarantined out, globally excluded out, duplicate out, closed out; fail-closed test; ordering test.
### 3.6. Acceptance criteria
- For You never shows red/unevaluated/invalid/duplicate/closed records; badge count equals rendered count; updates live after a qualification job.

## Task 4 - ALL AS TRUE INVENTORY 📋 PLANNED
Objective: All shows every globally valid, canonical, open opportunity with no user-profile filtering.
Dependencies: Task 2.
Subtasks:
### 4.1. Remove user qualification from All visibility
- All membership: valid ∧ canonical ∧ open. `user_opportunity_qualifications` must not affect All membership or ordering.
- Keep the in-card amber "Filtered out: reason" panel behavior exactly as it exists today (it is card-internal and protected); only the page-level hiding stops.
### 4.2. Scope the Filtered Out collapsible to global exclusions
- The collapsed section on All now contains only globally excluded/duplicate records (the "why was this removed for everyone" view); red-qualified records render as normal cards in the main grid.
### 4.3. Concept documentation at the predicate site
- Comment block distinguishing user filtering / global validity rules / portal deduplication / closed, mirroring the initiative doc table.
### 4.4. Tests
- Fixture proving a red-qualified valid record appears on All main grid and not on For You; dedup fixture (canonical in, duplicate in collapsible); quarantine fixture (nowhere).
### 4.5. Acceptance criteria
- All count = all valid open canonical records; membership provably independent of any per-user table.

## Task 5 - SAVED AND CLOSED PRESERVATION GATE 📋 PLANNED
Objective: prove Saved and Closed are behaviorally unchanged.
Dependencies: Tasks 2–4.
Subtasks:
### 5.1. Saved behavior tests
- Toggle from All/For You/Closed (and later search results); optimistic update with rollback on error; membership = saved ∧ open.
### 5.2. Closed behavior tests
- Membership = past due date regardless of saved/qualification; absent from other tabs.
### 5.3. Cross-tab invariant tests
- Property-style fixture sweep: every candidate lands in exactly the expected tab set for its state combination.
### 5.4. Acceptance criteria
- All tests green; manual spot-check against production behavior recorded in the PR description.

## Task 6 - FOR YOU EMPTY AND PROCESSING STATES 📋 PLANNED
Objective: the three For You states (no profile / evaluating / no matches) with no auto-redirects anywhere.
Dependencies: Task 3.
Subtasks:
### 6.1. State selection
- Precedence: loading → no/empty Bid Profile → qualification job active → zero matches → results. Implement as a pure function with unit tests.
- Profile presence read from `gc_qualification_profiles` for the signed-in user (reuse existing profile fetch if available; otherwise one lightweight query).
### 6.2. Variant: no Bid Profile
- Explainer copy ("For You improves as you complete your Bid Profile"), primary CTA → `/qualification-profile`, secondary link switches tab to All in place.
### 6.3. Variant: evaluating
- Reuse `useQualificationJob` progress ("Evaluating X of Y opportunities against your Bid Profile"); existing matches remain visible below the panel.
### 6.4. Variant: zero matches
- Plain statement + "Adjust Bid Profile" CTA + browse-All link; if matches are merely few, render the short list with no special state.
### 6.5. Tests
- State-machine precedence tests; no-flash test (empty state never renders before data resolves); assertion that no code path calls navigation on the user's behalf.
### 6.6. Acceptance criteria
- Each variant reachable and correct; For You remains default in every state; zero automatic redirects.

## Task 7 - SEARCH INDEX BACKEND (DARK) 📋 PLANNED
Objective: embeddings + FTS index infrastructure running in production with no UI.
Dependencies: none on Tasks 2–6 (parallelizable after Task 1); migration application follows `docs/pending-migrations.md` process.
Subtasks:
### 7.1. Migration: vector extension and search index table
- `CREATE EXTENSION IF NOT EXISTS vector;`
- `opportunity_search_index` per the implementation plan §6a: candidate FK (PK, cascade), `search_document`, `embedding vector(<dim>)`, `search_tsv tsvector`, `content_hash`, `embedding_model`, `embedded_at`, `updated_at`. HNSW index on embedding, GIN on tsv. RLS: SELECT `authenticated`, ALL `service_role` (the `portal_drivers` posture). Register in `docs/pending-migrations.md`.
### 7.2. Migration: search events table
- `opportunity_search_events` (query, interpreted constraints JSONB, scope, result_count, zero_result flag, clicked_candidate_ids, latency_ms, user_id, created_at); service-role write via the edge function, service-role-only read. Register as pending.
### 7.3. Search-document composer
- Worker lib module composing the search document from OML fields (title, agency, county, department, scope_text, licenses, NAICS, value band, due window) plus intelligence executive/scope summary when a completed report exists; deterministic output + SHA hash. Unit tests for determinism, field omission tolerance, and hash stability.
### 7.4. Embedding generation pipeline
- Worker job: select index-stale candidates (missing row or `content_hash` mismatch), compose, embed (chosen small embedding model; record model + dimension per row), upsert. Batched, rate-limited, resumable.
- Backfill script under `bidbox-worker/scripts/` for the full existing inventory (idempotent re-run safe).
- Nightly reconciliation sweep (same job, full-table hash scan) so stale embeddings self-heal and newly analyzed opportunities pick up their intelligence summaries.
### 7.5. Freshness metric
- Log per-run counts (embedded, skipped, failed) to `agent_run_logs` per existing worker conventions; a SQL check for "candidates missing index rows older than 24h".
### 7.6. Acceptance criteria
- Full inventory indexed in production; a newly scanned candidate gets an index row on the next worker cycle; re-running the backfill is a no-op; zero changes to scan/persist code paths beyond enqueueing.

## Task 8 - SEARCH QUERY PIPELINE (EDGE FUNCTION + RPC) 📋 PLANNED
Objective: `search-opportunities` edge function returning ranked candidate ids for a plain-language query within a tab scope.
Dependencies: Task 7.
Subtasks:
### 8.1. Query interpretation
- Haiku-class LLM call with strict JSON schema → `{ counties[], agencies[], value_min, value_max, due_before, due_after, semantic_text }`; hard ~2s timeout and malformed-output guard, both falling back to `{ semantic_text: full query }`. Log which path ran.
### 8.2. Retrieval RPC
- `SECURITY DEFINER` SQL function: hard WHERE from global validity + dedup + tab scope (For You joins caller's active qualifications green/yellow; Saved joins `saved_opportunities`; All/Closed by due date) + extracted constraints (county/agency/value/date).
- Hybrid ranking: RRF over vector cosine and `ts_rank`, plus bounded due-date proximity boost; rows without embeddings retrievable through the FTS channel; LIMIT + cursor pagination.
### 8.3. Edge function shell
- Auth required; per-user rate limit; body `{ query, tab_scope, limit, cursor? }`; response `{ candidate_ids[], interpreted: {...}, cursor?, latency_ms }`; writes an `opportunity_search_events` row per request.
### 8.4. Tests
- RPC scope tests (For You respects qualification, All ignores it, Saved/Closed subset); hard-constraint tests ("over $2 million" never returns below-threshold rows); no-embedding fallback; extraction-timeout fallback returns results; rate-limit rejection; RLS check that `authenticated` cannot read `opportunity_search_events`.
### 8.5. Acceptance criteria
- Golden smoke queries return sensible ordered ids against seeded data; P95 ≤ ~2.5s with extraction, ≤ ~1s fallback; every request logged.

## Task 9 - SEARCH UI 📋 PLANNED
Objective: the search bar, result rendering with existing cards, interpreted-constraint chips, and zero-result states — behind a feature flag.
Dependencies: Tasks 2, 8.
Subtasks:
### 9.1. Search bar and URL state
- Bar above the tabs; submit sets `?q=`; clear restores browse state (tab, sort, facets untouched underneath); `?tab=&q=` round-trips on refresh/back-nav.
### 9.2. Result rendering
- Grid renders existing `OpportunityCard` components in RPC id order; "N results" header; loading skeleton in the grid area only; save toggle and card navigation work identically from results.
- While a query is active, sort control shows "Relevance" (existing sorts resume on clear); agency facet composes as an extra client-side filter.
### 9.3. Interpreted-constraint chips
- Chips above the grid from the `interpreted` echo (e.g. `County: Riverside`, `Value: > $2M`); removing a chip re-queries with that constraint dropped; chips never render inside cards.
### 9.4. Zero-result states
- Scoped message naming the searched tab + one-click "Search All opportunities instead" (hidden when already on All); on All, suggest clearing or broadening the query. No silent scope widening.
### 9.5. Pagination
- "Load more" using the RPC cursor; preserve scroll position on append.
### 9.6. Feature flag
- `app_settings`-pattern flag gating the entire search surface; flag off → page identical to Task 6 output.
### 9.7. Tests
- URL round-trip; chip removal re-query; zero-result variants; flag-off renders no search DOM; card DOM parity within results; saved-toggle-from-results test.
### 9.8. Acceptance criteria
- End-to-end: type "storm drain repairs in Riverside under $5M" on For You → ranked existing cards + chips; scope switch works; clearing restores the prior browse view exactly.

## Task 10 - RELEVANCE EVALUATION AND REFINEMENT LOOP 📋 PLANNED
Objective: measurable, tunable search quality.
Dependencies: Tasks 8, 9.
Subtasks:
### 10.1. Golden query set and runner
- 30–50 real-language queries with expected top candidates (built from production-like data) committed under `test/`; runner script reports recall@10 and MRR; documented invocation in the script header.
### 10.2. Ranking tunables
- RRF constants and due-date boost isolated in one place with defaults documented; a ranking change requires a before/after golden run pasted into the PR.
### 10.3. Usage telemetry review
- Queries/dashboards over `opportunity_search_events`: zero-result rate, click-through position, refinement rate; review checklist for the first two weeks after launch.
### 10.4. Corpus fixes over query hacks
- Synonym/coverage gaps found in evaluation are fixed in the search-document composer (Task 7.3) with regression fixtures, not with query-time special cases.
### 10.5. Acceptance criteria
- Baseline met: expected result in top 10 for ≥80% of golden queries; runner wired into the ranking-change workflow.

## Task 11 - QUALIFICATION EXPANSION CONTRACT 📋 PLANNED
Objective: guarantee the future Qualification Agent improves For You with zero facelift changes.
Dependencies: Tasks 3, 6.
Subtasks:
### 11.1. Contract test
- Test asserting For You's read path consumes only: per-user rows keyed by candidate id with `status ∈ {red,yellow,green}`, human-readable reasons, and an `active` flag.
### 11.2. Simulated expansion fixture
- Fixture rows with future-style reasons (license mismatch, bonding capacity, agency preference, scope match) flow through For You membership, ordering, and empty states with zero component changes.
### 11.3. Seam documentation
- Short note in the initiative doc (or `docs/architecture/` if one is created) recording the two seams: qualification rows → For You membership; qualification features → future For You search ranking (not implemented).
### 11.4. Acceptance criteria
- Contract test green; simulated fixture renders correctly; seams documented.

## Task 12 - PRODUCTION VALIDATION 📋 PLANNED
Objective: verify everything against live inventory with team accounts before rollout.
Dependencies: Tasks 1–11; migrations applied per `docs/pending-migrations.md`.
Subtasks:
### 12.1. Backfill and freshness verification
- Run the Task 7.4 backfill in production; verify index coverage = valid inventory; confirm a fresh nightly scan produces index rows for new candidates.
### 12.2. Tab semantics validation
- With a team account: For You default on open; All comprehensiveness spot-check against known portal records; Saved/Closed parity; URL deep links; scroll anchor after back-nav; realtime insert appears in the correct tabs.
### 12.3. State validation
- Fresh account (no profile) → variant 1; trigger a qualification job → variant 2; narrow profile → variant 3; confirm zero auto-redirects.
### 12.4. Search validation
- Golden queries against production data with the flag on for team accounts; latency spot-checks; `opportunity_search_events` rows verified; zero-result and widen-to-All flows exercised.
### 12.5. Smoke checklist
- Commit the checklist used (per the repo's live-validation playbook convention) alongside this task list.
### 12.6. Acceptance criteria
- Initiative acceptance criteria 1–10 verified in production and recorded.

## Task 13 - ROLLOUT AND ROLLBACK 📋 PLANNED
Objective: safe ramp, communicated semantics change, exercised rollback.
Dependencies: Task 12.
Subtasks:
### 13.1. Flag ramp
- Search flag: team accounts → all users, with the telemetry review (Task 10.3) between steps.
### 13.2. Semantics communication
- Release note: All now shows the complete inventory; the personalized view is For You (the default).
### 13.3. Rollback paths
- Verify flag-off leaves a fully functional page; keep the For You default-tab switch as an isolated one-line change for instant revert; document that the index tables are additive and inert when unread (no schema rollback needed).
### 13.4. Post-launch monitoring
- Two-week watch: zero-result rate, search latency, embedding freshness check, qualification-job → For You update behavior; findings recorded as follow-up issues.
### 13.5. Acceptance criteria
- Ramp complete; rollback paths tested; monitoring findings triaged.
