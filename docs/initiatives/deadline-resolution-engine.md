# F6A — Deadline Resolution Engine

Status: Future Initiative  
Date: June 2026  
Related phases: F4 Project Intelligence, Phase G Pursuit Management  

## Executive Summary

Northwood and ISO 18000 showed that bid due dates are not a simple formatting or timezone problem. They exposed a deeper architecture issue: BidBox currently has multiple deadline signals, but no durable deterministic system for collecting, comparing, resolving, and explaining those signals.

F6A introduces a Deadline Resolution Engine. Its purpose is to collect deadline evidence from portals, bid documents, addenda, and Project Intelligence extraction, then produce one resolved deadline with supporting evidence, conflict status, and an audit trail.

This initiative is future work. It should not block the current Phase G hardening pass, but it should become the durable solution before BidBox relies on deadline automation at scale.

## Current Phase 1 MVP Hardening

Phase G includes an interim estimator-facing deadline workflow before the full F6A engine exists.

Implemented Phase 1 behavior:

- Opportunity Intelligence reports always display one definitive primary bid due date.
- Structured metadata remains authoritative for primary display when available.
- Conflicting F4 deadline evidence is surfaced as an expandable warning, not as a replacement for the primary deadline.
- Bid HQ / Project Workspace supports a lightweight project-level bid due override.
- Overrides are stored directly on `projects` using `bid_due_at`, `bid_due_override_at`, `bid_due_override_source`, and `bid_due_override_reason`.
- Overrides may be selected from existing report evidence or entered manually by the user.

Phase 1 deliberately does not introduce:

- `opportunity_deadline_candidates`
- `opportunity_deadline_resolutions`
- `project_deadline_overrides`
- generalized deadline evidence ranking
- full override history

This gives estimators the immediate workflow they need while preserving F6A as the durable Phase 2 architecture.

## 1. Problem Statement

Bid deadlines are trust-critical for BidBox. A wrong bid date can cause a contractor to miss a bid, chase a closed opportunity, or lose confidence in the product.

The current system has several competing sources of date truth:

- `opportunity_candidates.bid_due_at`
- `opportunity_candidates.crawl_data.due_date_raw`
- `projects.bid_due_at`
- F4 `opportunity_intelligence_findings`
- F4 executive summary text
- portal metadata
- bid package documents
- addenda documents

Observed failure modes:

- Northwood timezone/storage bug: the source portal showed a correct local deadline, but candidate storage represented the wrong UTC instant.
- ISO 18000 F4 year/date attribution bug: F4 extracted a real historical document date from 2020 and labeled it as the bid due date for an opportunity whose portal deadline was in 2030.
- Portal metadata vs document/addendum conflict risk: portal metadata may be stale when addenda move bid deadlines.
- F4 findings overriding structured metadata: user-facing surfaces displayed an AI-generated date instead of structured portal/candidate metadata.
- UI inconsistency: different sections of the same report showed different bid deadlines.

The core problem is not that a single parser failed. The core problem is that BidBox has no formal deadline evidence model and no deterministic resolver.

## 2. Core Principle

```text
GPT should extract deadline evidence.
GPT should not be the final authority on bid deadlines.
```

AI can identify dates, quote evidence, and classify likely source context. It should not choose the final bid due date. The final deadline should be produced by deterministic business rules that evaluate all available evidence.

## 3. Deadline Evidence Model

F6A should introduce `deadline_candidates`.

Each row represents one potential deadline discovered from a source.

Recommended fields:

- `id`
- `opportunity_candidate_id`
- `report_id`
- `deadline_type`
- `deadline_at`
- `deadline_raw`
- `timezone`
- `source_type`
- `source_document_id`
- `source_page_id`
- `source_chunk_id`
- `page_number`
- `citation_label`
- `source_excerpt`
- `addendum_number`
- `confidence`
- `extraction_method`
- `extracted_text`
- `created_at`

Recommended `deadline_type` values:

- `bid_due`
- `job_walk`
- `pre_bid_meeting`
- `questions_due`
- `addendum_due`
- `agency_response`

Recommended `source_type` values:

- `portal_metadata`
- `candidate_metadata`
- `project_metadata`
- `bid_document`
- `notice_inviting_bids`
- `specification`
- `addendum`
- `agency_response`
- `manual_override`
- `ai_extraction_unknown_context`

Recommended `extraction_method` values:

- `portal_parser`
- `document_ai_extraction`
- `deterministic_document_parser`
- `manual`
- `backfill`

Important modeling notes:

- `deadline_raw` should preserve the exact source text where possible.
- `deadline_at` should only be populated when the system can safely normalize the date/time into a UTC instant.
- If timezone is absent or ambiguous, keep `deadline_raw`, leave `deadline_at` null, and let resolution mark the deadline `needs_review`.
- AI-only dates with unclear source context should be stored as evidence but should not be allowed to win over structured or addendum-backed evidence.

## 4. Resolution Model

F6A should introduce `deadline_resolutions`.

Each row represents the current resolved deadline for one `deadline_type` on one opportunity.

Recommended fields:

- `id`
- `opportunity_candidate_id`
- `report_id`
- `deadline_type`
- `resolved_deadline_at`
- `resolved_deadline_raw`
- `timezone`
- `authoritative_deadline_candidate_id`
- `status`
- `reason`
- `conflict_summary`
- `evidence_summary`
- `created_at`
- `updated_at`

Recommended `status` values:

- `resolved`
- `conflict`
- `needs_review`
- `unavailable`

Resolution output examples:

```text
Authoritative Bid Due Date

July 14, 2026 at 11:00 AM PDT

Source:
Addendum 1

Reason:
Latest addendum supersedes original bid deadline.
```

Conflict example:

```text
Deadline Conflict Detected

Portal:
July 7, 2026 at 11:00 AM

Addendum 1:
July 14, 2026 at 11:00 AM

Showing:
July 14, 2026 at 11:00 AM

Reason:
Latest addendum supersedes portal deadline.
```

## 5. Resolution Rules

The resolver should be deterministic and auditable.

Rules:

1. Latest addendum wins.
2. Addenda override portal metadata and base bid documents.
3. Portal metadata wins over ambiguous AI-only document extraction.
4. Base bid documents support portal metadata but do not automatically override it.
5. If same-priority sources disagree, mark `conflict`.
6. If timezone is unclear, mark `needs_review`.
7. If AI extracts a date but cannot identify source context, store the evidence but do not let it win.

Additional recommended rules:

- If an addendum clearly says the bid date is unchanged, it should support the prior resolved deadline rather than create a competing deadline.
- If multiple addenda exist, determine `addendum_number` from filename, document classification, first-page text, or explicit extracted metadata.
- If an addendum number cannot be determined but the document is classified as an addendum, mark its deadline evidence high priority but `needs_review` when it conflicts with numbered addenda.
- If portal metadata and base bid documents agree, mark the resolution `resolved` with both evidence sources attached.
- If portal metadata differs from base bid documents and no addenda exist, mark `conflict` unless one source has a stronger timestamp or explicit superseding language.

## 6. Worker Design

F6A should fit into the existing Opportunity Intelligence pipeline:

```text
F2 document acquisition
↓
F3 document processing
↓
F4 evidence extraction
↓
Deadline candidate extraction
↓
Deadline resolver
↓
Report / Bid HQ / Calendar
```

Recommended worker flow:

1. F2 captures portal deadline metadata as raw source evidence.
2. F3 produces page/chunk evidence from acquired documents.
3. F4 extracts deadline references into `deadline_candidates` instead of treating `bid_due_date` as a final finding.
4. A deterministic resolver reads all candidates for the opportunity.
5. Resolver writes `deadline_resolutions`.
6. F4 report generation references the resolved deadline and explains conflicts.
7. Phase G Project Workspace, Add to Calendar, and Calendar read from `deadline_resolutions`.

The resolver can initially run inside the F4 worker after Project Intelligence extraction. Later it can become its own task type if addenda monitoring or manual review requires re-running deadline resolution independently.

Potential task types:

- MVP: no new task type; resolver runs as part of `project_intelligence`.
- Future: `deadline_resolution` task for re-resolving after addenda, manual overrides, or new evidence ingestion.

## 7. UI Implications

### Opportunity Intelligence Report

The Project Snapshot should read the bid due date from `deadline_resolutions`, not directly from F4 findings.

Report sections should show:

- authoritative deadline
- status
- source
- reason
- supporting evidence
- conflict evidence if present

If conflict exists, display it explicitly:

```text
Deadline Conflict Detected

Portal:
July 7, 2026 at 11:00 AM

Addendum 1:
July 14, 2026 at 11:00 AM

Showing:
July 14, 2026 at 11:00 AM

Reason:
Latest addendum supersedes portal deadline.
```

F4 findings may still include extracted deadline evidence, but they should not render as the primary bid due date.

### Bid HQ / Project Workspace

Bid HQ should show:

- resolved bid due date
- source badge, such as `Addendum 1`, `Portal`, or `Needs Review`
- conflict warning if applicable
- link back to supporting evidence in the Intelligence Report

If status is `needs_review` or `conflict`, Bid HQ should make that visible near the snapshot, not bury it in a details section.

### Add To Calendar

Add to Calendar should use `deadline_resolutions.resolved_deadline_at`.

Recommended behavior:

- `resolved`: allow calendar creation normally.
- `conflict`: allow calendar creation only after showing warning and the selected deadline reason.
- `needs_review`: warn user and require confirmation or manual deadline entry.
- `unavailable`: require manual deadline entry.

The `projects.bid_due_at` field should be seeded from the resolved deadline, not from F4 findings.

### Calendar

Calendar should continue reading `projects.bid_due_at`, but for Opportunity Intelligence projects that value should originate from `deadline_resolutions`.

Future enhancement: Calendar entries can display a provenance badge such as `Portal`, `Addendum`, or `Manual`.

### Projects Page

Project cards can keep using `projects.bid_due_at`, but should show a needs-review badge if the source resolution status is not `resolved`.

### Re-Analysis

Safe re-analysis should keep the old resolution available until the new analysis succeeds.

When new F4 evidence succeeds:

1. Write new deadline candidates.
2. Run resolver.
3. Promote new resolution.
4. Update linked Project/Calendar deadline if appropriate.
5. Preserve conflict/audit trail.

If re-analysis fails, keep the prior deadline resolution.

## 8. Migration Strategy

Recommended rollout:

1. Add `deadline_candidates`.
2. Add `deadline_resolutions`.
3. Seed portal deadline candidates from existing:
   - `opportunity_candidates.crawl_data.due_date_raw`
   - `opportunity_candidates.bid_due_at`
   - `projects.bid_due_at` for converted Opportunity Intelligence projects
4. Seed document candidates cautiously from existing F4 findings:
   - `bid_due_date`
   - `questions_due_date`
   - `addendum_due_date`
   - `mandatory_job_walk`
5. Mark legacy F4-derived candidates with `extraction_method = backfill` or `document_ai_extraction`.
6. Do not allow ambiguous legacy F4 findings to override structured portal/candidate/project metadata.
7. Generate initial `deadline_resolutions`.
8. Update OpportunityReport and Bid HQ to read from `deadline_resolutions`.
9. Keep fallback to existing `bid_due_at` during transition.
10. Once stable, treat `deadline_resolutions` as the primary read path.

Migration caution:

- Do not broad-correct old `candidate.bid_due_at` values unless the raw source deadline is known.
- Use targeted corrections for known bad rows.
- Keep raw source strings for audit whenever possible.

## 9. MVP Scope

Minimum viable F6A:

- Support only `deadline_type = bid_due`.
- Store portal deadline candidates.
- Store F4-extracted document/addendum bid deadline candidates.
- Run deterministic resolver.
- Render resolved deadline in OpportunityReport.
- Render resolved deadline in Bid HQ / Project Workspace.
- Seed Calendar from resolved deadline.
- Display conflicts clearly.
- Keep fallback to current structured metadata during transition.

Out of MVP:

- full manual override UI
- addenda monitoring agent
- deadline change notifications
- all non-bid deadline types
- historical resolution version UI

## 10. Future Scope

Future expansion should include:

- job walk / pre-bid deadline resolution
- questions due date
- addendum deadline
- agency response deadline
- manual override with audit trail
- deadline change notifications
- addenda monitoring agent
- recurring re-resolution when new addenda are acquired
- confidence scoring by source type and citation quality
- UI for comparing all deadline evidence
- contractor-specific calendar notification preferences

## 11. Relationship To Current Phase G Fixes

Current Phase G fixes are interim hardening.

They include:

- structured metadata beats F4 for primary bid due display
- F4 conflicts are downgraded
- parser behavior improved for future PlanetBids records
- historical bad rows may require targeted correction
- OpportunityReport and Bid HQ are being moved toward one shared deadline resolver helper

Those fixes reduce immediate user-facing inconsistency, but they do not create a durable deadline evidence system.

F6A is the future durable solution. It should replace render-time source selection with persistent deadline evidence, deterministic resolution, and an auditable explanation of why one deadline is being displayed.

---

## Phase 1 — Project Workspace Manual Overrides (shipped)

The Project Workspace now supports lightweight manual overrides for two date fields, written directly against the `projects` row:

- **Bid Due Date** — `projects.bid_due_override_at` / `_source` / `_reason` (manual or `deadline_candidate`).
- **Job Walk Date** — `projects.job_walk_override_at` / `_reason` (manual only; no evidence selection).

Both overrides also mirror to the primary column (`bid_due_at`, `job_walk_at`) so existing consumers — Calendar (`/calendar`), `CalendarGrid`, `HighSignalPanel`, dashboards, and upcoming-events widgets — reflect the override automatically with zero changes.

### Phase 2 — Deadline Resolution Engine (NOT in scope yet)

A future durable resolver will unify, in one engine:

- Bid Due
- Job Walk
- Pre-Bid Conference
- Question Deadline
- Addendum Deadline
- Award Timeline

Phase 1 overrides are intentionally lightweight and live only on the project row; they will be migrated into the Phase 2 evidence model when F6A is implemented.
