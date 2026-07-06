# Initiative: Procurement Atlas

## BidBox's Expansion Control Plane

**Status:** ✅ Approved direction (2026-07-06) — Phase 0 ready to start
**Document type:** Authoritative initiative document
**Architectural source of truth:** `docs/architecture/procurement-atlas.md`
**Implementation plan:** `docs/initiatives/procurement-atlas-implementation-plan.md`
**Task list:** `docs/initiatives/procurement-atlas-task-list.md`
**Roadmap placement:** `docs/agent-architecture-task-list.md` §6.3 (E2 — Master SoCal Agency Portal Inventory; Atlas is E2 done properly, plus recon codification and health rollup)

> **Revision note (2026-07-06):** This document previously described Procurement Atlas as an autonomous agency-intelligence platform — a separate internal engineering product with its own Supabase project, Lovable dashboard, Railway workers, and seven autonomous agents. That framing was reviewed against the current production architecture (4 live portal types, the validated Agency Direct driver pattern, the E1/E2/E3 expansion roadmap) and rejected. The full section-by-section critique and the reasoning behind the new direction are preserved in the proposal document above. This document now reflects the approved direction.

---

## Executive Summary

Procurement Atlas is **BidBox's engineering operating system for continuously expanding procurement coverage**.

It is not a product, a platform, a separate database, or a separate engineering project. It is BidBox's **expansion control plane**, implemented inside BidBox itself:

- **A verified agency/portal registry** — three tables in BidBox's own Supabase (`agencies`, `agency_portals`, `portal_families`) that know which agencies exist, where each one procures, which portal family that portal belongs to, and what it costs to cover it.
- **A codified reconnaissance workflow** — the process that produced the LA County DPW and LA Metro recon reports, turned from tribal practice into a repeatable playbook (`/agency-recon`), a standard evidence bundle, and a standard report template in `docs/recon/`.
- **Coverage and health visibility** — SQL views derived from signals the production pipeline already emits (`opportunity_sources.last_refresh_*`, `agent_run_logs`), so portal drift is noticed by alerts instead of by a customer missing a bid.

The framing that governs every design decision:

> BidBox's ingestion pipeline is the **data plane** — it moves opportunities from portals to estimators.
> Atlas is the **control plane** — it decides which portals the data plane should be pointed at, in what order, and with what driver, and it notices when the data plane degrades.

Atlas does not compete with BidBox. Atlas feeds BidBox. Atlas succeeds precisely to the degree that it stays boring: tables, views, a template, a skill, and the discipline to keep production as the single source of truth for anything production already knows.

---

## Goals

### Primary

- Build a verified registry of California public works procurement agencies, prioritized by customer value — completeness is a milestone, not the mission.
- Distinguish official procurement portals from third-party aggregators, with evidence links (the RAMPLA lesson made schema).
- Codify reconnaissance so every future driver starts from an Atlas-grade recon report instead of a blank page, and no portal is ever recon'd twice.
- Make driver-reuse recommendation a lookup: classify a portal into a family; the `portal_families` row answers whether a driver exists, what expansion model applies (`config_only` / `per_agency_templates` / `per_agency_driver`), and what it costs.
- Make expansion sequencing a query: the highest-leverage analytical output of Atlas is *agencies unlocked per driver family, weighted by value* (the `family_opportunity` view). PlanetBids proved the economics — one driver, 76+ agencies, config-only expansion. The registry exists substantially to reveal which family is the next PlanetBids.
- Preserve institutional portal knowledge (WAF signatures, transport requirements, auth models, download quirks) where the next recon will hit it, not only in the handoff doc of the session that learned it.
- Surface production coverage health from signals the pipeline already emits.

### Non-Goals

- Not a replacement for BidBox.
- Not a production opportunity ingestion pipeline — Atlas never ingests an opportunity.
- Not a bid aggregation service.
- Not a customer product or customer-facing surface.
- Not a separate database, dashboard application, worker fleet, or deployment.
- Not an autonomous recon system — evidence collection is automated; conclusions are human-approved (see Core Principles).

---

## Core Principles

1. **Official government sources only.** Aggregators are recorded (`role = 'aggregator'`) but never treated as the source of truth.
2. **Every conclusion must be evidence-backed.** `is_official` requires an `evidence_url`; recon findings are labeled verified vs. inferred, following the discipline of the DPW and LACMTA handoffs.
3. **Reconnaissance before implementation.** No driver work begins without a recon report in `docs/recon/`.
4. **Derive, don't duplicate.** Atlas tables own only the pre-production lifecycle (`identified → portal_verified → recon_complete → planned`). Implemented status and health are *computed* by joining `opportunity_sources`, `portal_drivers`, and `agent_run_logs` — never stored, never hand-updated. This is the lesson of `docs/opportunity-source-ledger.md`, which drifted stale beside production and is deprecated by Atlas.
5. **The pipeline is the monitor.** The nightly production scan is the health check. Atlas adds rollup and alerting over existing signals, not new probes.
6. **Automate evidence, not judgment.** The LACMTA session proved that recon conclusions require engineering judgment plus institutional context — an autonomous agent would have confidently mis-concluded "Metro is blocked, deprioritize." Evidence collection (fingerprinting, WAF markers, transport-tier probing) is automated; synthesis stays with engineer + Claude in a session.
7. **Atlas is the single engineering source of truth for coverage** — replacing the markdown ledger, not adding a parallel one.

---

## High-Level Architecture

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

The agency lifecycle Atlas manages:

```
identified → portal_verified → classified → recon_complete → planned
    → (config-only family? skip recon-heavy path) → implemented* → healthy*/degraded*/blocked*
                                                    (*derived states, never stored)
```

The config-only fast path matters most: for a verified PlanetBids agency, the lifecycle collapses to *identified → portal_verified → implemented* with one `opportunity_sources` INSERT. Atlas makes that path nearly frictionless, because it is where most raw coverage comes from.

---

## Major Components

- **Agency Registry** (`agencies`) — the universe of CA public agencies, with lifecycle status, priority, and provenance. `excluded` is a first-class terminal state ("we looked, there's nothing to cover, stop re-investigating").
- **Portal Registry** (`agency_portals`) — where each agency procures. One agency can have multiple portals with distinct roles (DPW: native portal + RAMPLA aggregator + Bid Express plan room). Carries the official-backlink evidence chain and recon status with a pointer into `docs/recon/`.
- **Portal Family Registry** (`portal_families`) — per-family institutional memory: driver status, expansion model, transport requirements, auth model, anti-bot behavior, known quirks, effort estimates. This is where "local headless Chromium gets blocked; Browserbase passes" becomes structural knowledge instead of a session anecdote.
- **Driver Catalog** — **already exists**: `portal_drivers`. Extended, not rebuilt.
- **Recon Reports** — versioned markdown in `docs/recon/`, written to a standard template, reviewable in PRs like code. The database holds status and pointers, never the prose.
- **Coverage & Health Views** — `agency_coverage`, `family_opportunity`, `source_health`. These views *are* the dashboard until reaching for them becomes the demonstrated bottleneck; only then does an internal admin page inside the existing BidBox app get built.

---

## Technology Stack

- **Database:** BidBox's existing Supabase project. No second project.
- **Repo:** the BidBox repo. Recon docs, playbook, seeding scripts, and fingerprint utilities are versioned alongside the code they inform.
- **Workers:** the existing Railway worker, unchanged. Atlas adds no worker code in Phase 0.
- **Browser automation:** existing Browserbase + Playwright setup, reused by the recon evidence collector.
- **AI:** engineer + Claude in sessions, driven by the `/agency-recon` playbook. No standing agent infrastructure.
- **Frontend:** none in Phase 0. SQL views first; an internal admin page inside the existing BidBox app later, only if justified.

---

## What Replaced the Original Autonomous Agents

The original seven-agent design collapses to two batch jobs plus one codified workflow:

- **Job A — Universe seeding** (was: Agency Discovery Agent). Batch ingestion of published lists (58 counties, ~482 cities, school/community-college districts, special districts, state agencies). The universe is nearly static; this is a task you run, not an agent that lives.
- **Job B — Portal fingerprinting** (was: Official Portal Finder + Authority Verification + Portal Classification). A semi-automated utility extending `src/lib/platformDetection.ts` patterns plus HTTP fingerprint probes, with human-approved verification of the official-backlink chain.
- **Workflow C — Recon playbook** (was: Browser Recon Agent + Engineering Planner). Engineer + Claude in a session, following `/agency-recon`, assisted by an automated evidence collector, producing a templated report in `docs/recon/`. The recon report *is* the implementation plan input — the DPW design spec proved the format.
- **Deleted outright:** Health Check Agent (the nightly scan is a better health probe than any revisit-bot; Atlas adds views and alerts over its output).

The test any future agent proposal must pass: *an agent is justified only when a loop over external evidence can't be a script and its errors are cheap.* Any proposed agent must name the decision it is allowed to get wrong.

---

## Success Criteria

Measured by expansion velocity, never by registry row count:

- **Time-to-live per agency class:** config-only agency in minutes-to-hours; new template in an existing Agency Direct driver in ~a day; new portal family in 1–2 weeks with recon amortized by the playbook.
- **Zero re-recon:** no portal is ever investigated twice from scratch; `portal_families` priors are consulted before every recon.
- **Zero registry drift for implemented agencies:** implemented/health status is derived from production, so it cannot be wrong.
- **The E3 sequencing decision is made from data:** the next non-PlanetBids driver family is chosen from the `family_opportunity` view, not by intuition.
- **Portal drift surfaces within 24h** via health views/alerts, without anyone reading raw worker logs.

---

## Immediate Priority

**Begin Phase 0 now** — roughly two weeks of work interleaved with ongoing driver work (LADWP is the next named E3 target):

1. Registry schema + backfill from production and the E1 ledger.
2. Recon playbook + report template + evidence collector.
3. Coverage and health views + one alert channel.
4. Deprecate `docs/opportunity-source-ledger.md` in favor of the registry.

Explicitly **not** starting now: statewide universe seeding beyond what's already known, autonomous discovery, recon automation beyond evidence collection, any dashboard page, PlanetBids portal sweeping. Those are Phase A+ and are gated on Phase 0 exit criteria.

Standing constraint: after Phase 0, Atlas work is capped at ~20% of engineering time. The control plane exists to accelerate the data plane; the ratio enforces it.

See `docs/initiatives/procurement-atlas-implementation-plan.md` for the full engineering plan and `docs/initiatives/procurement-atlas-task-list.md` for Phase 0 tasks.
