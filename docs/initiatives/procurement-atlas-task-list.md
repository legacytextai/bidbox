# Procurement Atlas Implementation — Phase 0

Status: 📋 PLANNED — no tasks started
Document type: Engineering task list
Source implementation plan: `docs/initiatives/procurement-atlas-implementation-plan.md`
Architectural source of truth: `docs/architecture/procurement-atlas.md`
Initiative document: `docs/initiatives/Procurement_Atlas_Initiative_Plan.md`
Roadmap placement: `docs/agent-architecture-task-list.md` §6.3 (E2 — implemented by Atlas)
Branch: `phase1-opportunity-intelligence`

## Milestones

Phase 0 (this list, Tasks 1–11) delivers the Atlas foundation:

```
Registry schema → Backfill from production → Derived coverage/health views
→ Recon template + /agency-recon playbook + evidence collector
→ Ledger deprecated → Validated in production → Documented
```

No new services, workers, dashboards, or agents. One nullable column on `opportunity_sources` is the only change to any existing table. Zero changes to `bidbox-worker/index.js`, any driver, or any existing edge function. One new read-only edge function (`atlas-health-report`).

Recommended execution order: Tasks 1→2→3→4 (schema before data), then 5→6→9 and 7→8 in parallel, then 10→11. Tasks 7–8 have no schema dependency and are the designated fallback work if migration application is blocked on Lovable availability.

---

## Task 1 - SCHEMA MIGRATION: REGISTRY TABLES 📋 PLANNED
Objective: create `portal_families`, `agencies`, and `agency_portals` in BidBox's existing Supabase project, per implementation plan §4.
Dependencies: none.
Subtasks:
### 1.1. Write migration `atlas_registry_tables`
- One migration file, descriptive-timestamp naming (`2026MMDDHHMMSS_atlas_registry_tables.sql` style, matching `20260701120000_planetbids_login_lock.sql`).
- Create tables in dependency order: `portal_families` → `agencies` → `agency_portals`, with the exact columns, CHECK constraints, defaults, and UNIQUE constraints specified in implementation plan §4.1–4.3. Do not add columns beyond the spec (§4.5 lists the refusals).
- Add the specified indexes: `agencies(status)`, `agencies(county)`, `agencies(agency_type)`, `agency_portals(agency_id)`, `agency_portals(portal_family)`.

### 1.2. RLS policies
- Enable RLS on all three tables with the `portal_drivers` posture (migration `20260602000002` as the model): SELECT to `authenticated`, ALL to `service_role`.
- No `authenticated` write policy — writes are service-role only (migrations, scripts, sessions).

### 1.3. Register as pending
- Add the migration to `docs/pending-migrations.md` with purpose, file path, and validation queries, per the existing format in that file.

### 1.4. Acceptance criteria
- Migration applies cleanly; all three tables exist in production with RLS enabled.
- `SELECT * FROM pg_policies WHERE tablename IN ('portal_families','agencies','agency_portals')` shows exactly the two policies per table.
- An `authenticated`-role SELECT succeeds; an `authenticated`-role INSERT fails.

## Task 2 - SCHEMA MIGRATION: LINK OPPORTUNITY_SOURCES TO AGENCIES 📋 PLANNED
Objective: add the single data-plane touchpoint — `opportunity_sources.agency_id`.
Dependencies: Task 1.
Subtasks:
### 2.1. Write migration `atlas_link_opportunity_sources`
- `ALTER TABLE public.opportunity_sources ADD COLUMN agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;` plus index `idx_opportunity_sources_agency_id`.
- Column is nullable permanently — no code path reads it; NOT NULL is never planned (implementation plan §4.4).

### 2.2. Confirm zero data-plane impact
- Verify by inspection that no edge function (`refresh-opportunities`, `scan-opportunities`, `crawl-project`, `qualify-candidates`) and no worker code selects `opportunity_sources.*` in a way a new nullable column breaks (they select named columns or tolerate extras).
- Register in `docs/pending-migrations.md`.

### 2.3. Acceptance criteria
- Column and index exist in production; all existing rows have `agency_id IS NULL`; the nightly refresh runs unchanged the following night (check `cron.job_run_details`).

## Task 3 - PORTAL FAMILY REGISTRY SEED 📋 PLANNED
Objective: turn institutional portal knowledge from the handoff docs into queryable `portal_families` rows — the anti-re-recon layer.
Dependencies: Task 1 (ships inside the Task 4 backfill migration; authoring can start immediately).
Subtasks:
### 3.1. Seed production families from existing driver knowledge
- `planetbids`: `driver_status='production'`, `expansion_model='config_only'`, `transport='browserbase'`, `auth_model='vendor_account'`; quirks: single-session login invalidation → `acquire_planetbids_lock`/`release_planetbids_lock` (migration `20260701120000`); documents via captured bearer token, not browser download; local headless Chromium blocked (agent-architecture Task 3.1).
- `caltrans`: `driver_status='production'`, `expansion_model='per_agency_driver'`, local Playwright transport, `CALTRANS_EMAIL`/`CALTRANS_PASSWORD` auth, per-file download loop.
- `lacounty_dpw`: `driver_status='production'`, `expansion_model='per_agency_templates'`, `transport='http'`; quirks: Imperva low-friction as of 2026-07 (realistic UA passes; Browserbase fallback designed, spec §8.7); documents SSO-gated (`app.pw.lacounty.gov/adm/uamsso`); template registry with 5 detail templates; source doc `docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md` §0.
- `lacmta`: `driver_status='production'`, `expansion_model='per_agency_driver'`, `transport='browserbase_download_sync'`; quirks: local headless Chromium hard-blocked (`Attack ID: 20000051`) while Browserbase passes; Oracle ADF — no stable per-item URLs, no API; 25-row on-screen cap, PDF export is the only full enumeration; Browserbase downloads require CDP `Browser.setDownloadBehavior` opt-in + downloads-zip endpoint (`lib/browserbase.js` `fetchBrowserbaseDownloadZip`); source doc `docs/handoff/2026-07-06-lacmta-recon-and-blocker.md`.

### 3.2. Seed known-but-unbuilt families
- `bonfire`, `opengov`, `cal_eprocure`, `bidnet_periscope`, `demandstar`, `epro` (SB County), `ersp` (LADWP), `agency_direct_other`, `unknown` — `driver_status='none'`, fields `'unknown'` where nothing is verified. Never guess: unverified attributes stay NULL/`'unknown'`.
- `detection_patterns` populated from `src/lib/platformDetection.ts` `PORTAL_PATTERNS` for the 8 types it knows; patterns and `platformDetection.ts` must not silently diverge — note the mirror relationship in both places.

### 3.3. Acceptance criteria
- `SELECT family, driver_status FROM portal_families` returns 4 production + ≥8 planned families.
- Every fact recorded traces to a named source doc or migration (spot-check LACMTA and DPW rows against their handoffs).
- Aggregators (RAMPLA-class) are absent from `portal_families` — they are `agency_portals.role='aggregator'` rows only.

## Task 4 - AGENCY REGISTRY BACKFILL 📋 PLANNED
Objective: every agency BidBox already knows becomes registry data, and every production source links to its agency.
Dependencies: Tasks 1–3.
Subtasks:
### 4.1. Write migration `atlas_backfill_registry`
- Idempotent INSERTs (`ON CONFLICT` on `family` / `(name, state)` / `(agency_id, portal_url)`, following the E1 seed convention of `ON CONFLICT (listing_url) DO UPDATE`).
- Contains the Task 3 family seeds, the agency/portal backfill below, and the `opportunity_sources.agency_id` UPDATE statements keyed by `opportunity_sources.id` (never by name matching).

### 4.2. Backfill from production sources
- One `agencies` row per distinct agency behind the 76 E1 PlanetBids sources (ledger + migrations `20260608000001`, `20260609000001`), Caltrans, LA County DPW (`20260701210000`), and LACMTA (`20260706193000`).
- `agency_type` assigned per agency (city, school_district, water, transit, port, airport, state, etc.); `discovered_via='production-backfill'` or `'e1-ledger'`; `status='portal_verified'` (E1 agencies were verified before seeding).
- One `agency_portals` row per source: `portal_url = listing_url`, family from `portal_type`, `role='primary'`, `is_official=true`, `evidence_url` pointing at the verification basis, `verified_by` recorded.

### 4.3. Special cases carried from existing docs
- Portal `48397` (labeled LAWA; public references also say Santa Clara Valley Water District — ledger Discovery Notes): `is_official = NULL` plus a note; do not resolve by guesswork.
- LA County DPW: three portal rows — native listing (`primary`, `recon_status='complete'`, `recon_doc_path='docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md'`), RAMPLA (`aggregator`, ruled out per recon 0.1), Bid Express (`plan_room`, uninvestigated lead per recon 0.5).
- LACMTA: `recon_status='complete'`, `recon_doc_path='docs/handoff/2026-07-06-lacmta-recon-and-blocker.md'`.
- Known-but-unimplemented portals from `platformDetection.ts`: LADWP (`ersp.ladwp.com`) and SB County (`epro`) get `agencies` + `agency_portals` rows with `status='identified'`, `recon_status='none'`.

### 4.4. Acceptance criteria
- `SELECT count(*) FROM opportunity_sources WHERE agency_id IS NULL` returns 0.
- Agency count matches distinct-agency expectation (~76–80; some agencies may have had multiple sources — verify, don't assume 1:1).
- Re-running the migration is a no-op (idempotency proven).
- No `is_official = true` row lacks `evidence_url`.

## Task 5 - COVERAGE SQL VIEWS 📋 PLANNED
Objective: make "what do we cover, what's next" a query.
Dependencies: Task 4.
Subtasks:
### 5.1. Create `agency_coverage`
- Per implementation plan §5.1: registry LEFT JOIN production; `implemented` computed as `os.id IS NOT NULL`; never a stored status.
- Document the known multiplicity behavior (an agency with multiple sources yields multiple rows — acceptable for an internal view).

### 5.2. Create `family_opportunity`
- Per implementation plan §5.2: agencies unlocked and value unlocked per family, counting only `is_official IS TRUE` primary portals against un-implemented agencies.
- This view is the designated answer to roadmap Task 10.2 "Decide first non-PlanetBids driver after E2 shows source counts."

### 5.3. Acceptance criteria
- `agency_coverage` shows all 4 portal types implemented with correct `scan_enabled`/`last_refresh_status` passthrough (spot-check LACMTA enabled, DPW per its current production state).
- `family_opportunity` returns `planetbids` with `agencies_live ≥ 70`-ish and `ersp`/`epro` with `agencies_unlocked ≥ 1`.
- Views are readable by the `authenticated` role.

## Task 6 - HEALTH SQL VIEW & ALERT CHANNEL 📋 PLANNED
Objective: portal drift surfaces within 24h from signals the pipeline already emits.
Dependencies: Task 4 (view can be built against production tables independently of Task 5).
Subtasks:
### 6.1. Verify `agent_run_logs` columns, then create `source_health`
- Re-verify exact `agent_run_logs` column names/status vocabulary against `supabase/migrations/` before writing SQL — implementation plan §5.3 is an indicative sketch and is expected to change here; record any drift as a drift note in this file.
- View shape: per enabled source — `last_refresh_status/error/completed_at`, failed-run count over 7 days, `last_clean_run_at`.

### 6.2. Document health thresholds
- Degraded: 2+ consecutive failed nightly refreshes, or `failed` status >48h. Suspicious: zero candidates 14+ days on a historically-producing source. Blocked: WAF/challenge markers in `last_refresh_error`.
- Thresholds live in the alert function and this doc, not encoded in the view.

### 6.3. Create `atlas-health-report` edge function + cron
- New read-only edge function querying `source_health`; returns HTTP 500 listing breaching sources when any threshold trips — the established SCHEDULER ALERT loud-failure pattern (commit `21103ea`), visible in `cron.job_run_details.return_message`.
- pg_cron job seeded by migration (`atlas_health_cron`), UTC schedule, honoring every lesson from the 2026-07-01 nightly-cron investigation: correct body, no reliance on `status='succeeded'` (it only means the HTTP call was made), no secret-header mismatch.

### 6.4. Acceptance criteria
- With production currently healthy, the cron records a clean run.
- A breach (natural failure, or a temporarily mis-pointed disabled test source) produces a 500 whose `return_message` names the source and threshold within one cron cycle.
- No existing edge function or worker file modified.

## Task 7 - RECON REPORT TEMPLATE & DOCS/RECON STRUCTURE 📋 PLANNED
Objective: standardize the artifact that gates all driver work. No schema dependency — may start immediately.
Dependencies: none.
Subtasks:
### 7.1. Create `docs/recon/TEMPLATE.md`
- Structure lifted from the two proven exemplars (DPW handoff §0, LACMTA handoff §1): verified-findings-first with a "supersedes assumptions" rule; every finding labeled verified vs. inferred with evidence; portal architecture; listing/pagination/detail structure; identifiers and idempotency-key candidates; document access model (public metadata vs. gated files); anti-bot behavior **including the transport-tier verdict** (plain HTTP / local Chromium / Browserbase — which tier the portal blocks); explicit remaining unknowns; driver recommendation (family, expansion model, effort class).
- Header block: agency, portal URL, date, registry row reference, evidence-bundle path.

### 7.2. Register existing recon docs
- DPW and LACMTA recon reports remain at their `docs/handoff/` paths (immutable history); `agency_portals.recon_doc_path` points there (done in Task 4.3). New recon reports go to `docs/recon/YYYY-MM-DD-<agency>.md`.
- `docs/recon/README.md`: one paragraph on the convention plus an index of existing reports.

### 7.3. Acceptance criteria
- A dry-run: retro-fitting the LACMTA findings into the template loses no information category (checklist comparison, not a rewrite).

## Task 8 - /AGENCY-RECON PLAYBOOK & EVIDENCE COLLECTOR 📋 PLANNED
Objective: codify the recon workflow so the mechanical 30% is automated and the judgment 70% is procedural. No schema dependency.
Dependencies: Task 7 (template); Task 1 for the registry-update steps to be executable.
Subtasks:
### 8.1. Write `docs/recon/PLAYBOOK.md`
- The canonical procedure: (1) query registry — stop if `excluded` or recon already `complete`; (2) read `portal_families` priors for the suspected family; (3) verify official portal via the agency-website → procurement-page → portal backlink chain, capture `evidence_url`; (4) classify against `detection_patterns`; (5) probe transport tiers **in order** — plain HTTP → local headless Chromium → Browserbase — recording which tier blocks (the LACMTA lesson as procedure: a local-Chromium block is not a portal dead end); (6) run the evidence collector; (7) write the report from `TEMPLATE.md`; (8) update `agency_portals` (`recon_status`, `recon_doc_path`, `is_official`, `verified_*`) and `portal_families` (new quirks/priors) in the same session; (9) state the driver recommendation.
- Include the config-only fast path: verified `config_only`-family portals skip steps 5–7 entirely.

### 8.2. Create `.claude/commands/agency-recon.md`
- Thin command wrapper that loads the playbook and executes it for a named agency. The playbook doc is canonical; the command is convenience.

### 8.3. Build `bidbox-worker/scripts/collect-portal-evidence.js`
- Given a URL: fetch with realistic desktop UA; record HTTP status, headers, WAF markers (`X-CDN: Imperva`, `visid_incap_*`/`incap_ses_*` cookies, challenge-page bodies); note JSON/XHR endpoints where cheaply detectable; optional Browserbase escalation via existing `lib/browserbase.js` `connectBrowserbaseSession()` with screenshot capture; write the bundle to `debug-artifacts/recon/<slug>/`.
- Reuse/refactor from `bidbox-worker/scripts/validate-live-portal.js` where overlapping; operational script only — never a worker task type, no `agent_tasks` involvement.

### 8.4. Acceptance criteria
- Evidence collector runs against a known portal (DPW listing) and produces a bundle matching recorded 2026-07-01 facts (Imperva headers present, HTTP 200 with realistic UA).
- Playbook executed end-to-end against the next real target (LADWP is the named E3 candidate) — this doubles as milestone A4 and Task 10.3 input.

## Task 9 - OPPORTUNITY SOURCE LEDGER REPLACEMENT 📋 PLANNED
Objective: one source of truth for coverage; the drifted markdown ledger stops being load-bearing.
Dependencies: Tasks 4–5.
Subtasks:
### 9.1. Verify nothing is lost
- Diff ledger content against the registry: every agency, portal ID, URL, and note (including the 48397 discovery note and the "Known Coverage Gap" statement) exists in registry rows/notes or is deliberately dropped with a reason. The coverage-gap statement becomes a Phase A input recorded in the initiative doc.

### 9.2. Rewrite `docs/opportunity-source-ledger.md` in place
- Deprecation banner; pointers to `agencies`/`agency_portals`/`agency_coverage`; the canonical verification queries; the status-vocabulary mapping (Configured→row exists; Production enabled→`scan_enabled`; Scan verified→`source_health.last_clean_run_at`; Needs review→health thresholds).
- Keep the file path alive — other docs reference it (`masterplan.md`, agent-architecture §6.2); those references are updated in Task 11.

### 9.3. Acceptance criteria
- No engineering document instructs updating the ledger; ledger contains no agency table to rot.

## Task 10 - PRODUCTION VALIDATION 📋 PLANNED
Objective: prove the registry is correct against production before anything builds on it — the "repo = intended state, production = actual state" rule applied to Atlas itself.
Dependencies: Tasks 1–6, 9.
Subtasks:
### 10.1. Data integrity checks
- All Task 1–4 and 5–6 acceptance queries run against production and recorded here with results and date.
- Cross-checks: registry agency count vs. distinct production sources; every enabled source appears in `source_health`; `family_opportunity` numbers hand-verified for `planetbids` and one unbuilt family.

### 10.2. Pipeline non-interference check
- Confirm the next two nightly refreshes after all migrations run clean (`cron.job_run_details`), with source counts matching the pre-Atlas baseline. Atlas must be invisible to the data plane.

### 10.3. Workflow validation (milestone A4)
- The next real agency expansion runs through Atlas end-to-end: registry consulted first, `/agency-recon` executed, activation `opportunity_sources` INSERT carries `agency_id`, seeded `scan_enabled=false` until a live production scan passes (the DPW/LACMTA discipline, now policy), ledger never touched. Session time recorded against the LACMTA baseline.

### 10.4. Acceptance criteria
- All checks pass and are recorded; any failure becomes a drift note + fix before Phase A is considered.

## Task 11 - DOCUMENTATION & ROADMAP UPDATES 📋 PLANNED
Objective: the rest of the repo points at Atlas instead of the structures it replaced.
Dependencies: Tasks 1–10 (final task).
Subtasks:
### 11.1. Update `docs/agent-architecture-task-list.md`
- §6.3 (E2): mark as implemented by Procurement Atlas with pointers to this task list and the implementation plan. §6.5 (How to Add a New PlanetBids Agency): add the `agency_id` step and the registry-first check. Task 10.2 open items: "Begin E2 master agency portal inventory" and "Agency Access Coverage dashboard" annotated as superseded/absorbed by Atlas.

### 11.2. Update `docs/masterplan.md`
- SoCal Agency Expansion section: E2 now points at the Atlas registry; ledger reference updated to the registry + `agency_coverage`; one-paragraph statement of the control-plane/data-plane framing with a pointer to the initiative doc.

### 11.3. Update driver-facing conventions
- The Agency Direct four-seam registration checklist (DPW spec §10.2 pattern) gains the fifth non-code step: update `portal_families` + `agency_portals` on driver ship. Recorded in the playbook and referenced from the design-spec template locations — no change to the historical DPW spec itself.
- Note the `detection_patterns` ↔ `platformDetection.ts` mirror obligation wherever `platformDetection.ts` additions are documented.

### 11.4. Acceptance criteria
- `grep` for `opportunity-source-ledger` across `docs/` finds only the deprecated file itself, historical handoffs, and updated references.
- This task list's statuses updated to ✅ with completion notes, per house convention.

---

## Phase 0 Exit Criteria

- Milestones A0–A3 met (implementation plan §14); A4 met or scheduled against the next named expansion target.
- The three standing constraints are in effect and documented: derive-don't-duplicate, seeded-disabled activation discipline, ~20% time cap on Atlas work after Phase 0.
- Phase A (SoCal universe seeding + fingerprinting) is unblocked and gets its own task list; it does not begin until this list is ✅.
