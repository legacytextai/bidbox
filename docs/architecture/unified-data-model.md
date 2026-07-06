# BidBox Unified Data Model, Agent Architecture, and Estimating Workflow OS

**Status:** Authoritative architecture document
**Date:** 2026-07-06 (landed from the Fable 5 architecture session of the same date)
**Precedence:** below [`engineering-principles.md`](engineering-principles.md); above all initiatives — see [`README.md`](README.md)
**Grounded in:** repo at `phase1-opportunity-intelligence` head `c4c7109` — all 31 production tables in `supabase/migrations/`, the OML/F1–F5 initiative docs, masterplan, GC Control Center direction, Phase G status, and the Procurement Atlas architecture ([`procurement-atlas.md`](procurement-atlas.md))

> **How to read this document.** Sections 1–2 record the diagnosis (including the corrected one — see below). Sections 3–5 are the durable target architecture. Section 6 is the migration strategy. Sections 7–9 are the agent architecture and workflow map. Sections 10–13 were sequencing guidance as of July 2026; execution status lives in initiatives, not here.

> **The corrected diagnosis, for the record.** This session began from the hypothesis that every user was creating their own copy of opportunities, documents, and intelligence. Reading the schema disproved that: **the canonical shared layer already exists and is well-built.** The real defect is the inverse — *tenant-specific state leaking onto canonical shared records*, plus the absence of an organization layer and a temporal layer. The architecture below protects and finishes the canonical model rather than rebuilding it.

---

## 1. Executive Summary

**The long-term architecture is four concentric rings around one canonical spine:**

```
Ring 0  ATLAS (control plane)      agencies · portals · families · sources · drivers
Ring 1  CANONICAL PROCUREMENT      opportunities · revisions · documents · pages ·
        (one copy, all tenants)    chunks · bid items · intelligence (findings+citations)
Ring 2  TENANT ORGANIZATION        companies · members · qualification profiles ·
        (who the customer is)      private sub pools · subscriptions
Ring 3  TENANT PURSUIT             pursuits · triage/go-no-go · assignments · overrides ·
        (what the customer does)   projects/bid rooms · coverage · proposals · outcomes
```

The headline findings:

1. **The canonical spine already exists and is correct.** `opportunity_candidates` is a global shared pool keyed by `source_url`; documents, pages, chunks, bid items, and the entire F4 report→finding→citation chain hang off the candidate, are written once by `service_role`, and are readable by every authenticated user. Two users who care about the same bid do **not** trigger duplicate downloads or duplicate F4 runs — `UNIQUE(opportunity_candidate_id, report_version)` and the `(candidate_id, source_url)` document idempotency key prevent it. Duplication is real only in the **legacy One Link flow** (user pastes URL → private `projects` row → private `project_files` → private crawl), which is already fenced via `projects.origin`.

2. **The actual scaling flaw is tenant state leaking onto canonical rows.** `opportunity_candidates.status` (red/yellow/green), `review_notes`, `reviewed_by`, `auto_status`, `qualification_score`, and `converted_project_id` are one tenant's opinions stored on the shared record, updatable by any authenticated user (`USING (true)`), with qualification computed against a **hardcoded** `gc_qualification_profiles` row (acknowledged in `agent-architecture-task-list.md` §5.4). This works with one customer and silently breaks with two: Company A marks a bid red and it turns red for Company B.

3. **There is no organization layer.** Tenant = `auth.uid()` everywhere (`projects.gc_id`, `gc_subcontractors.gc_id`, `gc_qualification_profiles.profile_id UNIQUE`). Two estimators at the same GC cannot exist.

4. **There is no temporal layer.** Upserts overwrite; no revision history, no addenda lifecycle, no change events (C1A is acknowledged backlog). For public works this is not a nice-to-have — a missed addendum is a rejected bid.

The foundational work is therefore three surgical moves — **introduce `companies`, introduce `pursuits` (moving all tenant opinion off canonical rows), and build change detection (C1A) as the Addenda Agent's substrate** — after which everything else composes without rework.

---

## 2. Current Architecture Assessment (as of 2026-07-06)

**What exists and works:**

| Layer | State | Evidence |
|---|---|---|
| Ingestion (data plane) | ✅ Production, 4 portal types, nightly cron | drivers, `agent_tasks`, worker, `persistScannedCandidate` |
| Canonical opportunity record | ✅ Exists de facto | `opportunity_candidates` upsert on `source_url`, OML typed columns (`20260630200000`) |
| Canonical documents & text | ✅ Exists | `opportunity_documents/pages/chunks` keyed to candidate; shared storage bucket |
| Canonical intelligence | ✅ Exists, citation-disciplined | F4 tables; "no citation = no fact" enforced in schema comments |
| Canonical bid items | ✅ Exists | `opportunity_bid_items` |
| Sub network two-pool split | ✅ Exists — **the repo's own precedent for canonical/tenant** | `subcontractors` (BidBox network pool, admin-curated, shared) vs `gc_subcontractors` (private pool) |
| Per-user save state done right | ✅ Exists — the pattern is even documented | `saved_opportunities` migration comment: *"candidates are globally visible… saved state belongs in a per-user join table instead of on the candidate row"* |
| Atlas control plane | 📋 Designed, Phase 0 planned | `docs/initiatives/procurement-atlas-*` |

**Where it does not scale — five concrete defects:**

1. **Global mutable review state on canonical rows** — `status/review_notes/reviewed_by` on `opportunity_candidates` with `UPDATE … USING (true)`. Breaks at tenant #2; also a data-integrity hole today (any authenticated user can rewrite anyone's triage).
2. **Single-tenant qualification** — `auto_status`/`qualification_score` written to the shared row from one hardcoded profile. Meaningless at tenant #2.
3. **`converted_project_id`** — a single pointer on the canonical row to *one* tenant's project. Two companies cannot both pursue the same bid, which is the *normal case* in public works.
4. **User-grade tenancy** — no companies, no teams; subscription and qualification profile hang off individual `profiles`.
5. **No change history** — refresh overwrites `crawl_data`; addenda arrive as new document rows only if a re-scan happens to fetch them; nothing notifies anyone (C1A backlog, `bid-date-authority.md`).

Scored against the original concerns: duplicated downloads/processing/AI-spend — already solved for the OML path, real only for legacy One Link; inconsistent intelligence — solved (one F4 report per candidate); storage bloat — solved on canonical docs, real for `project_files` duplicates; weak cross-user learning, harder refresh/addenda, dedup, system-of-record — real, and all downstream of defects 1–5.

---

## 3. Unified Data Model

The full entity map, with existing tables in place (→ marks rename-in-spirit; nothing needs a physical rename now):

```
RING 0 — ATLAS (internal canonical)
  portal_families ─┬─ agencies ─── agency_portals
                   └────────────── opportunity_sources ── portal_drivers

RING 1 — CANONICAL PROCUREMENT FACTS (service_role writes; all tenants read)
  opportunity_sources
    └── opportunities (today: opportunity_candidates, minus tenant columns)
          ├── opportunity_revisions        (NEW, with C1A: diff snapshots on change)
          ├── opportunity_documents        (exists; + document_class; + supersedes_document_id later)
          │     ├── opportunity_document_pages   (exists)
          │     └── opportunity_document_chunks  (exists — the shared RAG substrate)
          ├── opportunity_bid_items        (exists)
          ├── opportunity_intelligence_reports / findings / citations  (exists)
          └── (planholders: stays in crawl_data until a feature reads it)

RING 2 — TENANT ORGANIZATION
  companies (NEW — the tenant root)
    ├── company_members (NEW: profile_id + role: owner|estimator|viewer)
    ├── gc_qualification_profiles   (rescope: profile_id → company_id)
    ├── gc_subcontractors + gc_sub_trade_mappings (rescope → company_id)
    └── subscriptions (rescope → company_id at next Stripe touch)
  subcontractors + sub_trade_mappings + trade_types + cslb_cache (canonical network pool — unchanged)

RING 3 — TENANT PURSUIT STATE (RLS by company_id)
  pursuits (NEW — the central Workflow OS object)
    company_id + opportunity_id, UNIQUE(company_id, opportunity_id)
    stage: tracking→reviewing→go|no_go→estimating→submitted→won|lost|archived
    triage_status (r/y/g moves here) · triage_notes · assigned_to · bid_due_override_*
    ├── pursuit_qualifications (NEW when F5 resumes: per-company score+reasons+citations)
    ├── pursuit_analyses      (LATER: tenant-contextual AI outputs, kind+version)
    ├── projects (exists — the execution workspace & public bid room; + pursuit_id FK)
    │     ├── project_files · project_trades · project_readiness_* · bids (sub quotes)
    │     └── (proposal/submission artifacts attach here, post-MVP)
    └── pursuit_events (LATER: activity/audit feed)

RING 4 — AGENT INFRASTRUCTURE (exists)
  agent_tasks (queue) · agent_run_logs (runs) · app_settings (locks/config)
  Convention, already in use: durable outputs carry agent_task_id FK
  (opportunity_documents.agent_task_id, reports.agent_task_id)
```

**Key modeling decisions, with reasoning:**

- **`pursuits` absorbs `saved_opportunities`.** A save is a pursuit at stage `tracking`. One join table for all tenant-opinion-about-an-opportunity, instead of scattering saves, triage, go/no-go, and assignments across four tables. The `saved_opportunities` migration already articulated this principle; `pursuits` is that principle applied completely.
- **`projects` survives as the execution workspace, not the spine.** It is load-bearing today (public bid room token, sub bids, trades, readiness) and conflating it with pursuit tracking is how the current mess arose. Pursuit = *decision spine* (exists from first glance to archive); project = *execution artifact* (exists only after "go"). Phase G's "Add to Calendar creates/reuses a project" becomes "go decision creates a project under the pursuit."
- **Addenda are documents + revisions, not a new entity.** An addendum is (a) a new `opportunity_documents` row with `document_class='addendum'` and (b) an `opportunity_revisions` diff if it changed portal metadata (due date!). A dedicated addenda table waits for the Deadline Resolution Engine (already correctly deferred in `bid-date-authority.md`).
- **Extracted requirements = the F4 findings taxonomy, not a new table.** `opportunity_intelligence_findings` already stores typed, categorized, cited, confidence-scored facts. "Extracted requirements" (bonding %, DIR registration, DVBE goals, license classes) is a *category expansion* in F4's prompt + taxonomy, not new schema. Resist the parallel-table temptation.
- **Defer the rename.** `opportunity_candidates` → `opportunities` is the right *name* but a risky, zero-value *migration* today. Same judgment the repo already made for `crawl_data` → `portal_metadata` (TODO note in `20260630200000`). Do it in a quiet week post-MVP, or never.

---

## 4. Canonical vs Tenant-Specific Boundary

**The rule, stated once:** *If the fact would be identical no matter which contractor is looking at it, it is canonical and written by `service_role` exactly once. If knowing the fact tells you something about a contractor, it is tenant data and lives in Ring 2/3 under company RLS.*

| Canonical (Ring 1) | Tenant (Ring 2/3) |
|---|---|
| Agency, solicitation number, title, due date, source URL | Whether we're pursuing; stage; go/no-go and why |
| Official documents, addenda, extracted text, chunks | Estimator assignment; internal deadlines; bid_due override |
| Bid items from the portal | Our unit prices against those items |
| F4 findings + citations ("bond: 10%, cited") | Our qualification verdict ("we can't bond this") |
| Portal intelligence summary | Private notes, strategy, cost assumptions |
| Planholder lists (public record) | Which subs *we* called and what they quoted |
| Network subcontractor pool (`subcontractors`) | Private pool (`gc_subcontractors`), relationships, history |
| Public bid results, award data (future) | Our bid amount, our win/loss post-mortem |

**Two boundary subtleties:**

1. **Tenant-contextual AI output is tenant data even when derived from canonical inputs.** F4 is canonical *only because* it reads nothing but canonical documents. The moment an agent reads `gc_qualification_profiles` or the private sub pool, its output is Ring 3 (`pursuit_qualifications`, `pursuit_analyses`) — never cached cross-tenant, never visible cross-tenant.
2. **Pursuit signals must never leak sideways.** Two GCs pursuing the same job is routine; BidBox will know both. Nothing in the product may surface "N other contractors are pursuing this." (Public planholder lists are fine — they're the agency's public record, and canonical.)

---

## 5. Database Architecture — New-Table Specifications

Specifications, not migrations:

**`companies`** — `id`, `name`, `created_at`, plus Stripe linkage at the next billing touch.
**`company_members`** — `company_id`, `profile_id`, `role IN ('owner','estimator','viewer')`, UNIQUE(company_id, profile_id). Backfill: one company per existing profile, owner membership. RLS on everything in Ring 2/3 becomes `company_id IN (SELECT company_id FROM company_members WHERE profile_id = auth.uid())` — one helper function, used everywhere.

**`pursuits`** — as diagrammed in §3. Columns *moved* (not copied) from `opportunity_candidates`: `status`→`triage_status`, `review_notes`→`triage_notes`, `reviewed_by/at`→`triaged_by/at`; `converted_project_id` inverts into `projects.pursuit_id`; `auto_status/auto_status_reason/qualification_score` move to `pursuit_qualifications` when F5 resumes (they are computed by a paused agent against a hardcoded profile today — nothing of value is lost by parking them).

**`opportunity_revisions`** — `opportunity_id`, `detected_at`, `changed_fields jsonb` (old/new per field), `revision_source` (scan/refresh/manual), index on (opportunity_id, detected_at DESC). Written by `persistScannedCandidate` exactly where `changedPortalMetadata()` already computes the diff and throws it away. This one column of existing worker logic becoming a table is the entire foundation of addenda tracking, change feeds, and refresh auditability.

Everything else in Ring 1 and Ring 4 is unchanged. RLS postures stay exactly as the repo's three established patterns: canonical (read-all/write-service), tenant (company-scoped), infrastructure (service-only, with narrowly scoped exceptions like the `project_analysis` INSERT policy).

---

## 6. Migration Strategy

**The "stop digging" set — ordered, each independently shippable:**

1. **M1: `companies` + `company_members` + backfill** (one company per profile). Purely additive; nothing reads it yet.
2. **M2: `pursuits` + backfill** — one pursuit per existing non-pending candidate review, per `saved_opportunities` row, and per `origin='opportunity_intelligence'` project (stage inferred: converted→estimating, green→reviewing, saved→tracking).
3. **M3: UI cutover** — Opportunities list reads triage from the user's company pursuit (LEFT JOIN, exactly how `saved_opportunities` is already joined); writes go to pursuits. Old candidate columns become read-only fallback.
4. **M4: revoke the hole** — drop the `UPDATE USING (true)` policy on `opportunity_candidates`; authenticated users lose direct write to canonical rows. Also a security fix; should not wait long past a second active user.
5. **M5 (with the next Stripe or qualification touch):** rescope `gc_qualification_profiles`, `gc_subcontractors`, `subscriptions` to `company_id` — trivial while every company has exactly one member.

**Post-cutover:** `opportunity_revisions` + C1A change detection; `pursuit_qualifications` when F5 resumes; `pursuit_analyses`/`pursuit_events` when a feature needs them; column drops on `opportunity_candidates` after one clean month; optional rename to `opportunities`.

**Risks & backward compatibility:** every step is additive-then-cutover-then-drop, the same discipline as `projects.origin` (`20260622000001`). The known environment constraints apply (Lovable applies migrations; verify against production; track in `docs/pending-migrations.md`). The biggest real risk is *partial cutover* — triage written to pursuits while some component still reads candidate columns; mitigate by making M3 a single PR that swaps the read and write paths together, keeping old columns populated via fallback for one release. Legacy One Link projects are untouched throughout (already origin-fenced).

---

## 7. Agent Architecture

The agent inventory, mapped onto what exists — several agents are already in production under other names, and two should not be agents at all:

| Agent | Status | Owns | Reads | Writes | Output ring |
|---|---|---|---|---|---|
| **Opportunity Agent** | ✅ exists (scan drivers + refresh scheduler) | discovery & refresh of canonical opportunities | portals, `opportunity_sources` | `opportunities`, `opportunity_revisions` | Canonical |
| **Document Agent** | ✅ exists (F2 prefetch + doc drivers) | canonical document acquisition | portal doc pages, auth sessions | `opportunity_documents` + storage | Canonical |
| **Spec/Scope Agent** | ✅ exists (F3 processing + F4 intelligence) | text extraction, chunking, cited findings, scope/trade breakdown | canonical docs only — *never tenant context* | pages, chunks, reports/findings/citations | Canonical |
| **Bid Item Agent** | ✅ exists (`bid_items` driver) | portal line items | portal tabs | `opportunity_bid_items` | Canonical |
| **Addenda Agent** | 🔜 next (= C1A + bid-date-authority) | change detection, addenda classification, deadline-change candidates | `opportunity_revisions`, new doc rows | revision events, doc re-queue, notifications to affected pursuits | Canonical event → tenant notification |
| **Qualification Agent** | ⏸ exists-paused (F5) — *rescope before resuming* | per-company fit verdict with cited reasons | canonical findings + company `gc_qualification_profiles` | `pursuit_qualifications` | **Tenant** |
| **Subcontractor/Coverage Agent** | partial (call lists, trade mappings exist as features) | trade→sub matching, coverage gaps, call list priority | `project_trades`, both sub pools, engagement events | coverage suggestions on the project workspace | Tenant |
| **Compliance Agent** | 📋 post-MVP | submission checklist from cited requirements | F4 `bid_requirements` findings + project readiness | `project_readiness_items` (table already exists) | Tenant |
| **Proposal Agent** | 📋 later | package assembly assistance | checklist, company boilerplate, forms | project files/artifacts | Tenant |
| **Knowledge Agent** | 📋 later (needs bid-results data) | win/loss patterns, agency priors | outcomes, public bid results | canonical agency stats + tenant lessons | Both, strictly split |
| **Pursuit Coordinator** | ❌ **not an agent** | — | — | — | It is the `pursuits` table + deterministic enqueue rules + the UI. Making coordination an LLM agent is how spaghetti starts. |
| **Outreach Agent** | ❌ not yet | — | — | — | Masterplan is explicit: don't replace phone calls, empower them. Defer until engagement tracking proves demand. |

**Responsibility rules:** each agent owns exactly one output table-set; canonical agents never read tenant tables; tenant agents never write Ring 1; no agent calls another agent — agents enqueue follow-on `agent_tasks` rows or write tables that other agents' triggers watch.

---

## 8. Agent Orchestration and Memory

**Keep the orchestration that exists — it is already the right shape.** `agent_tasks` (queue with priority + status), deterministic enqueue seams (`persistScannedCandidate` auto-queues portal_intelligence + document_prefetch on first insert; "Add to Calendar" queues `project_analysis` via a scoped RLS policy), worker polling with claim queries, `agent_run_logs` for run bookkeeping, distributed locks in `app_settings` for single-session portals. The extensions:

- **Tenant task convention:** tenant-scoped task types carry `company_id` in payload; canonical tasks never do. One glance at a task tells you which ring it may write.
- **Dedup guards generalize:** the existing active-task guard (`.in('task_type', […])` before enqueue) is the standard for every new task type — no canonical work queued twice for the same opportunity, no tenant work twice for the same pursuit.
- **Event flow without a bus:** `opportunity_revisions` is the event log. The Addenda Agent consumes revisions; notifications fan out to `pursuits` matching the opportunity. No pub/sub infrastructure — Postgres rows + the poller, until proven insufficient.
- **Shared memory = the canonical tables themselves.** Chunks are the retrieval substrate; findings are structured memory; citations are provenance; `portal_families` (Atlas) is operational memory. Tenant memory = company profile + pursuit history + sub relationships. **No vector store, no memory service** until a retrieval quality problem is demonstrated — F4 works today reading chunks directly.
- **Human approval, generalized from the two shipped patterns:** (1) findings carry `status='needs_review'` + confidence + `is_critical`; (2) bid-date override stores machine value, human override, reason, and source side by side. Every tenant-facing agent output follows pattern 2: *suggest, never decide* — go/no-go, call lists, and compliance checklists are suggestions with a human confirmation writing the durable field.
- **Observability:** `agent_run_logs` + task status is the base; the Atlas `source_health` view is the rollup pattern to replicate for agent-level health (failure streaks per task_type). "No citation = no fact" (canonical) and "no suggestion without a reason string" (tenant) are enforced for every future agent.
- **Failure handling stays per-item-isolated** (one bad page never fails the scan) and **loud on structural anomalies** (the scheduler's 500-on-zero-queued pattern).

**Agent build sequence:** Addenda Agent (canonical, highest customer stakes) → Qualification Agent rescoped to pursuits (F5 resume) → Coverage Agent (formalizing existing call-list features) → Compliance → Proposal → Knowledge.

---

## 9. Estimating Workflow OS

The complete journey, stage by stage. Format: **Pain** → **Object** | **Canonical** | **Tenant** | **Agent** | **Human gate** | **Artifact** | **Build**.

**Phase I — Find & Decide (stages 1–3).** The funnel from noise to commitment.

1. **Discovery** — Pain: estimators check 10+ portals or miss bids entirely. Object: Opportunities feed. Canonical: opportunities + portal summaries. Tenant: qualification profile filters. Agent: Opportunity Agent ✅. Gate: none (ambient). Artifact: fresh feed. **Built — keep expanding via Atlas.**
2. **Triage** — Pain: 100 open bids, 5 worth reading. Object: opportunity cards + **pursuit (stage `tracking`)**. Canonical: OML metadata, relevance sweeper. Tenant: triage r/y/g, notes. Agent: portal_intelligence ✅. Gate: the glance — save or skip. Artifact: shortlist. **Built except the pursuit substrate (M2/M3).**
3. **Go/No-Go** — Pain: gut-feel decisions, no record of why, repeated re-litigating. Object: pursuit (stage `go`/`no_go`) + qualification. Canonical: F4 findings (bond, license, size, dates). Tenant: company profile, verdict, reasons. Agent: Qualification Agent (F5, rescoped). Gate: **the** decision of the whole product — always human; agent suggests with citations. Artifact: recorded decision + reasons. **Pursuit fields with the tenant boundary; agent when F5 resumes.**

**Phase II — Understand the Job (stages 4–8).** Where estimator hours go to die.

4. **Document acquisition** — Pain: registrations, logins, 600-page zips. Object: canonical document set. Agent: Document Agent ✅. Gate: none. **Built; grows per portal.**
5. **Addenda tracking** — Pain: **the fear** — a missed addendum is a rejected bid. Object: change feed on the pursuit. Canonical: revisions + addenda docs + deadline-change candidates. Tenant: acknowledged/unacknowledged per pursuit. Agent: Addenda Agent 🔜. Gate: acknowledge; accept suggested new due date (override pattern). Artifact: change log + notifications. **Build next — highest-stakes gap in the product.**
6. **Spec/requirement extraction** — Pain: reading 600 pages for 30 facts. Object: Intelligence Report ✅. Agent: F3+F4 ✅. Gate: verify `is_critical` findings against citations. **Built; extend findings taxonomy (bonding, DIR, DVBE) instead of new tables.**
7. **Scope breakdown** — Pain: what trades does this job actually need? Object: trade breakdown → `project_trades`. Canonical: F4 trade_breakdown. Tenant: selected trades, self-perform flags. Agent: Spec/Scope ✅ suggests. Gate: estimator confirms trades (drives everything downstream). **Mostly built; the confirm-into-project_trades bridge is Phase G work.**
8. **Bid item review** — Pain: retyping schedules into Excel. Object: `opportunity_bid_items` ✅ → estimate lines (tenant, later). Gate: sanity-check quantities. **Built canonically; tenant pricing layer deferred.**

**Phase III — Build the Bid (stages 9–13).** The Control Center pillars.

9–11. **Sub identification / outreach / coverage** — Pain: Rolodex + spreadsheet chaos; "who's covering electrical?" at 9pm. Object: two pools ✅, call lists ✅, coverage heatmap, engagement tracking, bid room `bids` ✅. Canonical: network pool, license data (`cslb_cache`). Tenant: private pool, mappings, quotes, coverage state. Agent: Coverage Agent (formalize existing features). Gate: every call is human — BidBox empowers, never replaces (masterplan principle). Artifact: call list, coverage meter. **Core built; deepen post-tenant-model so it is company-shared.**
12. **Takeoff/estimating handoff** — Pain: re-entering everything into the estimating tool. Object: export (bid items + scope + trades). Agent: none (an Estimating Agent is a long-term integration question, not a build). Gate: all of it. **Defer; ship clean exports only.**
13. **Compliance review** — Pain: disqualification on paperwork (wrong bond form, missing DIR#, unacknowledged addendum). Object: readiness checklist (`project_readiness_items` exists). Canonical: cited requirements. Tenant: checklist state, company docs. Agent: Compliance Agent 📋. Gate: item-by-item sign-off. **Post-MVP; the schema already waits for it.**

**Phase IV — Submit & Learn (stages 14–18).**

14–16. **Assembly / final review / submission** — Pain: the all-nighter; portal submission mechanics (Bid Express etc. — BidBox never submits on the contractor's behalf; it prepares and verifies). Object: proposal artifacts on the project; pursuit → `submitted` with bid amount (tenant-private, always). Agent: Proposal 📋 later. Gate: the owner signs the bid. **Defer beyond checklist + artifact storage.**
17. **Post-bid tracking** — Pain: results scattered across portals. Object: pursuit → `won/lost` + canonical bid results (DPW `AWARDED` postback and planholder data are already-scouted future extensions). **Defer; low effort when wanted.**
18. **Lessons learned** — Pain: institutional knowledge lives in the estimator's head. Object: tenant post-mortems + canonical agency priors (real bid spreads vs. engineer's estimates — a genuine data moat). Agent: Knowledge Agent 📋. **Defer 12–24mo; but stages 14–17's tables are its future training data — capture outcomes from day one via pursuit stages.**

---

## 10–11. Sequencing Guidance (as of July 2026)

**Foundational set:** companies + members; pursuits + triage cutover + revoke global candidate UPDATE; `opportunity_revisions` + Addenda Agent v1 (C1A-lite); Phase G workspace on the pursuit spine; Atlas Phase 0 + agency expansion continuing. **Fast follow:** F5 rescoped to `pursuit_qualifications`; findings-taxonomy expansion; company-shared sub pools. **Deferred:** teams-within-companies, outreach automation, estimating/takeoff, proposal generation, Knowledge Agent, embeddings/vector infra, planholder promotion, renames, audit feeds, dashboards beyond what exists.

**Horizon sketch:** 6 months — tenant boundary done, Addenda Agent in production, F5 live per-company, Phase G complete, Atlas feeding 100+ agencies. 12 months — Coverage Agent formalized, Compliance v1, bid results ingestion, pursuit funnel analytics, Atlas statewide. 24 months — knowledge layer (agency priors, bid spreads), proposal assembly, estimating-tool integrations, second state (where Rings 0/1 make expansion mechanical).

Execution status belongs to the roadmap and initiatives, not this document.

---

## 12. Risks and Anti-Patterns

1. **Tenant columns on canonical tables** — the bug class that motivated this document. The §4 rule is the test for every future column.
2. **Per-tenant copies of canonical artifacts** — never copy documents/chunks/reports into tenant space; reference them.
3. **Coordinator-agent spaghetti** — coordination is tables + deterministic enqueue rules. An LLM deciding what other LLMs do is the banned failure mode.
4. **Uncited canonical facts / unreasoned tenant suggestions** — constitutional; every new agent inherits them.
5. **Cross-tenant signal leakage** — pursuit counts, competitor presence, bid amounts: never surfaced.
6. **Premature infrastructure** — vector DBs, event buses, agent frameworks. Postgres + the poller until a measured limit says otherwise.
7. **Rename churn** — cosmetic migrations on load-bearing tables are pure risk.
8. **The biggest risk is sequencing:** shipping more tenant-facing surface on the single-tenant foundation. Every feature built before `pursuits` exists is a feature that must be migrated later.

---

## 13. Summary Recommendation

Build the tenant boundary first, the Addenda Agent second, and almost nothing else new until both are done: companies → pursuits + cutover → revisions + Addenda Agent → Phase G on the pursuit spine → F5 resumed tenant-scoped → Coverage → Compliance. The canonical spine already exists and is genuinely well-built — citation-disciplined, idempotent, shared. What is missing is the *other half of the split*: a real tenant. Give every opinion a company-scoped home, give every change a detectable event, keep agents writing durable cited rows into exactly one ring — and BidBox stops being a bid feed with a single user's notes scribbled on it, and becomes the system of record an estimating department runs its day inside.
