# Opportunity Intelligence Strategy Alignment Report

Source of truth: `docs/initiatives/opportunity-intelligence-mvp.md`  
Audit date: June 14, 2026

## Alignment Baseline

The current MVP strategy is:

```text
Opportunity Discovery -> Human Interest Signal -> Project Intelligence -> Qualification -> Add to Calendar
```

The old strategy to remove or downgrade is:

```text
Opportunity Discovery -> Qualification -> Project
```

The core repository drift is that several docs, UI strings, and implementation notes still present metadata-based auto-qualification as the main filter immediately after discovery. Under the new strategy, metadata qualification should be framed as preliminary triage only. The estimator's `Analyze Project` action is the key human-interest signal that should trigger deeper project intelligence and then pursuit qualification.

## High-Priority Alignment Items

### 1. `docs/agent-architecture-task-list.md`

- **Relevant section:** `Task 4.1`, `Task 4.3`, `Task 5 - PHASE D: QUALIFICATION ENGINE`, `Task 10 - OPEN ITEMS / NEXT PRIORITIES`
- **Current philosophy or workflow:** The task list says the Railway worker "Calls `qualify-candidates` after each task," says `qualify-candidates` "runs after scans," and treats Phase D as a completed qualification engine for the current rule set. The implied product flow is scan -> auto-qualify -> review.
- **Recommended update:** Reframe Phase D as "Preliminary Metadata Triage" rather than final Qualification. Add a new phase between Opportunity Discovery and Qualification: `Analyze Project / Project Intelligence`. Update immediate next priorities to include explicit `Analyze Project` workflow, project intelligence report scaffold, and document-intelligence prerequisites. Keep the existing worker/queue architecture notes, but mark automatic `qualify-candidates` after scan as legacy/preliminary behavior that should not represent final pursuit qualification.
- **Priority:** High

### 2. `docs/repository-audit-june-2026.md`

- **Relevant section:** Executive Summary, Current user workflow, architecture diagram, `Qualification Agent Audit`, `MVP Gap Analysis`, `Recommended Next Build Sequence`, Final Assessment
- **Current philosophy or workflow:** This fresh audit correctly warns that metadata qualification is limited, but it still lists "Discovered opportunities are auto-qualified against the GC's profile and can be triaged or converted" as the current workflow. It also recommends "GC qualification profile" and "Explainable Yes/Maybe/No reasons" as must-have MVP systems before clearly inserting `Analyze Project`.
- **Recommended update:** Add a strategy addendum or revise the workflow to show two statuses: broad scan/preliminary metadata triage, then estimator-triggered analysis, then document-backed qualification. Update the architecture diagram so `Worker -> Qualify -> Candidates` is not presented as the final MVP path. In the build sequence, move "Analyze Project" and "Project Intelligence report" ahead of deeper qualification improvements.
- **Priority:** High

### 3. `src/pages/QualificationProfile.tsx`

- **Relevant section:** Bid Profile page description around lines 299-300
- **Current philosophy or workflow:** The UI says: "Every discovered opportunity is auto-qualified against this profile so you only review what's worth bidding." This directly conflicts with the new strategy because broad discovery should not be over-filtered before estimator interest and project intelligence.
- **Recommended update:** Replace with copy that frames the profile as preliminary matching and post-analysis qualification input. Example direction: "Set your bid parameters once. BidBox uses them for early scan signals and deeper qualification after you choose projects to analyze."
- **Priority:** High

### 4. `src/pages/Opportunities.tsx`

- **Relevant section:** Opportunity card actions and badges: `System: {candidate.auto_status}`, manual buttons `No / Maybe / Yes`, CTA `Convert to Project`
- **Current philosophy or workflow:** The card UI supports scan -> system status -> manual Yes/Maybe/No -> convert to project. There is no `Analyze Project` action or separation between "interesting enough to analyze" and "qualified pursuit."
- **Recommended update:** Future UI should add `Analyze Project` as the primary action for unconverted candidates. Treat `auto_status` as preliminary metadata signal, not final Yes/No. After Project Intelligence and qualification, the MVP action should be `Add to Calendar`.
- **Priority:** High

### 5. `bidbox-worker/index.js`

- **Relevant section:** `maybeQualifyCandidates()` and post-task qualification call
- **Current philosophy or workflow:** The worker automatically invokes `qualify-candidates` after scan tasks. That encodes Discovery -> Qualification as an operational behavior.
- **Recommended update:** Do not remove yet without a product migration plan, but document this as preliminary metadata triage only. Future build should either rename this behavior conceptually, move final qualification behind `Analyze Project`, or add a separate task type for document-backed project intelligence and post-analysis qualification.
- **Priority:** High

### 6. `supabase/functions/scan-opportunities/index.ts`

- **Relevant section:** `qualifyCandidates()` helper and non-PlanetBids call after source scans
- **Current philosophy or workflow:** Non-PlanetBids scans still call qualification directly after scan completion. This reinforces the old scan -> qualify model.
- **Recommended update:** Reclassify this as preliminary triage or remove automatic final qualification from the scan path once `Analyze Project` exists. Future docs should distinguish scan-time metadata flags from post-analysis pursuit qualification.
- **Priority:** High

### 7. `supabase/functions/qualify-candidates/index.ts`

- **Relevant section:** Function purpose and internal comments around loading qualification profile and qualifying pending candidates
- **Current philosophy or workflow:** The function qualifies all pending candidates using metadata fields. That is currently valid code, but the name and usage can be mistaken as the final bid/no-bid qualification engine.
- **Recommended update:** Add future documentation around the function clarifying that current candidate qualification is preliminary until document intelligence exists. In a later implementation phase, consider a separate final qualification function or mode that runs against analyzed project intelligence.
- **Priority:** High

## Medium-Priority Alignment Items

### 8. `docs/masterplan.md`

- **Relevant section:** `SoCal Agency Expansion`, `End State`, and earlier `GC Control Center Direction`
- **Current philosophy or workflow:** The SoCal section describes BidBox as a "live Southern California public works radar," which aligns with broad discovery. However, the master plan does not yet include the revised opportunity-intelligence MVP sequence or the estimator-triggered analysis step. The broader document remains bid-room/control-center centric.
- **Recommended update:** Add a short `Opportunity Intelligence MVP` section after SoCal Agency Expansion. It should state that source scanning creates broad visibility, `Analyze Project` is the human-interest signal, Project Intelligence precedes final qualification, and `Add to Calendar` is the MVP pursuit signal.
- **Priority:** Medium

### 9. `CHANGELOG.md`

- **Relevant section:** June 8-9 opportunity intelligence entries, especially Phase 1B "User Qualification Profile + Smart Filtering," worker qualification notes, and "qualify-candidates running automatically after every scan"
- **Current philosophy or workflow:** Historical entries present automatic qualification after scan as a strategic refinement and core dashboard behavior. As a changelog, this is historically accurate but now strategically superseded.
- **Recommended update:** Do not rewrite history. Add a new top entry noting the June 2026 strategy pivot: metadata auto-qualification is preliminary only; MVP now centers on broad discovery -> Analyze Project -> Project Intelligence -> Qualification -> Add to Calendar.
- **Priority:** Medium

### 10. `docs/tasks.md`

- **Relevant section:** Top June 8 session note and broad product backlog references to opportunity intelligence
- **Current philosophy or workflow:** The current top note says PlanetBids coverage is the fastest path to broader opportunity intelligence, which is still true. It does not include the new human-interest/analyze-project step and tells readers to use the agent task list for detailed opportunity work.
- **Recommended update:** Add a short cross-reference to `docs/initiatives/opportunity-intelligence-mvp.md` and state that future opportunity tasks should follow the revised workflow. Keep this broad task list lightweight; do not duplicate the full strategy.
- **Priority:** Medium

### 11. `docs/opportunity-source-ledger.md`

- **Relevant section:** Purpose and `Scan Verification Criteria`
- **Current philosophy or workflow:** The ledger is mostly aligned with broad discovery. It proves which agencies are being crawled, not which opportunities are qualified. However, the title/purpose could be misread as "BidBox successfully grabbing projects from these agencies" without distinguishing metadata discovery from document intelligence.
- **Recommended update:** Add language that scan verification proves source discovery only. It does not mean BidBox has downloaded/read project documents or generated Project Intelligence reports. This will prevent overclaiming.
- **Priority:** Medium

### 12. `.lovable/plan.md`

- **Relevant section:** Scan Now UX plan
- **Current philosophy or workflow:** The plan is focused on scan queue visibility and candidate status transitions. It is stale relative to later backend fixes and does not mention `Analyze Project`.
- **Recommended update:** Mark as historical/stale or replace with a new plan that treats Scan Now as broad source discovery only. Add that the next UX layer should capture estimator interest through `Analyze Project`, not imply scan completion equals qualification.
- **Priority:** Medium

### 13. `docs/app-flow-pages-and-roles.md`

- **Relevant section:** Overview, Core Pages, End-to-End Flows, Access Rules
- **Current philosophy or workflow:** This file documents only the bid-room/project workflow. It omits `/opportunities`, `/settings/profile`, Scan Now, `Analyze Project`, Project Intelligence, and the new pursuit workflow.
- **Recommended update:** Add an Opportunity Intelligence user flow for GC users: scan opportunities, review broad list, click `Analyze Project`, review Project Intelligence report, then add selected opportunities to the calendar. Add the relevant pages and access rules.
- **Priority:** Medium

### 14. `docs/implementation-plan.md`

- **Relevant section:** Step-by-step build sequence and GC Control Center phases
- **Current philosophy or workflow:** This plan is legacy bid-room/control-center oriented and does not include the opportunity-intelligence MVP sequence. It is not actively wrong about qualification, but it is no longer sufficient as the implementation plan for the current MVP strategy.
- **Recommended update:** Add a new phase or companion note for Opportunity Intelligence MVP. Make clear that existing bid-room implementation is foundation, but next build priorities are broad discovery, Analyze Project, Project Intelligence, then qualification/pursuit.
- **Priority:** Medium

### 15. `docs/gc-control-center-prd.md`

- **Relevant section:** Executive Summary, Guiding Principles, Four Pillars, Target User Flow
- **Current philosophy or workflow:** This PRD is focused on bid-day command center, trade selection, subcontractor coverage, and call lists. It does not include the discovery/analyze/project-intelligence loop. It is not directly promoting the old qualification flow, but it is now incomplete as a top-level product strategy document.
- **Recommended update:** Add a note that GC Control Center remains the downstream pursuit workspace, while Opportunity Intelligence is the upstream discovery and pursuit-decision workflow. Avoid positioning trade selection as the first step of the whole product; it is first step after a project enters pursuit/project management.
- **Priority:** Medium

### 16. `COMPANY_MESSAGING.md`

- **Relevant section:** One-liner
- **Current philosophy or workflow:** Messaging says AI agents handle time-consuming repetitive tasks "from finding projects to submitting bids." That overstates the MVP and conflicts with the new explicit non-goals: proposal generation, automatic bid submission, and fully autonomous agent suite are not MVP.
- **Recommended update:** Reframe messaging around public works opportunity discovery and project intelligence. Avoid "submitting bids" until proposal/final submission capabilities exist. Suggested direction: "BidBox scans public works portals, helps estimators choose projects to analyze, and turns bid docs into pursuit intelligence."
- **Priority:** Medium

### 17. `src/components/HeroMvp.tsx`

- **Relevant section:** Hero subcopy: "Purpose-built AI agents handle the tedious work — from finding projects to submitting bids."
- **Current philosophy or workflow:** Live marketing copy overstates agent automation and final bid submission. It also skips the human-interest signal and project intelligence layer.
- **Recommended update:** Future UI copy should align to the MVP: broad public works discovery, estimator-selected analysis, and pursuit intelligence. Avoid claiming full bid submission automation.
- **Priority:** Medium

### 18. `docs/All_docs.md`

- **Relevant section:** Single-file AI/reference doc, especially copied `masterplan`/`tasks` content
- **Current philosophy or workflow:** This appears to be an aggregated reference. It likely mirrors older product docs and does not include the new opportunity-intelligence MVP strategy.
- **Recommended update:** Regenerate or add a clear "current source of truth" note that points AI agents to `docs/initiatives/opportunity-intelligence-mvp.md` for MVP strategy. Otherwise tools may continue using stale aggregated content.
- **Priority:** Medium

## Low-Priority Alignment Items

### 19. `README.md`

- **Relevant section:** Entire file
- **Current philosophy or workflow:** The README is still the default Lovable project README. It does not present the old opportunity qualification flow, but it also does not point developers to the current product strategy.
- **Recommended update:** Add a product/docs orientation section eventually, including the source-of-truth MVP doc. Not urgent because it does not actively contradict the new workflow.
- **Priority:** Low

### 20. `docs/admin_kpi_panel_plan.md`

- **Relevant section:** MVP/Post-MVP terminology
- **Current philosophy or workflow:** Admin KPI planning is mostly unrelated. It uses MVP language but does not discuss opportunity discovery or qualification.
- **Recommended update:** No immediate strategy change required. If admin analytics later track opportunity funnel, use the new funnel stages: discovered, analyzed, intelligence generated, qualified, pursued.
- **Priority:** Low

### 21. `docs/admin_kpi_tasks.md`

- **Relevant section:** Admin analytics tasks
- **Current philosophy or workflow:** No meaningful opportunity qualification philosophy found. One "agents" mention is unrelated to AI/product agents.
- **Recommended update:** No immediate update required. Future KPI tasks should adopt the new funnel stage names if analytics expands to opportunity intelligence.
- **Priority:** Low

### 22. `docs/stripe.md`, `docs/stripe-tasks.md`, `docs/stripe-steps.md`

- **Relevant section:** Pricing/subscription docs
- **Current philosophy or workflow:** No direct old opportunity qualification workflow found.
- **Recommended update:** No immediate update required. If pricing is updated for compute-based project intelligence, add language that `Analyze Project` may become the metered/paid action.
- **Priority:** Low

### 23. `docs/design-guidelines.md`

- **Relevant section:** General design rules
- **Current philosophy or workflow:** No opportunity qualification workflow found.
- **Recommended update:** No immediate update required. Future UI design docs can add terminology guidance: use `Analyze Project` and `Project Intelligence`, avoid presenting metadata status as final qualification.
- **Priority:** Low

### 24. `docs/one_link`

- **Relevant section:** One Link PRD/status content
- **Current philosophy or workflow:** This is page-level project ingestion and metadata extraction history. It includes high-signal fields like job walk, estimate, bonds, addenda, and disqualification language, which are relevant to Project Intelligence. It does not directly assert scan -> qualify as the MVP flow.
- **Recommended update:** Later, connect this prior work to the Project Intelligence Agent scope. Treat One Link extraction as a foundation for user-selected analysis, not as a broad-scan qualification substitute.
- **Priority:** Low

### 25. `docs/reddit_painpoints`

- **Relevant section:** Raw research notes
- **Current philosophy or workflow:** Contains user research excerpts around qualification, proposal review, and bid management. It is raw evidence, not a roadmap.
- **Recommended update:** Do not edit unless curating research. The new MVP strategy is actually consistent with this research because it keeps estimator judgment in the loop.
- **Priority:** Low

## Code Comment / Naming Alignment Notes

These are not documentation files, but they encode product assumptions and should be considered when implementation begins.

### 26. `src/integrations/supabase/types.ts`

- **Relevant section:** Generated `qualification_score`, `qualified_at`, `gc_qualification_profiles` types
- **Current philosophy or workflow:** Generated schema reflects existing metadata qualification fields.
- **Recommended update:** Do not hand-edit generated types. Future schema should distinguish preliminary metadata status from post-analysis pursuit qualification if new fields/tables are added.
- **Priority:** Low

### 27. `supabase/migrations/20260528000001_gc_qualification_profiles.sql`

- **Relevant section:** Migration comments: "qualification fields on opportunity_candidates"
- **Current philosophy or workflow:** Historical migration names/comments describe candidate qualification fields.
- **Recommended update:** Do not rewrite applied migrations. Future migrations should use clearer names such as `candidate_triage_status`, `project_intelligence_reports`, or `pursuit_qualification` if the data model evolves.
- **Priority:** Low

### 28. `supabase/migrations/20260528234448_7cc27287-1e90-4afe-8def-621061825e4f.sql`

- **Relevant section:** Migration comments: "Qualification fields on opportunity_candidates"
- **Current philosophy or workflow:** Same as above; historical schema language can imply final qualification.
- **Recommended update:** Do not edit historical migrations. Future schema should clarify preliminary vs final qualification.
- **Priority:** Low

### 29. `supabase/migrations/20260608000002_mark_expired_opportunity_candidates_red.sql`

- **Relevant section:** Expired candidate auto-red cleanup
- **Current philosophy or workflow:** Uses `auto_status = red` for bid-closed candidates. This is still appropriate because expiration is a metadata-level hard stop.
- **Recommended update:** No change required except future docs should clarify that some metadata hard stops, like closed bids, remain valid before analysis.
- **Priority:** Low

## Recommended Update Order

1. Update `docs/agent-architecture-task-list.md` to insert the Analyze Project / Project Intelligence phase.
2. Add a top-level strategy note to `CHANGELOG.md` marking the pivot.
3. Update `docs/repository-audit-june-2026.md` or add an addendum so the latest audit does not become stale immediately.
4. Update live UI copy in `src/pages/QualificationProfile.tsx`.
5. Plan the `/opportunities` UX shift from `Convert to Project` as primary action to `Analyze Project`.
6. Add cross-reference notes to `docs/masterplan.md`, `docs/tasks.md`, and `docs/app-flow-pages-and-roles.md`.
7. Revisit worker/edge automatic qualification behavior once the Project Intelligence task model exists.

## Summary

The repository now has a clear new strategic source of truth, but the older docs and current UI still mostly reflect:

```text
Scan -> auto-qualify -> review/convert
```

The aligned MVP should instead read:

```text
Scan broadly -> estimator chooses Analyze Project -> BidBox generates intelligence -> qualification informs Add to Calendar
```

The most important change is conceptual: metadata qualification is not gone, but it must be downgraded to preliminary triage. Final MVP value should center on user-triggered Project Intelligence and the simple `Add to Calendar` pursuit signal.
