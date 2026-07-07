# Knowledge Atlas — Architecture Vision

**Status:** Long-term architecture vision — **intentionally deferred; not an initiative**
**Date:** 2026-07-06
**Precedence:** below [`engineering-principles.md`](engineering-principles.md); see [`README.md`](README.md)
**Companion concept:** [`procurement-atlas.md`](procurement-atlas.md) (the outward-looking twin)
**Foundations it builds on:** [`unified-data-model.md`](unified-data-model.md) — Rings 2–3, the Knowledge Agent (§7), and workflow stages 14–18 (§9)

> **Read this first.** This document exists to preserve an idea, not to start one. There is no task list, no implementation plan, no milestone, and none should be created from this document until after the MVP ships and early customers validate the core product. The only present-tense obligation it creates is stated in §6, and it costs nothing: *don't lose the data that future memory is made of.* Everything else here is direction, recorded so it can be rediscovered instantly instead of re-derived expensively.

---

## 1. The Vision

**Knowledge Atlas is BidBox's long-term organizational memory — everything a contractor has learned while pursuing work, accumulated automatically, queryable forever.**

An estimating department's most valuable asset is not its software; it is what its people remember. Which subs actually perform on asphalt. Which agency's specs hide liquidated damages that bite. What the company bid on the last three pump stations and why it lost two of them. Today that memory lives in retiring estimators' heads, in abandoned spreadsheets, and in email threads nobody can find — and it walks out the door with every departure. For a small public works GC, losing one senior estimator can mean losing a decade of pricing intuition.

BidBox is positioned to change that without asking anyone to do extra work, because the estimating workflow it operates *is* the memory-capture mechanism. Every pursuit decision, triage note, intelligence report, sub quote, coverage gap, submitted bid, and win/loss outcome already flows through durable tables (engineering principle 9: durable tables over conversational memory). Knowledge Atlas is the name for what those tables become when they are treated as a compounding asset rather than operational state: the system that lets a contractor ask, in plain language —

- *Show every school project we've ever pursued.*
- *Which subcontractors have we used most successfully for asphalt?*
- *Which estimator has won the highest percentage of Caltrans work?*
- *Every project with liquidated damages over $2,000/day.*
- *Which specifications repeatedly create problems for us?*
- *Recommend subs — and a likely risk list — for this new pursuit, based on our own history.*

Every pursuit makes it smarter. None of it requires the contractor to "do knowledge management."

## 2. The Two Atlases

| | **Procurement Atlas** | **Knowledge Atlas** |
|---|---|---|
| Direction | Looks **outward** | Looks **inward** |
| Question | *"What work exists?"* | *"What have we learned?"* |
| Knows | Agencies, portals, portal families, drivers, recon, coverage health | Pursuits, intelligence, specs/addenda encountered, subs, outreach, bids, outcomes, pricing history, recurring risks, people |
| Expands | BidBox's ability to **discover** work | The contractor's ability to **win** work |
| Tenancy | Canonical/internal (Ring 0) — one registry for all of BidBox | **Per-company** (Rings 2–3) — each contractor's memory is theirs alone |
| Who it serves | BidBox engineering (control plane) | The contractor (product value) |
| Compounds by | Adding agencies | Adding pursuits |

BidBox sits between them: Procurement Atlas continuously discovers opportunities; the estimating workflow OS turns them into pursuits; Knowledge Atlas continuously compounds everything learned along the way — which in turn sharpens the next pursuit. Discovery feeds work; work feeds memory; memory feeds better work. That loop is the product at maturity.

## 3. Responsibility Boundaries

Knowledge Atlas is **not a new ring, not a new database, and not a document dump.** It is the maturation of Ring 2/3 data plus a retrieval-and-reasoning layer over it, governed by the same constitution as everything else:

1. **It owns tenant knowledge only.** A contractor's memory is Ring 2/3 under company RLS, invisible to every other contractor, forever (principle 4). There is no "anonymized cross-customer learning" assumption anywhere in this vision — any future benchmarking product would be a separate, explicit, consent-based decision, not a drift.
2. **It references canonical facts; it never copies them.** The spec text, addenda, and bid items a pursuit encountered stay in Ring 1; Knowledge Atlas links pursuit-side experience (*"this spec section caused a claim"*) to canonical evidence (the cited chunk), per principles 1–2 and 5.
3. **Public outcomes are canonical; private outcomes are tenant.** Award results and bid tabulations published by agencies belong in Ring 1 (they also power agency priors like real bid spreads vs. engineer's estimates). The contractor's own bid amount, margin assumptions, and post-mortems are tenant, always.
4. **Its AI follows the standing rules.** Retrieval-backed answers cite their rows; recommendations state their reasons; predictions are suggestions with human decision points (principles 5–6). A memory that hallucinates is worse than no memory.
5. **It never becomes an initiative by accident.** Features get built when a customer question demands them, on data that already exists — never as speculative knowledge infrastructure (principle 15).

## 4. Evolution Over 3–5 Years

Knowledge systems are gated by accumulated data, not engineering ambition — each phase is unlocked by volume, not by roadmap will:

- **Phase 0 — Passive accumulation (begins with the MVP, costs nothing).** The tenant boundary (`pursuits`), workflow OS objects, and outcome stages (`submitted/won/lost`) capture the raw material as a side effect of normal use. This phase has no Knowledge Atlas code at all; it is simply the discipline of durable, structured, company-scoped rows — already policy.
- **Phase 1 — Structured recall (first customers, ~year 1).** Filterable pursuit history: "everything we bid for agency X," "all pursuits over $5M," win rates by agency/type/estimator. SQL over existing tables, exposed in the UI. The first moment memory visibly pays rent.
- **Phase 2 — Cross-pursuit intelligence (~years 1–2).** Sub performance across pursuits (quoted vs. engaged vs. delivered), recurring risk patterns tied to cited spec evidence, estimator/agency affinities, historical pricing recall against new bid items. This is where the Knowledge Agent from the unified data model gets built — reading tenant history plus canonical citations, writing durable, reasoned tenant suggestions.
- **Phase 3 — Predictive assistance (~years 2–5).** New pursuit arrives → Knowledge Atlas drafts the risk list, sub shortlist, and estimator recommendation from the company's own precedent, each with citations into that precedent. Retrieval quality may justify embeddings or richer knowledge structures *at this point and not before* — infrastructure follows the measured need.

## 5. Why This Is the Moat

Coverage can be copied: a well-funded competitor can scrape the same portals BidBox does. What cannot be copied is **five years of a contractor's own pursuits, priced items, sub performance, and win/loss reasoning, structured and queryable inside the tool their estimating department lives in.** Every month of use deepens it; every departure it survives raises its value; switching tools means abandoning institutional memory — the one asset a contractor cannot re-buy. Procurement Atlas makes BidBox *useful on day one*; Knowledge Atlas makes BidBox *irreplaceable by year three*. The moat is data gravity earned honestly: the contractor's memory belongs to the contractor, and BidBox is simply the only place it compounds.

## 6. Deferral — Explicit and Deliberate

**Knowledge Atlas is deferred until after the MVP ships and early customer validation is in hand.** No tables, no agents, no embeddings, no dashboards, no initiative documents derive from this vision today. It earns an initiative only when real customers are generating real pursuit history and asking recall questions the product can't answer.

What the present owes the future — all of it already standing policy, none of it new work:

1. **Capture outcomes.** Pursuit stages through `submitted/won/lost` are recorded faithfully from day one (unified data model §9, stage 18: "stages 14–17's tables are its future training data").
2. **Keep knowledge durable and structured.** Agent outputs and human decisions land in rows with citations and reasons, never in disposable text (principles 5, 9).
3. **Hold the tenant boundary.** Everything a contractor learns stays company-scoped (principle 4) — the moat depends on the trust.

If a future session finds itself designing Knowledge Atlas features before those customers exist, this section is the instruction to stop.
