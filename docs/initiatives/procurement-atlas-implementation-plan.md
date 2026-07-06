# Procurement Atlas — Engineering Implementation Plan

**Date:** 2026-07-06
**Status:** Approved for Phase 0 implementation
**Document type:** Engineering implementation plan
**Architectural source of truth:** `docs/architecture/procurement-atlas.md`
**Initiative document:** `docs/initiatives/Procurement_Atlas_Initiative_Plan.md`
**Task list:** `docs/initiatives/procurement-atlas-task-list.md`
**Branch:** `phase1-opportunity-intelligence`
**Production baseline referenced throughout:** 4 portal types (`planetbids`, `caltrans`, `lacounty_dpw`, `lacmta`); 76 configured PlanetBids sources (E1 migrations `20260608000001`, `20260609000001`); Caltrans live; LACMTA live (`20260706193000`, enabled after live validation); DPW seeded disabled (`20260701210000`).

> All schema/DDL in this document is a **specification**, not a migration. Migrations are written during implementation per the task list, following the constraints in §11 (Migration Strategy). Column lists for existing tables were read from `supabase/migrations/` at head `c4c7109`; re-verify against the migrations folder at implementation time per the repo's standing rule (declared schema = repo migrations; actual schema = production — always verify both).

---

## 1. Executive Summary

Procurement Atlas is implemented as BidBox's **expansion control plane**: three new tables in BidBox's existing Supabase project, one new nullable column on `opportunity_sources`, three derived SQL views, a recon report template plus engineering playbook in the repo, and one health-alert channel. No new services, databases, dashboards, workers, or agents.

Phase 0 (this plan's primary scope, ~2 weeks interleaved with driver work) delivers:

1. **Registry schema** — `portal_families`, `agencies`, `agency_portals`, plus `opportunity_sources.agency_id`.
2. **Backfill** — every production source, every E1 ledger agency, and every known-but-unimplemented portal becomes registry data; institutional portal knowledge from the DPW/LACMTA/PlanetBids sessions becomes `portal_families` rows.
3. **Derived views** — `agency_coverage`, `family_opportunity`, `source_health`. Implemented status and health are computed from production tables, never stored.
4. **Recon codification** — `docs/recon/TEMPLATE.md`, the `/agency-recon` playbook, and an evidence-collector script.
5. **Ledger deprecation** — `docs/opportunity-source-ledger.md` is replaced by the registry.
6. **Health alerting** — one loud channel using the established pg_cron + fail-with-500 pattern.

Later phases (A: SoCal universe seeding + fingerprinting; B: first registry-chosen family driver; C: statewide + hardening) are sequenced in §13 but not task-listed yet; each is gated on the previous phase's exit criteria.

---

## 2. Final Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              ATLAS (control plane)          │
                        │                                             │
  Seeding jobs ──────▶  │  agencies ──┬── agency_portals ──┐          │
  (Phase A)             │             │        │           │          │
                        │             │        │      portal_families │
  /agency-recon ──────▶ │             │   recon_status    (family-    │
  playbook +            │             │   recon_doc_path  level       │
  evidence collector    │             │   → docs/recon/*  memory)     │
                        │             │                               │
                        │  agency_coverage · family_opportunity ·     │
                        │  source_health   (views — derived only)     │
                        └──────┬──────────────────┬───────────────────┘
                               │ agency_id FK     │ view reads
                               ▼                  ▼
                        ┌─────────────────────────────────────────────┐
                        │             BIDBOX (data plane)             │
                        │  opportunity_sources → refresh-opportunities│
                        │  → agent_tasks → Railway worker → drivers   │
                        │  → opportunity_candidates → portal_intel    │
                        │  → document_prefetch → (user) F4            │
                        │                                             │
                        │  portal_drivers · agent_run_logs ·          │
                        │  last_refresh_* — ALL UNCHANGED             │
                        └─────────────────────────────────────────────┘
```

**Design rules (binding):**

1. **One database.** Atlas tables live in BidBox's Supabase. RLS posture mirrors `portal_drivers` (migration `20260602000002`): SELECT to `authenticated`, ALL to `service_role`.
2. **One repo.** Recon docs, playbook, and scripts are versioned in the BidBox repo.
3. **Derive, don't duplicate.** Atlas tables own only pre-production lifecycle states. `implemented`, `healthy`, `degraded` are computed in views. There is no status cell for a human to forget to update.
4. **The pipeline is the monitor.** Health views read `opportunity_sources.last_refresh_*` and `agent_run_logs`. Atlas adds zero probes.
5. **Minimal blast radius on the data plane.** Exactly one production-table change in Phase 0: a nullable `agency_id` column on `opportunity_sources`. Zero worker changes, zero driver changes, zero edge-function changes.

---

## 3. System Responsibilities

| Responsibility | Owner | Implementation |
|---|---|---|
| Agency universe (who exists) | Atlas | `agencies` table; Phase A seeding jobs |
| Portal identity + official verification | Atlas | `agency_portals` (`is_official`, `evidence_url`, `verified_by`) |
| Portal classification | Atlas utility | `portal_families.detection_patterns`, superset of `src/lib/platformDetection.ts` patterns |
| Cross-agency portal knowledge (transport, WAF, auth, quirks) | Atlas | `portal_families` columns |
| Recon state + report location | Atlas | `agency_portals.recon_status` / `recon_doc_path` → `docs/recon/*.md` |
| Recon execution | Engineer + Claude | `/agency-recon` playbook + evidence-collector script |
| Driver reuse recommendation | Atlas (deterministic) | classify portal → family row answers driver_status / expansion_model / effort |
| Expansion sequencing | Atlas (query) | `family_opportunity` view |
| Which sources get scanned | **BidBox (unchanged)** | `opportunity_sources` |
| Scan/refresh execution + status | **BidBox (unchanged)** | edge functions, worker, drivers, `last_refresh_*`, `agent_run_logs` |
| Driver catalog | **BidBox (existing)** | `portal_drivers` (referenced by Atlas views; optionally extended later) |
| Coverage + health interpretation | Atlas | `agency_coverage`, `source_health` views + alert channel |

---

## 4. Exact Database Schema Proposal

Three new tables, created in dependency order: `portal_families` → `agencies` → `agency_portals`. All specifications below are final unless implementation discovers a conflict, which must be recorded in the task list (the `lacounty-dpw-driver-task-list.md` "drift note" convention).

### 4.1 `portal_families`

Per-family institutional memory and driver economics. This table is the queryable replacement for knowledge currently buried in `docs/handoff/*.md`.

```sql
CREATE TABLE public.portal_families (
  family               text PRIMARY KEY,
  display_name         text NOT NULL,
  driver_status        text NOT NULL DEFAULT 'none'
                         CHECK (driver_status IN ('none','recon','in_development','production')),
  portal_type          text,          -- matches portal_drivers.portal_type once implemented; NULL before
  expansion_model      text
                         CHECK (expansion_model IN ('config_only','per_agency_templates','per_agency_driver')),
  transport            text,          -- 'http' | 'browserbase' | 'browserbase_download_sync' | 'unknown'
  auth_model           text,          -- 'none' | 'vendor_account' | 'sso' | 'per_agency_registration' | 'unknown'
  anti_bot_notes       text,
  known_quirks         text,
  effort_estimate      text,          -- 'config (hours)' | 'template (days)' | 'driver (1-2 wk)' | 'unknown'
  detection_patterns   text[],        -- regex sources; superset of platformDetection.ts PORTAL_PATTERNS
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

Seed rows (Phase 0, from existing production knowledge — exact values per task list Task 3):
`planetbids`, `caltrans`, `lacounty_dpw`, `lacmta` (all `driver_status='production'`), and known-but-unbuilt families: `bonfire`, `opengov`, `cal_eprocure`, `bidnet_periscope`, `demandstar`, `epro` (SB County), `ersp` (LADWP), `agency_direct_other`, `unknown`. Aggregators (RAMPLA-class) are **not** families; they are `agency_portals.role='aggregator'` rows.

Notes:
- `family` deliberately overlaps `portal_type` for implemented families (`planetbids` family ↔ `planetbids` portal_type) but they are distinct concepts: family exists pre-implementation; `portal_type` is the data-plane routing key that exists only once a driver does.
- No FK from `portal_families.portal_type` to `portal_drivers` — `portal_drivers.portal_type` is UNIQUE but the linkage is informational until a driver exists; views join on equality.

### 4.2 `agencies`

```sql
CREATE TABLE public.agencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  agency_type        text NOT NULL
                       CHECK (agency_type IN ('city','county','school_district','community_college',
                                              'water','sanitation','transit','port','airport','state',
                                              'special_district','jpa','other')),
  county             text,            -- primary county; NULL for state agencies
  state              text NOT NULL DEFAULT 'CA',
  official_website   text,
  status             text NOT NULL DEFAULT 'identified'
                       CHECK (status IN ('identified','portal_verified','recon_complete',
                                         'planned','excluded')),
  exclusion_reason   text,            -- required in practice when status='excluded'
  priority_score     integer,         -- coarse 0-100, human-set; see §4.5
  priority_notes     text,
  discovered_via     text,            -- 'production-backfill' | 'e1-ledger' | 'manual' | 'ca-cities-seed' | ...
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, state)
);

CREATE INDEX idx_agencies_status ON public.agencies(status);
CREATE INDEX idx_agencies_county ON public.agencies(county);
CREATE INDEX idx_agencies_type   ON public.agencies(agency_type);
```

What `status` deliberately does **not** include: `implemented`, `live`, `healthy` — all derived (§5).

### 4.3 `agency_portals`

```sql
CREATE TABLE public.agency_portals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  portal_url          text NOT NULL,
  procurement_page    text,           -- the agency page linking to the portal (the authority chain)
  portal_family       text REFERENCES public.portal_families(family),
  role                text NOT NULL DEFAULT 'primary'
                        CHECK (role IN ('primary','secondary','aggregator','plan_room','results_only')),
  is_official         boolean,        -- NULL = unverified; the 48397 LAWA/Valley Water case stays NULL until proven
  evidence_url        text,
  verified_at         timestamptz,
  verified_by         text,
  recon_status        text NOT NULL DEFAULT 'none'
                        CHECK (recon_status IN ('none','evidence_collected','complete','stale')),
  recon_doc_path      text,           -- e.g. 'docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md'
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, portal_url)
);

CREATE INDEX idx_agency_portals_agency_id ON public.agency_portals(agency_id);
CREATE INDEX idx_agency_portals_family    ON public.agency_portals(portal_family);
```

Multiplicity is the point: LA County DPW gets three rows — `dpw.lacounty.gov/contracts/Opportunities.aspx` (`primary`, official, recon complete), `rampla.org` (`aggregator`, explicitly ruled out per recon 0.1), `bidexpress.com` (`plan_room`, uninvestigated lead per recon 0.5).

### 4.4 `opportunity_sources.agency_id`

```sql
ALTER TABLE public.opportunity_sources
  ADD COLUMN agency_id uuid REFERENCES public.agencies(id) ON DELETE SET NULL;

CREATE INDEX idx_opportunity_sources_agency_id ON public.opportunity_sources(agency_id);
```

- **Nullable, permanently.** Nothing in the data plane reads it; a NULL breaks nothing. NOT NULL is never required — the coverage view treats an unlinked source as a data-quality row to fix, surfaced by validation (Task 10).
- This is the **only** change to any existing table in Phase 0.

### 4.5 Deliberately absent (do not add without a consuming query)

- `recon_runs` / `recon_findings` tables — recon is markdown in the repo; state is two columns on `agency_portals`.
- `implementation_plans` table — plans are initiative docs (`lacounty-dpw-driver-design-spec.md` is the exemplar), linked via `recon_doc_path`/`notes` conventions.
- Numeric confidence columns — `is_official + evidence_url + verified_by` is honest; scores are false precision.
- Priority scoring model — `priority_score` is a coarse human-set integer. Revisit only when the *ranking* is demonstrably wrong.
- `updated_at` triggers — set `updated_at` at write time from the writing session/script, matching how the existing tables are maintained. If a trigger convention is later adopted repo-wide, adopt it here too.

### 4.6 RLS (all three tables, identical, mirrors `portal_drivers`)

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read <table>"
  ON public.<table> FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can write <table>"
  ON public.<table> FOR ALL TO service_role USING (true) WITH CHECK (true);
```

Writes happen via service-role (migrations, seeding scripts, engineering sessions). No `authenticated` write path exists or is planned; if an admin UI ever needs one, it gets a scoped policy then (the `agent_tasks` INSERT-policy precedent: scope to exactly what the UI does).

---

## 5. Derived Views

### 5.1 `agency_coverage` — the registry joined to production

```sql
CREATE VIEW public.agency_coverage AS
SELECT
  a.id            AS agency_id,
  a.name,
  a.agency_type,
  a.county,
  a.status        AS pipeline_status,
  a.priority_score,
  ap.portal_url,
  ap.portal_family,
  ap.recon_status,
  pf.driver_status,
  pf.expansion_model,
  os.id IS NOT NULL AS implemented,
  os.scan_enabled,
  os.last_scanned_at,
  os.last_refresh_status
FROM public.agencies a
LEFT JOIN public.agency_portals ap
       ON ap.agency_id = a.id AND ap.role = 'primary'
LEFT JOIN public.portal_families pf
       ON pf.family = ap.portal_family
LEFT JOIN public.opportunity_sources os
       ON os.agency_id = a.id;
```

Note: an agency with multiple `opportunity_sources` rows (possible; DPW + a future second DPW listing) produces multiple coverage rows — acceptable and correct for an internal view.

### 5.2 `family_opportunity` — the E3 sequencing decision as a query

```sql
CREATE VIEW public.family_opportunity AS
SELECT
  pf.family,
  pf.driver_status,
  pf.expansion_model,
  pf.effort_estimate,
  count(*)                 FILTER (WHERE os.id IS NULL) AS agencies_unlocked,
  sum(a.priority_score)    FILTER (WHERE os.id IS NULL) AS value_unlocked,
  count(*)                 FILTER (WHERE os.id IS NOT NULL) AS agencies_live
FROM public.portal_families pf
JOIN public.agency_portals ap ON ap.portal_family = pf.family AND ap.is_official IS TRUE
JOIN public.agencies a        ON a.id = ap.agency_id
LEFT JOIN public.opportunity_sources os ON os.agency_id = a.id
GROUP BY 1, 2, 3, 4;
```

This view directly answers roadmap Task 10.2's open item: "Decide first non-PlanetBids driver after E2 shows source counts."

### 5.3 `source_health` — per-source production health

Derived from `opportunity_sources.last_refresh_*` columns (added in migration `20260625000001`) and `agent_run_logs`. Indicative shape (exact `agent_run_logs` column names must be re-verified against migrations at implementation time — this is the one view whose SQL is expected to change during Task 6):

```sql
CREATE VIEW public.source_health AS
SELECT
  os.id AS source_id,
  os.name,
  os.portal_type,
  os.agency_id,
  os.scan_enabled,
  os.last_scanned_at,
  os.last_refresh_status,
  os.last_refresh_error,
  os.last_refresh_completed_at,
  (SELECT count(*) FROM public.agent_run_logs l
    WHERE l.source_id = os.id
      AND l.status NOT IN ('complete')
      AND l.started_at > now() - interval '7 days')      AS failed_runs_7d,
  (SELECT max(l.started_at) FROM public.agent_run_logs l
    WHERE l.source_id = os.id AND l.status = 'complete')  AS last_clean_run_at
FROM public.opportunity_sources os
WHERE os.scan_enabled = true;
```

Health interpretation thresholds (documented, not encoded in the view): **degraded** = 2+ consecutive failed nightly refreshes, or `last_refresh_status IN ('failed')` for >48h; **suspicious** = enabled source with zero candidates found for 14+ days on a portal that historically produced candidates; **blocked** = failure with WAF/challenge markers in `last_refresh_error`.

### 5.4 Alert channel

One new tiny edge function, `atlas-health-report`, invoked daily by pg_cron, that queries `source_health` and **returns HTTP 500 when any source breaches a threshold** — the exact loud-failure pattern already established for `refresh-opportunities` (SCHEDULER ALERT, commit `21103ea`), making breaches visible in `cron.job_run_details.return_message` with zero new alerting infrastructure. Known pattern caveats apply and must be honored: pg_cron `succeeded` means the HTTP call was made, so diagnosis reads `return_message`; schedule expressed in UTC.

This is the only new edge function in Phase 0, and it is read-only.

---

## 6. Integration with Existing BidBox Tables

| Table | Change | Direction |
|---|---|---|
| `opportunity_sources` | `+ agency_id uuid NULL REFERENCES agencies(id)` + backfill UPDATE | Data plane row → control plane identity |
| `portal_drivers` | **None in Phase 0.** Views join `portal_families.portal_type = portal_drivers.portal_type` where useful. Candidate future extension (Phase C, only if a query needs it): `notes` column. | Read-only from Atlas |
| `agent_run_logs` | **None.** Read by `source_health`. | Read-only from Atlas |
| `opportunity_candidates`, `agent_tasks`, `opportunity_documents`, all F2/F3/F4 tables | **None.** Atlas never touches candidate-level data. | — |

Backfill mapping (Task 4): every existing `opportunity_sources` row gets an `agencies` row (name normalization: `opportunity_sources.name` is already the canonical agency name per driver convention), an `agency_portals` row (`portal_url = listing_url`, `is_official = true` with the E1 verification as evidence, family from `portal_type`), and `agency_id` set. Two special cases carried from the ledger: portal `48397` (LAWA vs. Santa Clara Valley Water District ambiguity) gets `is_official = NULL` + a note; DPW gets the three-portal-row treatment (§4.3).

---

## 7. Integration with Existing Workers

**Zero changes to `bidbox-worker/` in Phase 0.** The worker does not read Atlas tables. The claim query, `processTask()` dispatch, `persistScannedCandidate()`, and all drivers are untouched.

Phase 0 additions under `bidbox-worker/scripts/` (operational scripts, not worker tasks — same category as `validate-live-portal.js` and `refresh-portal-intelligence.js`):

- `collect-portal-evidence.js` — the recon evidence collector (Task 8): given a URL, fetch with realistic UA; record status/headers/WAF markers (`X-CDN: Imperva`, `visid_incap_*`/`incap_ses_*` cookies, Incapsula challenge bodies); detect JSON/XHR endpoints where cheaply possible; optionally escalate through transport tiers (plain HTTP → Browserbase via the existing `lib/browserbase.js` `connectBrowserbaseSession()`) and screenshot; write an evidence bundle to `debug-artifacts/recon/<slug>/`. It reuses, and may refactor from, `validate-live-portal.js`.

Future (Phase A, not Phase 0): seeding/fingerprinting batch scripts also live in `bidbox-worker/scripts/` and write to Atlas tables via `lib/supabase.js` with the service-role key.

---

## 8. Integration with Existing Drivers

**Zero changes to any driver.** Drivers remain pure data-plane components. The relationship is informational and flows one way:

- Each production driver's operational knowledge is *recorded* in `portal_families` (Task 3): PlanetBids (Browserbase transport, vendor-account auth, single-session login → `acquire_planetbids_lock`, bearer-token document fetch), Caltrans (local Playwright, `CALTRANS_EMAIL/PASSWORD` auth), LA County DPW (HTTP-first, Imperva low-friction with Browserbase fallback design §8.7, SSO-gated documents, template registry), LACMTA (Browserbase mandatory — local headless Chromium blocked with `Attack ID: 20000051`; PDF-export enumeration; downloads need CDP `Browser.setDownloadBehavior` + Browserbase downloads-zip endpoint; no stable per-item URLs).
- When a future driver is built, the Agency Direct pattern (DPW spec §10) is unchanged; the only new step is that the four-seam registration checklist gains a fifth, non-code step: *update the `portal_families` row (`driver_status`, `portal_type`, `transport`, quirks) and flip relevant `agency_portals.recon_status`.* This lands in the recon/driver playbooks, not in code.

---

## 9. Integration with Existing Edge Functions

**Zero changes to existing edge functions.** `refresh-opportunities`, `scan-opportunities`, `crawl-project`, and `qualify-candidates` never read Atlas tables — eligibility remains driven by `opportunity_sources` exactly as today.

One new edge function: `atlas-health-report` (§5.4). Read-only, service-role, invoked by a pg_cron job seeded in a migration (same mechanism as `nightly-refresh-opportunities`, including the lesson record: correct UTC schedule, body/secret pitfalls from the 2026-07-01 cron investigation).

---

## 10. Integration with Existing Engineering Workflow

The workflow Atlas codifies is the one that already produced DPW and LACMTA — with the re-derivation cost removed:

1. **Before touching any agency:** query `agency_coverage`; read the `portal_families` row and any `recon_doc_path` doc. If a prior session learned it, it is found here — not remembered.
2. **Choosing what's next:** `family_opportunity` (family-level) and `agency_coverage` ordered by `priority_score` (agency-level).
3. **Recon:** run `/agency-recon <agency>` (playbook: `docs/recon/PLAYBOOK.md`, thin command wrapper in `.claude/commands/agency-recon.md`). Steps: registry check → family priors → official-portal verification with evidence link → fingerprint/classify → **transport-tier probing in order (plain HTTP → local Chromium → Browserbase), recording which tier the portal blocks** (the LACMTA lesson as procedure) → evidence bundle via `collect-portal-evidence.js` → write `docs/recon/YYYY-MM-DD-<agency>.md` from `TEMPLATE.md` → update `agency_portals` + `portal_families` in the same session.
3a. **Config-only fast path:** verified PlanetBids (or any `expansion_model='config_only'` family) portal skips recon entirely: `agencies` + `agency_portals` rows → activation migration → live validation.
4. **Driver implementation:** unchanged — recon doc → design spec → task list → four seams (DPW spec §10.2).
5. **Activation:** one `opportunity_sources` INSERT **including `agency_id`**, seeded `scan_enabled = false`, enabled only after a real production scan passes (the DPW/LACMTA seeded-disabled discipline, now stated as policy).
6. **Post-launch:** derived views take over. Nobody updates a ledger. A degradation alert → engineer investigates → if the portal changed, set `recon_status = 'stale'` and loop.

Documentation ownership after Phase 0:
- This plan + the task list govern Atlas execution.
- `docs/agent-architecture-task-list.md` remains the OML execution source of truth; its §6.3 (E2) is marked as implemented by Atlas, and §6.5 ("How to Add a New PlanetBids Agency") gains the `agency_id` step.
- `docs/opportunity-source-ledger.md` is deprecated (§12).

---

## 11. Migration Strategy

**Environment constraints (from `docs/pending-migrations.md` and the 2026-07-01 handoff §9, all still true):** no local Supabase CLI, no CI, no direct postgres connection. Migrations are committed to `supabase/migrations/` and applied by Lovable (which may bundle/rename them) or via the Supabase dashboard SQL editor. Therefore:

1. **Naming:** descriptive timestamps, e.g. `2026MMDDHHMMSS_atlas_registry_tables.sql`, matching `20260701120000_planetbids_login_lock.sql` style.
2. **Ordering/packaging:** three migration files, applied in order —
   - M-1 `atlas_registry_tables` — `portal_families` + `agencies` + `agency_portals` + RLS + indexes.
   - M-2 `atlas_link_opportunity_sources` — `agency_id` column + index.
   - M-3 `atlas_backfill_registry` — family seeds, agency/portal backfill INSERTs, `opportunity_sources.agency_id` UPDATEs, and the two special-case annotations (48397, DPW multi-portal). Idempotent: `ON CONFLICT` on natural keys (`family`; `(name,state)`; `(agency_id,portal_url)`), mirroring the E1 seed convention (`ON CONFLICT (listing_url) DO UPDATE`).
   - M-4 (with Task 6) `atlas_views` — the three views (`CREATE OR REPLACE VIEW`).
   - M-5 (with Task 6) `atlas_health_cron` — pg_cron job for `atlas-health-report`.
3. **Track in `docs/pending-migrations.md`** from the moment each file is committed until verified applied.
4. **Verify in production before building on top** — `SELECT` from each table/view, `SELECT * FROM pg_policies WHERE tablename IN (...)`, per the standing "repo = intended state, production = actual state" rule.
5. **Zero-risk posture:** every migration is purely additive (new tables, one nullable column, views). No existing row is mutated except `opportunity_sources.agency_id` backfill UPDATEs, which no code path reads. Rollback = drop views/tables/column; no data-plane behavior depends on any of it.

---

## 12. Ledger Replacement / Deprecation

`docs/opportunity-source-ledger.md` is replaced in place (file kept, contents rewritten) with: a deprecation banner, pointers to the registry tables and `agency_coverage`, the canonical verification queries, and any ledger-only facts migrated into registry `notes` during backfill (Task 4 consumes the ledger; Task 9 verifies nothing was lost, including the 48397 discovery note and the E1 "known coverage gap" statement, which becomes a Phase A input). The old status vocabulary maps as: *Configured in migration* → registry row exists + `opportunity_sources` row exists; *Production enabled* → `agency_coverage.scan_enabled`; *Scan verified* → `source_health.last_clean_run_at IS NOT NULL`; *Needs review* → health thresholds (§5.3).

---

## 13. Rollout Strategy and Recommended Sequence

**Phase 0 — Foundation (now; ~2 weeks interleaved).** The task list. Recommended execution order within Phase 0: Task 1 → 2 → 3 → 4 (schema before data) in the first week; Tasks 5 → 6 → 9 (views + ledger, once data exists) and Tasks 7 → 8 (recon codification, parallelizable with everything) in the second; Tasks 10 → 11 (validation + docs) last. The recon playbook (7–8) has zero schema dependency and can start immediately if migration application is blocked on Lovable availability — that is the designated fallback work.

**Gate → Phase A — SoCal universe (weeks 3–6, ≤20% of engineering time).** Seed SoCal counties' cities/districts/authorities (~300–500 agencies) from published lists with `discovered_via` provenance; fingerprint batch → verification queue (capped to what gets human-reviewed the same week); PlanetBids config-only fast path resumes E1 expansion, now registry-driven. Exit: `family_opportunity` returns real counts; the next-family decision is made from data.

**Gate → Phase B — first registry-chosen family driver (months 2–3).** Recon via playbook; driver via the Agency Direct pattern; validates the full loop *registry → recon → driver → activation → derived health*. Exit: N agencies live on the new family; recon-to-live time measured against the LACMTA baseline.

**Gate → Phase C — statewide + hardening (months 3–6).** Rest-of-CA seeding; alert tuning (wire `template_unrecognized` / WAF-escalation streams when the DPW driver ships them per its spec §11.4); internal admin coverage page **only if** the SQL views are demonstrably the friction point; quarterly universe refresh.

Every phase ships standalone value even if the next never happens — that is the anti-over-engineering test applied to the roadmap itself.

---

## 14. Milestones

| Milestone | Definition of done |
|---|---|
| **A0 — Registry live** | M-1..M-3 applied and verified in production; every production source has `agency_id`; `agency_coverage` answers "what do we cover" correctly for all 4 portal types + 76+ sources. |
| **A1 — One source of truth** | Ledger deprecated; verification queries documented; no engineering doc instructs updating the ledger. |
| **A2 — Recon codified** | Template + playbook + evidence collector merged; DPW and LACMTA recon docs registered via `recon_doc_path`; `portal_families` carries their institutional knowledge. |
| **A3 — Health visible** | `source_health` + `atlas-health-report` cron live; a simulated failure (toggle a source to a broken URL in staging or observe a natural failure) surfaces in `cron.job_run_details` within 24h. |
| **A4 — Proven in anger** | The next agency expansion (LADWP is the named E3 target) runs end-to-end through Atlas: registry consulted first, `/agency-recon` executed, activation row carries `agency_id`, ledger never touched. Session time measured against LACMTA baseline. |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Migration application blocked (Lovable unavailable; no CLI/CI) | Track in `docs/pending-migrations.md`; dashboard SQL editor is the fallback path; recon-codification tasks (7–8) proceed schema-free meanwhile. |
| Lovable bundles/renames migrations (observed `20260701175427` precedent) | Verify applied state by querying production objects, never by filename presence. |
| Backfill name mismatches (source names vs. canonical agency names) | Backfill maps by `opportunity_sources.id`, not by name matching; names are normalized once, in the migration, reviewed in PR. |
| `agent_run_logs` schema drift vs. §5.3 sketch | Task 6 verifies exact columns against migrations before writing the view; drift recorded as a task-list drift note. |
| Registry rot in pre-production states | Recon skill updates the registry as a mandatory step; `excluded` is terminal; Phase A verification batches capped to same-week human review. |
| Atlas work displacing driver work | Hard cap: ~20% of engineering time after Phase 0; Atlas's own KPI is driver/coverage velocity. |
| Schema perfectionism / churn | Schema frozen as specified; new columns require a named consuming query; §4.5 lists the refusals. |
| Health alert noise → alert blindness | Start with conservative thresholds (§5.3); tune in Phase C; one channel only. |
| The 48397-class ambiguity poisoning the registry | `is_official = NULL` until evidence; validation (Task 10) asserts no `is_official = true` row lacks `evidence_url`. |

---

## 16. Success Criteria

Measured by expansion velocity, never registry row count:

1. **Time-to-live per agency class:** config-only in minutes-to-hours; new template in an existing Agency Direct driver ≈ a day; new family in 1–2 weeks.
2. **Zero re-recon:** every recon session starts from registry + family priors; no portal investigated twice from scratch.
3. **Zero drift for implemented agencies:** implemented/health status is derived, so it cannot disagree with production.
4. **E3 sequencing from data:** the next driver family is chosen from `family_opportunity`.
5. **Drift detection ≤ 24h:** portal structure changes and WAF escalations surface via the health channel without reading raw worker logs.
6. **A4 milestone met:** the next real agency expansion demonstrably runs through Atlas and is faster than the LACMTA baseline.
