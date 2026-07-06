# Procurement Atlas — Architecture

**Date:** 2026-07-06 (accepted; promoted from `docs/initiatives/procurement-atlas-proposal-2026-07.md` during the 2026-07-06 architecture consolidation)
**Status:** Authoritative architecture document
**Precedence:** below [`engineering-principles.md`](engineering-principles.md); above all initiatives — see [`README.md`](README.md)
**Execution documents:** `docs/initiatives/Procurement_Atlas_Initiative_Plan.md` (initiative) · `docs/initiatives/procurement-atlas-implementation-plan.md` (plan) · `docs/initiatives/procurement-atlas-task-list.md` (Phase 0 tasks)

> **Note (2026-07-06):** This document was written as a proposal and retains that voice (e.g. "if accepted", section 2's critique of the original initiative). It was accepted in full; the rewritten initiative document reflects the accepted direction. The critique sections are preserved as the rationale of record.
**Grounded in:** repo state at branch `phase1-opportunity-intelligence` (head `c4c7109`) — 4 production portal types (`planetbids`, `caltrans`, `lacounty_dpw`, `lacmta`), 76 configured PlanetBids sources, the Agency Direct driver pattern (DPW spec §10), the LACMTA recon/validation record, `docs/opportunity-source-ledger.md`, and the E1/E2/E3 expansion roadmap in `docs/agent-architecture-task-list.md`.

---

## 1. Executive Summary

**Procurement Atlas should not be a product, a platform, or a separate system. It should be BidBox's expansion control plane: a small set of tables in BidBox's own database, a codified reconnaissance workflow in BidBox's own repo, and a handful of derived views — the layer that knows the agency universe, what it costs to cover each part of it, and what's worth covering next.**

The sharpest way to state the reframe:

> BidBox's ingestion pipeline is the **data plane** — it moves opportunities from portals to estimators.
> Atlas is the **control plane** — it decides which portals the data plane should be pointed at, in what order, and with what driver, and it notices when the data plane degrades.

Everything in the original initiative that implied a second system — dedicated Supabase project, Lovable dashboard, separate Railway workers, seven autonomous agents — should be deleted. Not deferred: deleted. The repo already contains the evidence for why. `docs/opportunity-source-ledger.md` is a parallel manually-maintained registry of exactly the kind Atlas-as-separate-system would multiply, and it is **already stale** — it says "Pending production apply" for sources that have been scanned nightly in production for weeks, and it doesn't mention LACMTA at all, four days after LACMTA went live. A registry that is maintained beside production drifts from production. A registry that is *derived from* production cannot.

What survives from the original initiative — and what genuinely deserves investment — is three capabilities:

1. **A verified agency/portal registry** (the E2 "Master SoCal Agency Portal Inventory" that has sat in the roadmap as PLANNED since June), implemented as tables in BidBox's Supabase, keyed so that implementation status is *derived* from `opportunity_sources` and `portal_drivers` rather than duplicated.
2. **A codified reconnaissance workflow** — the process that produced the DPW and LACMTA recon reports, turned from tribal practice into a repeatable playbook with a standard evidence bundle and report template, so every future driver starts from an Atlas-grade recon instead of a blank page.
3. **Coverage and health visibility** — rollup views over signals the pipeline already emits (`last_refresh_status`, `agent_run_logs`, zero-candidate streaks, `template_unrecognized`), so portal drift is noticed by dashboards and alerts instead of by a customer missing a bid.

The rest of this document argues each piece, proposes the schema, kills five of the seven proposed agents, and answers the timing question: **start now, but start with two weeks of schema-and-playbook work, not a quarter of platform work.**

---

## 2. Critique of the Existing Initiative — Section by Section

### 2.1 Executive Summary (original)

> "an internal engineering product, separate from BidBox"

**Wrong framing, and the user's instinct to challenge it is correct.** Two specific problems:

- **"Separate" guarantees drift.** The proof is in-repo: the source ledger (a markdown "registry beside production") already disagrees with production on both counts that matter — what's enabled and what's verified. A separate Supabase project would drift the same way, but with more infrastructure to maintain while it drifts.
- **"Product" implies a build-out that the problem doesn't need.** The actual bottleneck in agency expansion today is not "we don't know which agencies exist." It's (a) engineering time per new *portal family* (each new family — Bonfire, OpenGov, Cal eProcure — is a driver project), and (b) re-derived context (the LACMTA session nearly deprioritized LA Metro because a WAF-block signature that PlanetBids had *already taught us about* in Task 3.1 wasn't surfaced at the moment of decision). Atlas's job is to attack (b) directly and make (a) better-sequenced. Neither requires a product.

**Better framing:** Atlas is the expansion control plane inside BidBox — schema, playbook, and views. It is a *capability* of the BidBox engineering system, not a sibling of BidBox.

### 2.2 Goals

Keep, with sharpened language:

- ✅ Verified registry of CA public-works procurement agencies (but see §2.9 — completeness is a milestone, not the mission).
- ✅ Distinguish official portals from aggregators (already proven necessary: RAMPLA looked authoritative and was ruled out in favor of `dpw.lacounty.gov`; recon 0.1 in the DPW handoff is the template for this judgment).
- ✅ Engineering-quality recon reports (but produced by a codified human+Claude workflow with automated evidence collection — not by an autonomous agent; see §6).
- ✅ Driver reuse recommendation (but this is mostly *deterministic*, not agentic — see §2.6).
- ✅ Planning layer for expansion.

Remove:

- ❌ Anything implying Atlas runs its own ingestion, browsing fleet, or persistent agent workforce.

Add (missing from the original):

- ➕ **Registry truth is derived, not duplicated.** For any agency that is implemented, Atlas's answer to "is this live? is it healthy?" must be computed from `opportunity_sources` / `agent_run_logs`, never hand-updated. Atlas tables only own the *pre-production* lifecycle (identified → verified → reconned → planned).
- ➕ **Prioritization is portal-family-first.** The single highest-leverage analytical output of Atlas is: *"agencies unlocked per driver family, weighted by value."* PlanetBids proved the economics — one driver, 76+ agencies, config-only expansion. The registry exists substantially to reveal which family is the next PlanetBids.
- ➕ **Institutional memory as a first-class goal.** Portal facts with cross-agency reach (WAF signatures and which transport defeats them, download-retrieval quirks on Browserbase, single-session login constraints) must be recorded where the *next* recon will hit them, not only in the handoff doc of the session that learned them.
- ➕ **Kill the markdown ledger.** `docs/opportunity-source-ledger.md` gets replaced by (or regenerated from) the registry. One source of truth.

### 2.3 Core Principles

All five originals survive. "Official government sources only" and "evidence-backed conclusions" are validated by real incidents (RAMPLA; the portal-48397 LAWA/Valley Water ambiguity flagged in the ledger's Discovery Notes). Add a sixth: **derive, don't duplicate** (per above).

### 2.4 High-Level Architecture

The original's linear pipeline (Queue → Discovery → Verification → Classification → Recon → Planning → Registry → Approval → Implementation) is a reasonable *lifecycle*, but it's drawn as if each stage is an automated system. Re-answer the ownership question posed in the assignment:

| Responsibility | Should Atlas own it? | How |
|---|---|---|
| Agency discovery | Yes — as **batch seeding jobs**, not a persistent agent. The CA agency universe is nearly static (58 counties, ~482 cities, ~940 school districts, ~2,100+ special districts; published lists exist). One good seeding pass + occasional refresh. |
| Portal classification | Yes — as a **utility, mostly deterministic**. `src/lib/platformDetection.ts` already classifies 8 portal types by URL regex. PlanetBids classification is literally a URL pattern (`vendors.planetbids.com/portal/{ID}`). Extend that, don't agent-ify it. |
| Official-portal verification | Yes — **human-in-the-loop with evidence links**. Cheap per-agency, judgment-heavy, catastrophic when wrong (an aggregator mistaken for the source of truth poisons everything downstream). |
| Recon | Yes — as a **codified workflow** (playbook + evidence collector + report template), executed by engineer+Claude in a session. See §6. |
| Implementation planning | **No.** The recon report *is* the planning input, and the DPW design spec proves the format: a spec written from recon so "a second engineer can implement without revisiting the portal." Driver recommendation is a lookup (known family → reuse; unknown → Agency Direct pattern). No planner agent. |
| Health monitoring | **Shared.** The data plane already emits the signals (`last_refresh_status`, `last_refresh_error`, scheduler 500-on-zero-queued, fail-loud-on-structure-change, `template_unrecognized`). Atlas owns the *rollup and alerting*, not new probes. The nightly production scan **is** the health check — a separate re-visiting agent would be a second, worse monitor. |

### 2.5 Major Components

- **Agency Registry** — keep, as BidBox tables (§5).
- **Portal Registry** — keep, split into per-portal rows (`agency_portals`) plus per-*family* knowledge (`portal_families`), which is where the cross-agency institutional memory lives (auth model, WAF behavior, transport requirements, pagination quirks). The family table is the component the original missed, and it's the one the LACMTA incident argues for hardest.
- **Recon Reports** — keep, but as **versioned markdown in the repo** (`docs/recon/`), exactly like today's handoffs, with a DB row carrying status + pointer. The handoff docs are the best artifacts in this codebase; don't move that writing into database blobs (`markdown_report` columns) where it can't be diffed, reviewed, or read in context.
- **Driver Catalog** — **already exists**: `portal_drivers`. Extend it; do not rebuild it.
- New: **Coverage & Health views** — SQL views joining registry ↔ production (§5.4).

### 2.6 Suggested Database (original)

Directionally useful, wrong in three ways — see §5 for the replacement. Summary of the critique:

1. **Separate Supabase project** — rejected outright (drift; plus the registry *must* join against `opportunity_sources`, `portal_drivers`, and `agent_run_logs` to derive status, which a separate project can't do).
2. **`recon_runs.markdown_report` / `recon_findings` with per-finding confidence scores** — over-modeled. Recon output is prose + evidence; it belongs in the repo. A findings table with `confidence` and `verified` columns is a data model for an autonomous system that shouldn't exist.
3. **No linkage to production entities** — the original tables float free of `opportunity_sources`. The essential foreign key of the whole design is `opportunity_sources.agency_id`.

### 2.7 Autonomous Agents (original: seven)

Collapse to two batch jobs plus one codified workflow. Full reasoning in §6. Verdict per original agent:

| Original agent | Verdict |
|---|---|
| 1. Agency Discovery | **Demote to batch seeding job.** Static universe; published lists. |
| 2. Official Portal Finder | **Merge with #3** into one verification workflow (finding the portal and proving it's official are one act). |
| 3. Authority Verification | **Merge with #2**; human-approves, evidence-linked. |
| 4. Portal Classification | **Demote to utility function** — extend `platformDetection.ts` patterns + an HTTP fingerprint probe. |
| 5. Browser Recon Agent | **Split:** automate *evidence collection* (fetch listing, capture headers/WAF markers/screenshots/robots, probe for APIs); keep *synthesis and conclusions* with engineer+Claude. See §6.2 for why full autonomy here is the most dangerous idea in the original doc. |
| 6. Engineering Planner | **Delete.** Recon report + driver catalog + the Agency Direct pattern already answer "what do we build and how." Effort estimation is a table lookup by family, not an agent. |
| 7. Health Check Agent | **Delete as an agent; keep as views + alerts** over signals production already emits. |

### 2.8 Integration with Existing BidBox

The original says "import current opportunity_sources, drivers, agencies, recon docs." Right instinct, insufficient ambition: importing is a one-time copy that immediately starts rotting. The correct design is the FK: Atlas tables and BidBox tables live in one schema, `opportunity_sources` points at `agencies`, and implemented-status is a join, not a column. §7 details ownership boundaries.

### 2.9 Dashboard

Not Lovable, not a separate app, and initially not even a page. Engineers doing this work live in the repo and in Claude sessions, not in dashboards. Sequence: **SQL views first** (queryable in Supabase, in sessions, in CI), then — only if reaching for those views becomes frequent — one internal admin page inside the existing BidBox app (there is already an admin surface: `AdminAnalytics.tsx`, `AdminNetworkSubs.tsx`). The roadmap already anticipates this as the "Agency Access Coverage dashboard for internal BidBox operations" (Task 10.2). A "Coverage Map" visualization is a vanity artifact until someone asks a question only a map answers.

### 2.10 Milestones

Original M1–M4 build infrastructure first and value last, and M4 ("statewide coverage, continuous monitoring") is a horizon, not a milestone. Replaced in §9.

### 2.11 Immediate Priority ("Do NOT begin this initiative yet")

That instruction was correct when written and is now stale — but only partially. What changed:

- The Agency Direct pattern is designed, implemented twice (DPW, LACMTA), and validated live. The abstraction Atlas plans *around* now exists.
- The manual ledger has demonstrably failed as a registry, so the registry problem is no longer hypothetical.
- E2 (the inventory) has been "PLANNED" in the roadmap for a month, and E3 driver-family sequencing ("Decide first non-PlanetBids driver after E2 shows source counts" — Task 10.2) is *blocked on it*. The next portal-family decision is currently ungrounded.

**Recommendation: begin the Atlas MVP now — as roughly two weeks of interleaved work, not as a program.** Do not begin autonomous discovery, recon automation beyond evidence collection, or any dashboard build. Full timing argument in §11.

---

## 3. Proposed Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              ATLAS (control plane)          │
                        │                                             │
  Seeding jobs ──────▶  │  agencies ──┬── agency_portals ──┐          │
  (CA universe,         │             │        │           │          │
   PlanetBids sweep)    │             │        │      portal_families │
                        │             │        │      (institutional  │
  Recon playbook ─────▶ │             │   recon status    memory)     │
  (engineer + Claude,   │             │   + pointer to               │
   evidence collector)  │             │   docs/recon/*.md            │
                        │             │                               │
                        │      coverage & health views (derived)      │
                        └──────┬──────────────────┬───────────────────┘
                               │ agency_id FK     │ reads
                               ▼                  ▼
                        ┌─────────────────────────────────────────────┐
                        │             BIDBOX (data plane)             │
                        │  opportunity_sources → agent_tasks →        │
                        │  Railway worker → drivers → candidates →    │
                        │  portal_intelligence → prefetch → F4        │
                        │  (portal_drivers, agent_run_logs,           │
                        │   last_refresh_status — unchanged)          │
                        └─────────────────────────────────────────────┘
```

Design rules:

1. **One database.** Atlas tables live in BidBox's Supabase, service-role writable, authenticated-readable (internal), mirroring `portal_drivers`' RLS posture.
2. **One repo.** Recon docs, the playbook, seeding scripts, and fingerprint utilities live in the BidBox repo. Recon reports are reviewable artifacts like code.
3. **Derive, don't duplicate.** Atlas owns lifecycle states that precede production (`identified` → `portal_verified` → `recon_complete` → `planned`). Everything at or after `implemented` is computed by joining `agency_portals` → `opportunity_sources` (via `agencies`) → `agent_run_logs`. There is no `status = 'live'` cell for a human to forget to update.
4. **The pipeline is the monitor.** Health = views over what nightly scans already record. Atlas adds interpretation (streak detection, family-level rollups, alert thresholds), not probes.
5. **Agents only where a loop over external evidence is genuinely needed** (§6). Everything else is a script, a view, or a workflow.

The agency lifecycle Atlas manages:

```
identified → portal_verified → classified → recon_complete → planned
    → (config-only family? skip recon-heavy path) → implemented* → healthy*/degraded*/blocked*
                                                    (*derived states, never stored)
```

Config-only fast path matters: for a verified PlanetBids agency, the lifecycle collapses to *identified → portal_verified → implemented* with one `opportunity_sources` INSERT — Atlas should make that path nearly frictionless, because it's where most raw coverage numbers will come from.

---

## 4. Proposed MVP (the smallest version that accelerates BidBox immediately)

Roughly two weeks of interleaved effort, three deliverables, no new infrastructure:

**MVP-1: Registry schema + backfill (≈3–4 days).**
Migrations for `agencies`, `agency_portals`, `portal_families` (§5); add `agency_id` to `opportunity_sources`. Backfill from what already exists: 76 E1 PlanetBids sources (ledger + migrations), Caltrans, DPW, LACMTA, plus the already-known-but-unimplemented portals (LADWP/ersp, SB County/epro, Bonfire — patterns already in `platformDetection.ts`). Create the coverage view. Rewrite `docs/opportunity-source-ledger.md` as a pointer to the registry (or a generated export). **Exit criterion: the question "what do we cover, what's verified, what's next" has exactly one answer surface, and it cannot drift for implemented agencies.**

**MVP-2: Recon playbook + evidence collector (≈3–4 days).**
Codify what the DPW and LACMTA sessions did ad hoc:
- `docs/recon/TEMPLATE.md` — the standardized report structure, lifted from the best sections of the two existing handoffs (verified-findings-first, evidence-labeled, "supersedes assumptions" discipline, explicit unknowns, transport verdict).
- A `.claude` skill (e.g. `/agency-recon <agency>`) encoding the sequence: check registry first → check `portal_families` for prior art → verify official portal (backlink proof) → fingerprint → probe transport tiers (curl → local Chromium → Browserbase, *in that order, recording which tier the portal blocks* — the LACMTA lesson as procedure) → capture evidence bundle → write report → update registry row.
- An evidence-collector script (grow `bidbox-worker/scripts/validate-live-portal.js`) that fetches the listing, records headers/WAF markers (`X-CDN: Imperva`, Incapsula cookies), checks for JSON/XHR endpoints, and screenshots via Browserbase — the mechanical 30% of recon, automated; the judgment 70% stays in-session.
**Exit criterion: the next agency recon (LADWP is the named next target in E3) runs through the playbook and takes measurably less session time than LACMTA's.**

**MVP-3: Health rollup + alerting (≈2–3 days).**
`source_health` view (per-source: last success, current failure streak, zero-candidate streak, last error) + family rollup + one alert channel (the pattern exists: scheduler already 500s loudly for pg_cron visibility). Wire `template_unrecognized` and WAF-escalation counts in when the DPW driver ships them (its spec §11.4 already commits to structured alerting).
**Exit criterion: a portal structure change or WAF escalation surfaces within 24h without anyone reading raw worker logs.**

Explicitly **not** in the MVP: agency universe seeding beyond what's already known (Phase A1, §9), any autonomous discovery, any dashboard page, any recon automation beyond the evidence collector, PlanetBids sweeping.

---

## 5. Recommended Database

Extend BidBox's Supabase. Four tables (one exists), two views.

### 5.1 `agencies` — the universe

```sql
CREATE TABLE agencies (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  agency_type        text NOT NULL,          -- city | county | school_district | community_college |
                                             -- water | sanitation | transit | port | airport | state |
                                             -- special_district | jpa | other
  county             text,                   -- primary county; NULL for state agencies
  state              text NOT NULL DEFAULT 'CA',
  official_website   text,
  status             text NOT NULL DEFAULT 'identified'
                       CHECK (status IN ('identified','portal_verified','recon_complete',
                                         'planned','excluded')),
  exclusion_reason   text,                   -- e.g. 'no public works program', 'dissolved'
  priority_score     integer,                -- coarse 0–100, human-set initially (see §5.5)
  priority_notes     text,
  discovered_via     text,                   -- 'e1-ledger' | 'ca-cities-seed' | 'manual' | ...
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, state)
);
```

Note what `status` does **not** include: `implemented`, `live`, `healthy`. Those are derived (§5.4). `excluded` matters as much as any positive state — "we looked, there's nothing to cover, stop re-investigating" is real information (the anti-re-recon guarantee).

### 5.2 `agency_portals` — where each agency procures

```sql
CREATE TABLE agency_portals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  portal_url          text NOT NULL,
  procurement_page    text,                  -- the agency page that links to the portal (the authority chain)
  portal_family       text REFERENCES portal_families(family),
  role                text NOT NULL DEFAULT 'primary'
                        CHECK (role IN ('primary','secondary','aggregator','plan_room','results_only')),
  is_official         boolean,
  evidence_url        text,                  -- proof of the official backlink
  verified_at         timestamptz,
  verified_by         text,
  recon_status        text NOT NULL DEFAULT 'none'
                        CHECK (recon_status IN ('none','evidence_collected','complete','stale')),
  recon_doc_path      text,                  -- e.g. 'docs/recon/2026-07-01-lacounty-dpw.md'
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, portal_url)
);
```

Why a separate table from `agencies`: multiplicity is real and already observed — DPW has a native portal *and* RAMPLA (aggregator) *and* Bid Express (plan room / possible alternate document source). The `role` column is exactly the RAMPLA lesson made schema.

Recon reports stay in the repo as markdown; `recon_doc_path` is a pointer. This keeps recon reviewable in PRs, diffable, and readable where engineers actually work, while the DB knows recon state.

### 5.3 `portal_families` — institutional memory (the table the original plan missed)

```sql
CREATE TABLE portal_families (
  family               text PRIMARY KEY,     -- 'planetbids','caltrans','lacounty_dpw','lacmta',
                                             -- 'bonfire','opengov','cal_eprocure','bidnet','demandstar',
                                             -- 'agency_direct_other','unknown'
  display_name         text NOT NULL,
  driver_status        text NOT NULL DEFAULT 'none'
                         CHECK (driver_status IN ('none','recon','in_development','production')),
  portal_type          text,                 -- FK-in-spirit to portal_drivers.portal_type once implemented
  expansion_model      text,                 -- 'config_only' | 'per_agency_templates' | 'per_agency_driver'
  transport            text,                 -- 'http' | 'browserbase' | 'browserbase_with_download_sync' | ...
  auth_model           text,                 -- 'none' | 'vendor_account' | 'sso' | 'per_agency_registration'
  anti_bot_notes       text,                 -- 'Imperva low-friction as of 2026-07; realistic UA passes'
  known_quirks         text,                 -- 'blocks local headless Chromium (same signature as PlanetBids);
                                             --  Browserbase downloads need CDP setDownloadBehavior + zip endpoint'
  effort_estimate      text,                 -- 'config (hours)' | 'template (days)' | 'driver (1–2 wk)'
  detection_patterns   text[],               -- regex sources mirroring platformDetection.ts
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
```

This is where the LACMTA near-miss becomes structural knowledge. "Local headless Chromium gets `Attack ID: 20000051`; Browserbase passes" cost most of a session to learn and was almost mis-concluded as "Metro is a dead end." Recorded here, the next Oracle/ADF or WAF-fronted portal recon starts from it. Driver reuse recommendation — one of the user's core asks — becomes a `SELECT`: classify the portal into a family; the family row says whether a driver exists, what expansion model applies, and what it costs.

### 5.4 Derived views — where "is it live, is it healthy" actually lives

```sql
-- Coverage: registry joined to production; implemented-status computed, never stored
CREATE VIEW agency_coverage AS
SELECT a.id, a.name, a.agency_type, a.county, a.status AS pipeline_status,
       ap.portal_family, pf.driver_status,
       os.id IS NOT NULL                                   AS implemented,
       os.scan_enabled, os.last_scanned_at, os.last_refresh_status,
       a.priority_score
FROM agencies a
LEFT JOIN agency_portals ap  ON ap.agency_id = a.id AND ap.role = 'primary'
LEFT JOIN portal_families pf ON pf.family = ap.portal_family
LEFT JOIN opportunity_sources os ON os.agency_id = a.id;

-- The prioritization query Atlas exists to answer:
-- agencies unlocked per not-yet-built driver family
CREATE VIEW family_opportunity AS
SELECT pf.family, pf.driver_status, pf.expansion_model, pf.effort_estimate,
       count(*) FILTER (WHERE os.id IS NULL)              AS agencies_unlocked,
       sum(a.priority_score) FILTER (WHERE os.id IS NULL) AS value_unlocked
FROM portal_families pf
JOIN agency_portals ap ON ap.portal_family = pf.family AND ap.is_official
JOIN agencies a        ON a.id = ap.agency_id
LEFT JOIN opportunity_sources os ON os.agency_id = a.id
GROUP BY 1,2,3,4;
```

Plus a `source_health` view (per-source failure/zero-candidate streaks from `agent_run_logs` + `opportunity_sources.last_refresh_*`). These three views *are* the dashboard for the MVP.

### 5.5 What is deliberately absent

- **`recon_runs` / `recon_findings` tables** — recon is markdown in the repo; state is two columns on `agency_portals`.
- **`implementation_plans` table** — plans are initiative docs (the DPW spec is the exemplar); the registry links to them via `notes`/`recon_doc_path` conventions.
- **Numeric confidence columns** — false precision; `is_official + evidence_url + verified_by` is honest.
- **A fancy priority model** — `priority_score` is a coarse human-set integer informed by capital program size, customer geography, and observed opportunity volume. Revisit only when the *ranking* (not the score) is demonstrably wrong. Resist scoring-model engineering; the E3 priority list has so far been obvious by inspection.
- **A separate Atlas database** — argued to death above.

---

## 6. Recommended Agent Architecture

### 6.1 What survives (two batch jobs + one codified workflow + zero standing agents)

**Job A — Universe seeding (batch, phased, mostly one-time).** Ingest published lists: 58 counties; ~482 cities (League of CA Cities); school + community college districts (CDE); special districts (State Controller / CSDA); state agencies. Claude-in-session or a script normalizes into `agencies` rows with `discovered_via`. Phased SoCal-first (§9). Re-run quarterly at most. This is a *task you run*, not an agent that lives.

**Job B — Portal fingerprinting (utility, semi-automated).** Given `agencies` rows with websites: find the procurement page, classify the portal against `portal_families.detection_patterns` (superset of `platformDetection.ts`), record the evidence chain, flag ambiguities (like portal 48397's LAWA/Valley Water conflict) for human verification. PlanetBids detections feed the config-only fast path directly. This can be a Claude-driven batch with human review of the output table — the judgment call ("is this official?") stays human-approved, exactly as the original's Authority Verification agent intended, minus the standing infrastructure.

**Workflow C — Recon (the playbook; engineer + Claude + evidence collector).** Described in §4 MVP-2. The evidence collector automates the mechanical portion; the session does the thinking; the template disciplines the output; the registry records the state.

### 6.2 Why not autonomous recon (the strongest disagreement with the original — and with "Atlas should automatically produce engineering-quality reconnaissance")

The LACMTA session is the controlling case study. An autonomous recon agent hitting Metro would have observed: plain HTTP returns only an ADF bootstrap script; headless Chromium gets a hard WAF block (`Attack ID: 20000051`); no API endpoints in traffic. The evidence-consistent — and wrong — report writes itself: *"JS-required portal, blocks automation, no API: deprioritize."* The correct conclusion required (a) remembering that PlanetBids once showed the identical block signature and was solved by a transport change, (b) designing a disambiguation experiment (curl vs. Playwright-elsewhere vs. Playwright-on-Metro), and (c) knowing BidBox's production transport is Browserbase, not local Chromium. That is engineering judgment plus institutional context — precisely what current-generation autonomous browsing agents produce *plausible* versions of, which is worse than producing nothing, because plausible-wrong recon gets built on. Recon conclusions gate weeks of driver work; the cost asymmetry says: automate evidence, human-verify conclusions. Revisit in a year if evidence bundles + `portal_families` priors make synthesis reliably mechanical.

The same logic kills the **Engineering Planner** agent (the recon report and the Agency Direct pattern already determine the plan; the DPW spec took judgment, not enumeration) and the **Health Check agent** (the nightly scan is a better health probe than any revisit-bot, because it exercises the real code path against the real portal with real parsing — a separate checker would just be a second parser that drifts from the first).

### 6.3 Cost honesty

Everything above is: migrations, one seeding effort, one script, one skill file, three views, and discipline. The original's seven-agent fleet implies prompt maintenance, browsing infrastructure, output QA, and drift management for seven systems whose combined output the above replaces at a fraction of the surface area. Agents are a liability you accept when a loop over external evidence can't be a script; none of these loops qualify yet.

---

## 7. Integration with BidBox

**Ownership boundaries:**

| Owns | Atlas (control plane) | BidBox (data plane) |
|---|---|---|
| Tables | `agencies`, `agency_portals`, `portal_families` | `opportunity_sources`, `portal_drivers`, `agent_tasks`, `opportunity_candidates`, … (all unchanged) |
| States | identified → verified → reconned → planned; excluded | scan/refresh status, run logs, candidate lifecycle |
| Artifacts | `docs/recon/*`, playbook skill, seeding scripts, views | drivers, edge functions, worker, migrations |
| Writes to the other | **One seam:** activation inserts an `opportunity_sources` row (with `agency_id`) | Never writes Atlas tables |

**Data flow (the full loop):**

```
seed → agencies → fingerprint → agency_portals(+family) → [config-only? activate now]
     → recon playbook → docs/recon/*.md + registry update → driver project (if new family)
     → activation migration: INSERT opportunity_sources(agency_id, portal_type, listing_url, scan_enabled=false)
     → live validation (the DPW/LACMTA discipline: seeded-disabled until a real production scan passes)
     → enable → nightly pipeline runs → agent_run_logs/last_refresh_* → source_health view
     → degradation alert → engineer investigates → recon marked 'stale' if portal changed → loop
```

**Engineering workflow — "the system engineers consult before writing a single line of code":**

1. Before touching a new agency: `SELECT` from `agency_coverage` + read `portal_families` row + any linked recon doc. If a prior session learned it, it's here.
2. Deciding what's next: `family_opportunity` view — this is the E3 sequencing decision ("decide first non-PlanetBids driver after E2 shows source counts") turned into a query.
3. Recon: `/agency-recon` skill → evidence bundle → report in `docs/recon/` → registry updated in the same session.
4. Implementation: unchanged — the four seams (edge functions, worker claim/dispatch, platformDetection, source row) per the DPW spec §10.2.
5. Post-launch: derived views take over; nobody updates a ledger.

Existing pipeline code changes required: **one nullable column** (`opportunity_sources.agency_id`) and nothing else. That's the correct blast radius for a control plane.

---

## 8. Long-Term Vision (1–3 years)

**Year 1 — California depth.** Registry complete for SoCal, substantially complete statewide; every implemented source healthy-or-alerting; 2–3 new portal families chosen *by the `family_opportunity` query* (likely candidates already visible: Bonfire, OpenGov, Cal eProcure — but let the counts decide); PlanetBids config-only expansion routinized to near-zero engineering cost. The measure that matters: **marginal cost per agency by class** — config-only in minutes-to-hours, new template in an existing Agency Direct driver in ~a day, new family in 1–2 weeks with recon amortized by the playbook.

**Year 2 — Atlas informs the product (without becoming one).** The registry starts answering customer-facing questions from behind the curtain: "does BidBox cover my agencies?" (sales/onboarding coverage checks against a prospect's county list), gap-driven prioritization (beta users' geography reweights `priority_score`), and agency-registration requirements (the Agency Access Management initiative) hanging off `agency_portals`. Recon evidence bundles + accumulated `portal_families` priors may make *draft* recon synthesis trustworthy enough to try — the human approval gate stays.

**Year 3 — the pattern travels.** New-state expansion (AZ, NV, TX…) becomes: run the seeding jobs, run the fingerprinter, watch known families light up config-only, recon the residue. Atlas is the reason state #2 costs a fraction of California. If autonomous recon ever earns trust, it earns it here, on the long tail of small agencies where a wrong conclusion is cheap.

At no point does Atlas grow a public surface, ingest an opportunity, or acquire a second database. The constraint set in the assignment — Atlas feeds BidBox, full stop — holds at every horizon.

---

## 9. Implementation Roadmap

**Phase 0 — MVP (now; ~2 weeks interleaved with driver work).** §4: schema + backfill + ledger replacement; recon playbook + evidence collector; health views + one alert. Dependencies: none. Risk: schema bikeshedding — timebox it; the schema in §5 is deliberately boring.

**Phase A — SoCal universe (weeks 3–6, a few hours/week alongside LADWP/driver work).**
A1: seed SoCal counties' cities, districts, transit/water/ports (~300–500 agencies). A2: fingerprint batch → family classification → verification queue. A3: PlanetBids fast-path — every newly verified PlanetBids portal becomes a config-only activation candidate (continuing E1, now registry-driven). Exit: `family_opportunity` returns real counts; the next-family decision (E3) is made from data. Risk: verification queue rot — cap A2 batches to what gets human-reviewed the same week.

**Phase B — first registry-chosen family driver (month 2–3).** Whatever `family_opportunity` says (hypothesis: Bonfire or OpenGov). Recon via playbook; driver via Agency Direct/four-seams pattern; validates the whole loop end-to-end: *registry → recon → driver → activation → derived health*. Exit: N agencies live on the new family; recon-to-live time measured against LACMTA baseline.

**Phase C — statewide + hardening (months 3–6).** Rest-of-CA seeding; alert tuning (WAF-escalation and `template_unrecognized` streams from the DPW driver's committed alerting); admin coverage page **only if** the SQL views are demonstrably the friction point; quarterly universe refresh cadence.

**Sequencing rationale:** every phase ships value even if the next never happens (MVP alone kills ledger drift and re-recon; Phase A alone grounds the E3 decision; Phase B alone adds coverage). That's the anti-over-engineering test applied to the roadmap itself.

**Cross-cutting risks:** (1) Atlas work displacing driver work — mitigate by capping Atlas to ~20% of engineering time after Phase 0; the control plane exists to accelerate the data plane, and the ratio enforces it. (2) Registry rot in pre-production states — mitigate by making the recon skill update the registry as a step, and by `excluded` being a first-class terminal state. (3) Seeding garbage-in — `discovered_via` provenance + verification gate before anything is treated as fact.

---

## 10. Critical Risks — How Atlas Becomes Over-Engineered, and the Tripwires

1. **The second-system trap** (separate DB/dashboard/workers). Prevention: the constraint is architectural — Atlas has no infrastructure to expand. Tripwire: any PR that adds an Atlas-only service, deployment, or database is rejected by definition.
2. **Agent romanticism** — building agents 1–7 because agents are exciting. Prevention: §6's test — *an agent is justified only when a loop over external evidence can't be a script and its errors are cheap.* Tripwire: any proposed agent must name the decision it's allowed to get wrong.
3. **Registry perfectionism** — modeling every agency attribute before covering agencies. Prevention: schema is frozen boring (§5); new columns require a query that needs them. Tripwire: schema churn without a consuming query.
4. **Completeness as vanity metric** — "3,000 agencies in the registry!" while coverage-weighted-by-customer-value stagnates. Prevention: the KPI is **time-to-live per agency class** and **agencies-live per family**, never registry row count.
5. **Recon automation before recon trust** — plausible-wrong autonomous recon compounding into wasted driver work (the LACMTA counterfactual). Prevention: evidence automated, conclusions human-approved, period; revisit annually with the trust question, not the capability question.
6. **Dashboard before question** — building UI nobody queries. Prevention: views first; a page only when reaching for the views is the demonstrated bottleneck.
7. **Atlas displacing shipping** — the meta-risk. Prevention: the 20% cap (§9); Atlas's own success metric is *driver and coverage velocity*, so if Atlas work isn't speeding up the data plane, Atlas is failing by its own KPI.

---

## 11. Final Question — Would I Build Atlas?

**Yes — and I would have started it two weeks ago, in the same session that shipped the LACMTA driver. But I would build about 15% of what the original document describes, and I'd build it inside BidBox.**

**Why yes:** Three forcing functions are already visible in the repo. First, the ledger has failed — the coverage source of truth is stale markdown, and that gets worse with every agency added. Second, the LACMTA session proved that institutional portal knowledge is the difference between "Metro is live with 75 solicitations" and "Metro is a dead end" — and that knowledge currently lives in handoff docs that must be *remembered* rather than a registry that is *consulted*. Third, the roadmap's own next decision ("which non-PlanetBids driver first?") is explicitly blocked on an inventory that doesn't exist. Those aren't hypothetical future needs; they're present-tense debts.

**Why now:** The timing objection in the original doc ("establish expansion momentum first") has been satisfied. The Agency Direct pattern exists, is documented to spec quality, and is validated live twice. Abstractions built before n=2 are speculation; abstractions built at n=4 portal types and n=2 agency-direct drivers are engineering. Waiting longer just means more agencies accumulate in an unstructured ledger and more recon knowledge accumulates in unqueryable prose.

**Why this shape:** Because the bottleneck analysis says so. Agency *discovery* is not scarce — published lists exist. Agency *knowledge* (which portal, which family, what it costs, what we already learned) and *driver-family engineering* are scarce. A registry + playbook + views attacks the knowledge problem at near-zero infrastructure cost and makes the driver-family sequencing decision data-driven. Seven agents and a parallel platform attack a problem BidBox doesn't have, at a cost it can't afford, with a drift guarantee it's already experienced.

**What I would not build, ever, under the Atlas name:** its own ingestion, its own database, its own product surface, or any autonomous system whose wrong conclusions are expensive and silent. Atlas succeeds precisely to the degree that it stays boring: tables, views, a template, a skill, and the discipline to keep production as the single source of truth for anything production already knows.

One sentence for the whole proposal: **make the registry a schema, the recon a playbook, the health a view, the priorities a query — and spend everything saved on drivers.**
