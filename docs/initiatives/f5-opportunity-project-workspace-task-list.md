# F5 — Opportunity & Project Workspace

Status: Planned
Document type: Engineering task list
Source initiative: `docs/initiatives/f5-opportunity-project-workspace.md`

## Task 1 - PRODUCT DOCUMENTATION AND ROADMAP ALIGNMENT
Subtasks:
### 1.1. Establish Source Documents

- Preserve `docs/initiatives/f5-opportunity-project-workspace.md` as the product architecture source of truth.
- Preserve this task list as the implementation execution plan.
- Keep the Opportunity Intelligence MVP documents as historical and pipeline foundation references.

### 1.2. Update Roadmap Cross-References

- Link F5 — Opportunity & Project Workspace from `docs/masterplan.md`.
- Link F5 — Opportunity & Project Workspace from `docs/tasks.md` without duplicating the detailed task list.
- Link F5 — Opportunity & Project Workspace from `docs/agent-architecture-task-list.md`.
- Add notes to Opportunity Intelligence docs explaining that the future workspace model removes the manual `Analyze Project` step for baseline intelligence.

### 1.3. Define Non-Goals

- Do not remove the existing F1-F4 pipeline while implementing F5.
- Do not build full F5 qualification before the workflow shell is stable.
- Do not implement the full future Deadline Resolution Engine as part of this initiative.

## Task 2 - BASELINE INTELLIGENCE PIPELINE FOUNDATION
Subtasks:
### 2.1. Define Baseline Intelligence Contract

- Define the minimum fields required for an Opportunity Overview: snapshot, summary, dates, requirements, bid items, quick facts, documents, and intelligence status.
- Separate baseline intelligence from the full F4 Intelligence Report.
- Document fallback behavior for unknown values.

### 2.2. Map Existing F4 Outputs To Baseline Fields

- Map project snapshot metadata to Overview fields.
- Map executive summary to the short Opportunity Overview summary.
- Map key dates and bid requirements to concise Overview sections.
- Keep detailed findings and citations in the Intelligence tab.

### 2.3. Define Baseline Status Lifecycle

- Add or reuse lifecycle states for `not_started`, `queued`, `running`, `ready`, `partial`, and `failed`.
- Decide where `baseline_analysis_status` and `baseline_analyzed_at` should live.
- Preserve existing deep analysis status fields until the replacement workflow is proven.

## Task 3 - DISCOVERY REFRESH AND AUTOMATIC BASELINE ANALYSIS
Subtasks:
### 3.1. Replace User-Facing Analyze Project

- Remove or hide the manual `Analyze Project` button from the normal discovery flow.
- Replace action language with document/intelligence readiness statuses.
- Preserve internal analysis/re-analysis tools where needed for operations.

### 3.2. Queue Baseline Work From Discovery

- Queue acquisition and baseline analysis automatically after a supported opportunity is discovered or refreshed.
- De-duplicate active background tasks per opportunity.
- Avoid repeated AI spend when baseline intelligence already exists and source metadata has not changed.

### 3.3. Preserve Broad Discovery Visibility

- Continue showing newly discovered opportunities even if baseline work is pending.
- Show clear `Preparing overview` or equivalent status when baseline work has not completed.
- Avoid blocking the Opportunities page on background processing.

## Task 4 - BID LINE ITEMS DATA MODEL
Subtasks:
### 4.1. Design `opportunity_bid_items`

- Add a normalized storage model for portal and document-derived bid items.
- Include source portal, source opportunity ID, section, item number, item code, description, unit, quantity, reference, unit price, raw text, extraction method, and extraction status.
- Preserve source ordering.

### 4.2. Define Source Relationships

- Link bid items to `opportunity_candidates`.
- Link document-derived bid items to `opportunity_documents` when available.
- Keep bid items available before an opportunity becomes a project.

### 4.3. Define Extraction Statuses

- Track whether bid items were found, unavailable, partially extracted, failed, or inferred.
- Store extraction timestamps.
- Preserve raw source rows for debugging and QA.

## Task 5 - PORTAL-NATIVE BID ITEM EXTRACTION
Subtasks:
### 5.1. PlanetBids Line Item Extraction

- Navigate to the PlanetBids Line Items tab when available.
- Extract visible rows and section groupings.
- Normalize rows into the shared bid item shape.
- Continue document acquisition and intelligence generation after line item extraction.

### 5.2. Caltrans Line Item Extraction

- Extract Caltrans item number, item code, item description, unit, and estimated quantity where available.
- Normalize Caltrans data into the same bid item table.
- Preserve Caltrans-specific source metadata in `raw_text` or metadata fields.

### 5.3. Document-Based Fallback

- Identify structured bid item tables inside acquired documents when portal-native rows are unavailable.
- Use conservative extraction and mark method as `document_ai` or equivalent.
- Do not let inferred bid items overwrite portal-native rows.

## Task 6 - OPPORTUNITY CARDS AND DISCOVERY STATUS UX
Subtasks:
### 6.1. Redesign Opportunity Cards

- Show Project Name, Agency, Bid Date, Location, Estimated Value, Trade/Category, Scope, Document Status, and Intelligence Status.
- Keep cards compact and scannable.
- Avoid exposing full report details on the card.

### 6.2. Show Baseline Readiness

- Display whether documents are acquired, baseline intelligence is ready, and bid items are available.
- Use human-readable statuses instead of developer task statuses.
- Avoid raw worker errors on card surfaces.

### 6.3. Preserve Filtering And Sweeper Behavior

- Keep conservative non-construction filtering.
- Ensure filtered-out opportunities do not disappear without traceability.
- Keep discovery broad enough to maintain estimator trust.

## Task 7 - OPPORTUNITY OVERVIEW DOSSIER
Subtasks:
### 7.1. Build Opportunity Stage Route

- Route opportunity cards to a lightweight opportunity dossier.
- Keep this separate from the Project Workspace.
- Ensure the route works for opportunities before and after calendar conversion.

### 7.2. Build Overview Tab

- Render Project Snapshot, Executive Summary, Key Dates, Bid Items, Important Requirements, Quick Facts, and Add to Calendar.
- Make Overview the default tab.
- Use a stable template for every project.

### 7.3. Keep Intelligence Out Of The Default Overview

- Move detailed F4 findings and citations to the Intelligence tab.
- Keep only concise, decision-oriented information on Overview.
- Show unknown values as `N/A` or `Not identified`.

## Task 8 - OPPORTUNITY DOCUMENTS TAB
Subtasks:
### 8.1. Render Source Documents

- Show acquired source documents from `opportunity_documents`.
- Include filename, family/category, file type, status, source, and download/open actions.
- Keep public bid room files separate from internal GC working files.

### 8.2. Add Search And Organization

- Add document search when processed text exists.
- Group plans, specifications, addenda, bid forms, insurance, bonds, labor compliance, and supporting documents.
- Show extraction or processing limitations clearly.

### 8.3. Preserve Acquisition Transparency

- Show partial acquisition in estimator-friendly language.
- Keep developer diagnostics in logs and internal metadata.
- Allow later retry workflows without blocking the Overview.

## Task 9 - OPPORTUNITY INTELLIGENCE TAB
Subtasks:
### 9.1. Render Full F4 Report

- Keep the full Project Intelligence Report in the Intelligence tab.
- Preserve citations, confidence, unknown states, conflicts, and source document references.
- Keep `NO CITATION = NO FACT` for factual findings.

### 9.2. Separate Deep Intelligence From Baseline Overview

- Avoid duplicating long intelligence sections on the Overview tab.
- Link from Overview sections to relevant Intelligence details when useful.
- Keep conflict evidence inspectable without replacing primary facts.

### 9.3. Support Re-Analysis Operations

- Preserve safe re-analysis behavior.
- Keep current report visible while re-analysis runs.
- Show stage-based progress and failure banners in operational contexts.

## Task 10 - ADD TO CALENDAR TRANSITION
Subtasks:
### 10.1. Preserve Project Origin Links

- Continue linking projects to source opportunity candidates and intelligence reports.
- Keep `Add to Calendar` idempotent.
- Prevent duplicate project creation from stale UI state.

### 10.2. Define Transition State

- Store `added_to_calendar_at` and `added_to_calendar_by` or equivalent when implemented.
- Keep `Add to Calendar` separate from `Pursuing`.
- Make converted state visible without hiding access to the Opportunity dossier.

### 10.3. Route To My Projects

- Add the project to My Projects and Calendar.
- Preserve back-navigation to the Opportunity dossier and Intelligence tab.
- Ensure conversion never triggers legacy One Link crawl analysis.

## Task 11 - PROJECT WORKSPACE TAB SHELL
Subtasks:
### 11.1. Create Project Stage Tabs

- Add Project Workspace tabs: Overview, Bid Readiness, Documents, Intelligence, Addenda, Activity, Subcontractors, Estimate, and Proposal.
- Make Overview the default Project Workspace tab.
- Keep unavailable future tabs clearly stubbed or hidden until useful.

### 11.2. Separate Opportunity And Project Routes

- Ensure Opportunity routes answer `Should we track this?`.
- Ensure Project routes answer `How do we pursue this?`.
- Preserve route clarity after calendar conversion.

### 11.3. Preserve Legacy One Link Behavior

- Keep legacy One Link projects using existing crawl behavior.
- Keep Opportunity Intelligence projects out of legacy crawl states.
- Avoid destructive rewrites of existing project pages until migration is planned.

## Task 12 - PROJECT WORKSPACE OVERVIEW
Subtasks:
### 12.1. Seed Overview From Baseline Intelligence

- Show the same core facts from the Opportunity Overview after conversion.
- Include Project Snapshot, Executive Summary, Key Dates, Important Requirements, and Bid Items.
- Link to full Intelligence where detailed evidence is needed.

### 12.2. Add Pursuit Status Control

- Add a project-level pursuit status such as `Reviewing`, `Pursuing`, and `Passed`.
- Track who updated the status and when.
- Keep status distinct from `Add to Calendar`.

### 12.3. Keep Overview Operational

- Include next actions relevant to active pursuit.
- Avoid turning Overview into a long report.
- Surface missing critical information with clear `Needs Review` language.

## Task 13 - BID READINESS MVP
Subtasks:
### 13.1. Define Readiness Checklist

- Include bid bond, performance bond, payment bond, insurance, license, DIR, required forms, mandatory pre-bid/job walk, addenda acknowledgment, submission method, and submission deadline.
- Show missing items clearly.
- Preserve source/citation links when readiness items come from intelligence.

### 13.2. Implement Readiness States

- Use `Not Ready`, `Needs Review`, and `Ready to Bid`.
- Avoid blocking user actions based on readiness during MVP.
- Keep manual confirmation available for estimator judgment.

### 13.3. Connect To Intelligence

- Seed readiness items from F4 findings where reliable.
- Keep unknown or conflicting items as `Needs Review`.
- Do not let readiness become F5 qualification until that phase is explicitly resumed.

## Task 14 - PROJECT DOCUMENTS WORKSPACE
Subtasks:
### 14.1. Render Project Source Documents

- Show the source bid package documents associated with the originating opportunity.
- Preserve document family, class, status, and citation traceability.
- Keep internal GC working files separate from source bid-package documents.

### 14.2. Support Addenda Visibility

- Identify addenda documents.
- Surface addenda count and document status.
- Defer full addenda monitoring until a later agent phase.

### 14.3. Support Download And Review

- Provide download/open actions for source documents.
- Preserve private storage access rules.
- Keep document search and viewer work scoped to reusable Document Layer components.

## Task 15 - PROJECT INTELLIGENCE WORKSPACE
Subtasks:
### 15.1. Reuse F4 Outputs

- Display the full intelligence report without rerunning F4.
- Preserve citations and conflict evidence.
- Keep report navigation usable from both Opportunity and Project contexts.

### 15.2. Support Critical Fact Inspection

- Show critical facts such as bid due date, job walk, license, bonds, insurance, liquidated damages, and engineer estimate.
- Preserve definitive display rules and conflict evidence.
- Keep future Deadline Resolution Engine work deferred.

### 15.3. Preserve Re-Analysis Controls

- Allow safe re-analysis where appropriate.
- Keep old report visible until the replacement succeeds.
- Avoid duplicate F2/F3/F4 tasks.

## Task 16 - ESTIMATE AND BID ITEMS WORKSPACE
Subtasks:
### 16.1. Display Full Bid Item Schedule

- Show all normalized bid items, not only the Overview subset.
- Preserve section grouping and source order.
- Support missing values gracefully.

### 16.2. Prepare For Estimating Workflows

- Leave room for quantity review, cost code mapping, estimate prep notes, and exports.
- Do not implement automated estimating in the first F5 pass.
- Keep this workspace grounded in source bid items.

### 16.3. Export And Review Backlog

- Document future export formats.
- Document future estimate import/export needs.
- Defer proposal pricing automation.

## Task 17 - FUTURE WORKSPACE SURFACES
Subtasks:
### 17.1. Subcontractors Tab

- Reserve a home for coverage suggestions, outreach status, coverage gaps, bid invites, responses, and scope packages.
- Do not implement outreach automation as part of this pass.
- Keep this aligned with the future Coverage Agent.

### 17.2. Proposal Tab

- Reserve a home for required proposal documents, bid forms, submission instructions, checklist, draft response package, and final review items.
- Do not implement proposal generation as part of this pass.
- Keep this aligned with the future Proposal Agent.

### 17.3. Addenda And Activity Tabs

- Reserve Addenda for future addenda monitoring, acknowledgment, and deadline impacts.
- Reserve Activity for user actions, status changes, notes, and timeline history.
- Keep both tabs minimal until supporting data exists.

## Task 18 - UI POLISH AND VISUAL SIMPLIFICATION
Subtasks:
### 18.1. Reduce Visual Density

- Increase whitespace.
- Reduce excessive badges.
- Remove unnecessary nested containers.
- Simplify section styling.

### 18.2. Standardize Page Hierarchy

- Use predictable section ordering.
- Use concise headings.
- Keep hero-scale typography out of dense workflow pages.
- Keep tab navigation calm and consistent.

### 18.3. Improve Empty And Partial States

- Use estimator-friendly language for missing data.
- Show `Not identified`, `N/A`, `Needs Review`, or `Preparing` as appropriate.
- Keep technical errors out of user-facing copy.

## Task 19 - DATA MIGRATION AND BACKWARD COMPATIBILITY
Subtasks:
### 19.1. Preserve Existing Opportunity Intelligence Data

- Keep existing F2/F3/F4 artifacts usable.
- Preserve existing converted projects.
- Avoid destructive migrations.

### 19.2. Backfill New Fields Where Safe

- Backfill lifecycle fields only when relationships are unambiguous.
- Backfill bid items only from reliable source data or future reprocessing.
- Document manual cleanup paths for ambiguous historical records.

### 19.3. Maintain Legacy Compatibility

- Keep One Link projects functioning during the transition.
- Keep old reports accessible until replacement views are validated.
- Avoid broad route changes without fallback links.

## Task 20 - QA VALIDATION AND ROLLOUT
Subtasks:
### 20.1. Validate Opportunity Discovery

- Confirm first-time users can understand a project from cards and Overview within 30 seconds.
- Confirm baseline pending states are understandable.
- Confirm no manual `Analyze Project` action is required for baseline information.

### 20.2. Validate Project Execution

- Confirm `Add to Calendar` creates/reuses a project.
- Confirm My Projects and Calendar display the project.
- Confirm Project Workspace tabs load without legacy crawl states.

### 20.3. Validate Cross-Portal Behavior

- Test PlanetBids opportunities.
- Test Caltrans opportunities.
- Confirm bid items, documents, and intelligence degrade gracefully when portal capabilities differ.

### 20.4. Validate No Regressions

- Run build and typecheck.
- Validate existing F2/F3/F4 paths.
- Validate public Bid Room source-document behavior.
- Validate legacy One Link projects.
