# Opportunities Page Facelift — Engineering Implementation Plan

Status: 📋 PLANNED — documentation only, no implementation started
Date: 2026-07-13
Document type: Engineering implementation plan
Initiative document: `docs/initiatives/opportunities-page-facelift.md`
Task list: `docs/initiatives/opportunities-page-facelift-task-list.md`
Branch: `phase1-opportunity-intelligence`
Production baseline referenced throughout: `src/pages/Opportunities.tsx` (All/Saved/Closed tabs, client-side filtering), OML normalized columns (`20260630200000`), `qualify-candidates` + `user_opportunity_qualifications` + `qualification_jobs`, `saved_opportunities`, no pgvector/tsvector anywhere in `supabase/migrations/`.

> **Protected card rule.** No phase in this plan touches the inside of an opportunity card. Every phase that renders results renders the existing card component unchanged. See the initiative document's Protected Opportunity Card Rule before starting any phase.

> **Concurrency note.** `src/pages/Opportunities.tsx` is under active concurrent modification (Codex geography/qualification work; an unresolved rebase conflict existed in that file when this plan was written). Phase 1 must begin from a clean, fully merged state of that file. All schema in this plan is a **specification**, not a migration; migrations are written at implementation time and registered in `docs/pending-migrations.md` per the existing format.

---

## Phase Map

```
P1 Tab & page-state architecture
   └─▶ P2 For You qualification integration ──▶ P5 Empty & processing states
   └─▶ P3 All inventory view
   └─▶ P4 Saved/Closed preservation (verification gate)
P6 NL search MVP (index + RPC + UI)   ← independent of P2–P5 until UI wiring
   └─▶ P7 Search refinement & relevance evaluation
P8 Qualification Agent expansion compatibility (contract tests)
P9 Production validation & rollout
```

Recommended execution order: P1 → (P2, P3, P4 in any order) → P5 → P6 → P7 → P8 → P9. P6's index/backfill work (6a) can start in parallel with P2–P5 since it is backend-only and dark.

---

## Phase 1 — Tab and Page-State Architecture

**Objective:** restructure the page shell to support four tabs with URL-persisted state, without changing any user-visible behavior of the existing three tabs, and shrink the future merge-conflict surface by extracting components.

**Files/systems likely affected:**
- `src/pages/Opportunities.tsx` (decompose; keep as route container)
- New: `src/components/opportunities/OpportunityTabs.tsx`, `OpportunityGrid.tsx`, `OpportunityEmptyState.tsx` (shells), `src/hooks/useOpportunitiesPageState.ts` (URL ⇄ state)
- `src/lib/opportunityVisibility.ts` (read-only reuse; no changes)

**Backend requirements:** none.

**Frontend requirements:**
- Extract the card renderer as-is into its own module (verbatim move — the diff inside the card subtree must be empty) so the protected surface is one file with a header comment stating the rule.
- Replace the `FILTERS` array with the four-tab definition `all · for-you · saved · closed`; `for-you` renders but may temporarily show the All-minus-red placeholder or a "coming in Phase 2" empty shell behind the scenes — the tab order and default must be final in this phase.
- Tab state moves from `useState("all")` to a URL search param (`?tab=`), default `for-you`; unknown values fall back to `for-you`. Search param `?q=` is reserved (wired in Phase 6).
- Preserve: sessionStorage scroll anchor, realtime channel, scan panel, qualification-job banner, sort + agency facet, tab counts.

**Database requirements:** none.

**Tests:**
- Unit: URL param round-trip (tab default, unknown param fallback, back-nav restore).
- Existing behavior regression: All/Saved/Closed membership logic unchanged for a fixture set (extract membership predicates into pure functions and test them — `isClosedCandidate`, quarantine, exclusion, dedup, saved).
- DOM parity check on a rendered card before/after extraction.

**Acceptance criteria:** four tabs render in order with For You default; deep link `?tab=saved` lands on Saved; refresh preserves tab; card DOM identical; no console/network behavior change on load.

**Dependencies:** clean merge state of `Opportunities.tsx` (Codex rebase resolved).

**Risks:** conflict with concurrent work (mitigate: extraction-first, small PRs); accidental card drift (mitigate: parity test).

---

## Phase 2 — For You Qualification Integration

**Objective:** For You shows exactly the globally valid, open opportunities whose active qualification for the signed-in user is green or yellow.

**Files/systems likely affected:** `useOpportunitiesPageState.ts` / membership predicates; `OpportunityTabs.tsx` counts; no backend changes.

**Backend requirements:** none — consumes `user_opportunity_qualifications` (already loaded fail-closed and paginated) and `qualification_jobs` via the existing hook.

**Frontend requirements:**
- Membership: valid ∧ open ∧ qualification status ∈ {green, yellow}. Candidates with **no** qualification row are excluded from For You (they are not yet evaluated — Phase 5 communicates this).
- Default ordering biases green above yellow within the selected sort (page-level ordering; cards untouched).
- Tab subtitle text "Based on your Bid Profile" (page chrome, outside cards).
- On qualification-job completion, the existing silent reload already refreshes the map; verify For You count/content update live.

**Database requirements:** none.

**Tests:** membership predicate unit tests (green in, yellow in, red out, no-row out, quarantined out, closed out, duplicate out); count consistency between tab badge and grid; live-update test with a mocked job completion.

**Acceptance criteria:** For You never renders a red/unevaluated/quarantined/closed/duplicate record; counts match; updates after qualification completes without manual refresh.

**Dependencies:** Phase 1. Benefits from (does not require) Codex geography promotion improving county coverage.

**Risks:** fail-closed qualification load means a partial load must blank For You with an error state rather than show a wrong subset (reuse the existing fail-closed pattern already in the loader).

---

## Phase 3 — All Inventory View

**Objective:** make All the true complete inventory — global validity rules and portal dedup only, no user-profile filtering.

**Files/systems likely affected:** membership predicates; `src/lib/opportunityVisibility.ts` callers (the library itself likely unchanged — the change is *where* its outputs are applied).

**Backend requirements:** none.

**Frontend requirements:**
- All membership: not quarantined ∧ no global exclusion ∧ not a non-canonical duplicate (`canonical_candidate_id` null or self) ∧ open.
- User-qualification red status **stops being a visibility rule on All**. Decide the fate of the collapsed "Filtered Out" section: keep it on All exclusively for *globally* excluded records (recommended — it already explains dedup/global exclusions), while red-qualified records render as normal cards. The amber in-card "Filtered out: reason" panel is existing card behavior and is left exactly as-is wherever it already appears.
- Document the four-concept separation (user filtering / global validity / dedup / closed) as a comment block at the membership predicate site, mirroring the initiative doc table.

**Database requirements:** none.

**Tests:** predicate tests for each exclusion class; a fixture proving a red-qualified valid record appears on All and not on For You; dedup fixture (canonical shows, duplicate doesn't).

**Acceptance criteria:** every valid open opportunity in the database appears on All exactly once; All count = For You ∪ non-qualifying valid records; no user-specific table read affects All membership.

**Dependencies:** Phase 1.

**Risks:** user surprise at "more stuff on All" — covered by rollout notes (Phase 9) and For You being the default lens.

---

## Phase 4 — Preservation of Saved and Closed Behavior

**Objective:** verification gate that Saved and Closed are byte-for-byte behaviorally identical after the restructure.

**Files/systems likely affected:** tests only (plus any regressions it catches).

**Backend requirements:** none. **Frontend requirements:** none beyond fixes. **Database requirements:** none.

**Tests:**
- Saved: bookmark toggle from All/For You/Closed/search results; optimistic update + rollback on error; Saved membership = saved ∧ open.
- Closed: membership = past `bid_due_at` regardless of saved/qualification state; closed records absent from All/For You/Saved.
- Cross-tab invariants as property-style tests over fixtures (each candidate appears in the correct set exactly).

**Acceptance criteria:** all tests green; manual spot-check parity with production behavior.

**Dependencies:** Phases 1–3.

---

## Phase 5 — Empty and Processing States

**Objective:** implement the three For You states (no profile / qualification running / no matches) plus generic empty states for other tabs, with no auto-redirects.

**Files/systems likely affected:** `OpportunityEmptyState.tsx`; profile presence check (one lightweight read of `gc_qualification_profiles` for the signed-in user — likely already available via existing profile hooks).

**Backend requirements:** none (reads existing tables).

**Frontend requirements:**
- State selection precedence: no/empty profile → job active → zero matches. States render in the grid area; the tab bar, search bar, and counts remain visible.
- Variant 1: explainer + primary CTA "Complete your Bid Profile" → `/qualification-profile`; secondary link "Browse all opportunities" (switches tab, not a redirect).
- Variant 2: reuse `useQualificationJob` progress ("Evaluating X of Y opportunities…"); any existing matches stay visible below.
- Variant 3: plain zero-match statement + "Adjust Bid Profile" + browse link.
- Never navigate automatically; never flash a state during initial load (loading placeholder precedence).

**Database requirements:** none.

**Tests:** state-machine unit tests for precedence and each variant's actions; loading-race test (no empty-state flash before data resolves).

**Acceptance criteria:** each state reachable and correct per the initiative doc; zero automatic redirects anywhere on the page.

**Dependencies:** Phase 2.

---

## Phase 6 — Natural-Language Search MVP

**Objective:** ship the hybrid search path end to end: index infrastructure (6a, dark), query pipeline (6b), and search UI (6c) behind a feature flag.

### 6a — Index infrastructure (backend, dark)

**Database requirements (all additive; specification only — final DDL at implementation time):**
- Migration: `CREATE EXTENSION IF NOT EXISTS vector;`
- `opportunity_search_index`: `opportunity_candidate_id` (PK, FK cascade), `search_document text`, `embedding vector(<dim>)`, `search_tsv tsvector` (generated or trigger-maintained), `content_hash text`, `embedding_model text`, `embedded_at timestamptz`, `updated_at`. RLS: SELECT to `authenticated`, ALL to `service_role` (the `portal_drivers` posture). Indexes: HNSW (or IVFFlat) on `embedding`, GIN on `search_tsv`.
- `opportunity_search_events`: query text, interpreted-constraint JSON, scope/tab, result count, zero-result flag, clicked candidate ids, latency ms, user id, created_at. Insert via the search function; SELECT service_role only.
- Register both in `docs/pending-migrations.md`.

**Backend requirements:**
- Search-document composer (worker lib): deterministic text assembly from OML fields + optional intelligence summary; hash for change detection.
- Embedding pipeline in the Railway worker: backfill script (batched, resumable, rate-limited) + incremental path (compare hash on candidate insert/refresh → re-embed on change) + nightly reconciliation sweep (also picks up newly generated intelligence reports). Model + dimension recorded per row so a model swap is a rebuild, not a mystery.

**Tests:** composer determinism/hash tests; backfill idempotency on re-run; reconciliation picks up a mutated row; rows without embeddings tolerated end to end.

### 6b — Query pipeline

**Backend requirements:**
- New edge function `search-opportunities` (follows existing function conventions in `supabase/functions/`): auth-required, per-user rate limit, body `{ query, tab_scope, limit, cursor? }`.
- Step 1 — interpretation: Claude Haiku call with a constrained JSON schema → `{ counties[], agencies[], value_min, value_max, due_before, due_after, semantic_text }`. Hard timeout ≈ 2s → fallback `{ semantic_text: query }`. Never let extraction failure fail the search.
- Step 2 — retrieval: one SQL RPC (`SECURITY DEFINER` function) applying global validity + dedup + tab scope (For You joins the caller's `user_opportunity_qualifications`; Saved joins `saved_opportunities`; Closed/All by due date) + extracted hard filters; hybrid rank = RRF(vector cosine, `ts_rank`) + due-date proximity boost; rows lacking embeddings still retrievable via the FTS channel.
- Response: ordered candidate ids + per-request interpreted-constraint echo (for chips) + pagination cursor. Log to `opportunity_search_events`.

**Tests:** RPC tests per scope (respects qualification on For You, ignores it on All, saved/closed subsets); hard-constraint tests ("over $2M" excludes $500K regardless of similarity); fallback-path test (extraction timeout → results still returned); rate-limit test.

### 6c — Search UI

**Frontend requirements:**
- Search bar above the tabs (page chrome; cards untouched). Submitting sets `?q=`; clearing restores browse state.
- Results replace the grid, rendered with the existing card component in RPC order; "N results for …" header line; interpreted constraints as removable chips above the grid (removing a chip re-queries with that constraint dropped).
- Zero-result state names the searched scope and offers "Search All opportunities instead" (except on All); a zero-result on All explains and offers clearing the query.
- Feature flag via the existing `app_settings` pattern: flag off → no search bar, page identical to Phase 5 output.
- Sort control disabled or repurposed to "Relevance" while a query is active (explicit, visible); agency facet composes as an additional filter.

**Tests:** URL round-trip with `?tab=&q=`; chip removal re-query; flag-off renders no search surface; card DOM parity in results.

**Acceptance criteria (whole phase):** golden queries return expected cards in order on a seeded dataset; first-page load makes zero AI/embedding calls; search P95 latency target ≤ ~2.5s with extraction, ≤ ~1s on fallback path; new candidates searchable after the next worker cycle without redeploy.

**Dependencies:** Phase 1 (page shell). 6a has no frontend dependency and can start first.

**Risks:** embedding-provider outage (FTS fallback keeps search alive); index bloat (single-row-per-candidate design; monitor table size); RPC performance (HNSW index + LIMIT-first ranking).

---

## Phase 7 — Search Refinement and Relevance Evaluation

**Objective:** make search measurably good and safely tunable.

**Files/systems likely affected:** RPC ranking function; a committed golden-query fixture + runner script; `opportunity_search_events` analysis queries.

**Backend requirements:**
- Golden query set (~30–50 real-language queries with expected top candidates from production-like data) committed under `test/` with a runner that reports recall@10 and MRR; run before/after any ranking change.
- Ranking weights (RRF constants, due-date boost) moved to one tunable site with documented defaults.
- Follow-up query behavior: a new query while results are shown re-ranks fresh (MVP); chip edits compose. Multi-turn conversational refinement stays out of scope.
- Zero-result and low-click queries reviewed from `opportunity_search_events`; feed fixes into synonyms in the search-document composer (e.g. ensure "storm drain" documents also carry "drainage" context) rather than query-time hacks where possible.

**Frontend requirements:** none beyond copy tweaks discovered in evaluation.

**Database requirements:** none new.

**Tests:** the golden runner is the test; add regression fixtures for every relevance bug fixed.

**Acceptance criteria:** agreed baseline met (starting bar: expected result in top 10 for ≥80% of golden queries; zero-result rate < 15% on real usage after two weeks); ranking changes gated on the runner.

**Dependencies:** Phase 6.

---

## Phase 8 — Qualification Agent Expansion Compatibility

**Objective:** lock the contract so the future Qualification Agent improves For You (and later, search personalization) with zero page changes.

**Files/systems likely affected:** contract tests + a short architecture note; no production code expected.

**Backend requirements:**
- Contract test asserting the For You read path depends only on: per-user rows keyed by candidate id with `status ∈ {red,yellow,green}` + human-readable reasons + an `active` flag. Any schema evolution must keep or migrate this projection.
- Documented seam list (initiative doc §Future-State): (1) qualification rows drive For You membership; (2) qualification features may later join search ranking for For You scope — explicitly not implemented now.
- Verify new qualification dimensions (project type, scope, license, bonding, agency preference, experience, compliance) require **no** facelift changes: they arrive as different reasons/statuses on the same rows.

**Frontend requirements:** none. **Database requirements:** none.

**Tests:** the contract test; a simulated "richer agent" fixture (same table, new reason strings) rendering correctly in For You and its empty states.

**Acceptance criteria:** a written, tested read contract; simulated expansion passes with zero component changes.

**Dependencies:** Phases 2, 5.

---

## Phase 9 — Production Validation and Rollout

**Objective:** validate against live inventory and roll out safely.

**Backend/Frontend requirements:**
- Apply migrations per `docs/pending-migrations.md` process; run the embedding backfill against production inventory; verify index freshness after the next nightly scan cycle.
- Controlled validation with team accounts (the established live-validation playbook): tab semantics, all three For You states (fresh account, mid-job, thin profile), golden queries against real data, URL persistence, scroll-anchor behavior, realtime updates.
- Flag ramp: search flag on for team accounts → all users. For You ships unflagged (its safety is its empty states), but its default-tab switch is a one-line revert if needed.
- Announce the All-tab semantic change (release note: "All now shows the complete inventory; your personalized view lives in For You").

**Tests:** production smoke checklist committed alongside the task list; `opportunity_search_events` dashboards/queries for the first two weeks.

**Acceptance criteria:** initiative-level acceptance criteria 1–10 verified in production; rollback paths exercised at least once in staging form (flag off; default-tab revert).

**Dependencies:** all prior phases.

**Risks:** production inventory quirks not present in fixtures (mitigate: golden set built from production data); embedding backfill cost spike (batch with caps; it is a one-time cost proportional to inventory size).
