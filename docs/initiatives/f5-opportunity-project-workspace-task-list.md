# F5 — Opportunity & Project Workspace

Status: Planned
Document type: Engineering task list
Source initiative: `docs/initiatives/f5-opportunity-project-workspace.md`

## Task 1 - ESTABLISH F5 ENGINEERING BASELINE
Subtasks:
### 1.1. Confirm Source Documents

- Treat `docs/initiatives/f5-opportunity-project-workspace.md` as the product source of truth.
- Treat this file as the engineering execution roadmap.
- Keep existing F1-F4 Opportunity Intelligence documentation as historical pipeline context.

### 1.2. Audit Current Implementation State

- Confirm current routes for Opportunities, Opportunity Report, Projects, Calendar, Bid HQ, and Project Detail.
- Confirm current tables and fields used by `opportunity_candidates`, `projects`, `opportunity_documents`, F3 pages/chunks, F4 reports/findings/citations, and `agent_tasks`.
- Identify any active Lovable changes before starting implementation.

### 1.3. Define F5 Non-Goals

- Do not rebuild F2 document acquisition.
- Do not rebuild F3 document processing.
- Do not redesign F4 report generation prompts unless explicitly required by later tasks.
- Do not implement automated estimating, proposal generation, outreach automation, or full F5 qualification in this initiative.

## Task 2 - NORMALIZE OPPORTUNITY AND PROJECT LIFECYCLE MODEL
Subtasks:
### 2.1. Define Lifecycle State Contract

- Define canonical lifecycle states for discovered, baseline analyzing, baseline ready, added to calendar, reviewing, pursuing, passed, and submitted.
- Decide which states belong to `opportunity_candidates` and which belong to `projects`.
- Preserve compatibility with existing analysis, document acquisition, document processing, and report statuses.

### 2.2. Design Lifecycle Schema Changes

- Propose required fields such as `baseline_analysis_status`, `baseline_analyzed_at`, `added_to_calendar_at`, `added_to_calendar_by`, `pursuit_status`, `pursuit_status_updated_at`, and `pursuit_status_updated_by`.
- Avoid duplicating state if existing fields can be safely reused.
- Include indexes needed for Opportunities, My Projects, Calendar, and dashboard filtering.

### 2.3. Implement Lifecycle Migration

- Add only additive, non-destructive migrations.
- Backfill lifecycle fields only where relationships are unambiguous.
- Preserve all existing projects and opportunity candidates.

### 2.4. Validate Lifecycle Queries

- Verify discovered opportunities remain visible.
- Verify analyzed opportunities remain accessible.
- Verify converted projects remain linked to source opportunities.
- Verify legacy One Link projects continue working.

## Task 3 - DEFINE SHARED DOMAIN TYPES AND RESOLVERS
Subtasks:
### 3.1. Create Opportunity Workspace Domain Helpers

- Centralize helpers for opportunity title, agency, bid due date, location, estimate, source portal, and solicitation ID.
- Prefer structured metadata over AI findings for critical primary display fields.
- Preserve existing bid due authority and conflict rules.

### 3.2. Create Project Workspace Domain Helpers

- Centralize helpers for project origin, source opportunity, linked intelligence report, pursuit status, and workspace eligibility.
- Ensure Opportunity Intelligence projects never depend on legacy crawl completion.
- Keep legacy One Link helpers separate.

### 3.3. Create Shared Display Models

- Define display models for Opportunity Card, Opportunity Overview, Project Workspace Summary, Bid Readiness Checklist, and Bid Item rows.
- Keep raw database rows out of presentation components where practical.
- Make unknown and partial states explicit.

## Task 4 - BUILD BASELINE INTELLIGENCE CONTRACT
Subtasks:
### 4.1. Define Baseline Data Shape

- Define the minimum baseline package required for the Opportunity Overview.
- Include snapshot facts, executive summary, key dates, bid items, important requirements, quick facts, document readiness, and intelligence readiness.
- Keep the contract smaller than the full F4 report.

### 4.2. Map Existing F4 Output To Baseline

- Map F4 report metadata and findings into baseline fields.
- Keep citations available through drill-in links instead of forcing them into the Overview.
- Record which fields are structured metadata, document-backed findings, inferred values, unknown, or needs review.

### 4.3. Define Baseline Completeness Rules

- Decide when baseline intelligence is `ready`, `partial`, `pending`, or `failed`.
- Allow partial baseline output when documents are partially acquired.
- Do not block Opportunity visibility on missing baseline fields.

## Task 5 - IMPLEMENT BASELINE DATA ACCESS LAYER
Subtasks:
### 5.1. Build Read Queries

- Implement data access for one opportunity's candidate, documents, F4 report, findings, citations, bid items, and linked project.
- Keep query code reusable across Opportunity Overview, Opportunity Card, and Project Workspace.
- Avoid duplicate client-side query logic across pages.

### 5.2. Build List Queries

- Implement efficient list-level reads for Opportunity Cards.
- Include enough baseline status data without loading full reports.
- Avoid N+1 query patterns for document counts, bid item counts, and linked project state.

### 5.3. Validate Realtime And Polling Compatibility

- Preserve existing realtime subscriptions where they are already reliable.
- Use polling fallback for active baseline tasks when needed.
- Avoid introducing duplicate in-flight poll loops.

## Task 6 - REPLACE MANUAL ANALYZE PROJECT AS PRIMARY USER FLOW
Subtasks:
### 6.1. Identify Analyze Project Entrypoints

- Locate all buttons, labels, backend calls, and docs that expose manual `Analyze Project` as the normal user path.
- Distinguish production user actions from internal retry/re-analysis controls.
- Preserve safe operational re-analysis controls for already-analyzed opportunities.

### 6.2. Introduce Baseline Preparation Status

- Replace user-facing `Analyze Project` language with statuses such as `Preparing Overview`, `Documents Ready`, `Intelligence Ready`, and `Needs Review`.
- Keep technical task names hidden from estimator-facing UI.
- Prevent duplicate baseline work from repeated clicks.

### 6.3. Preserve Internal Task Compatibility

- Continue using existing F2/F3/F4 worker tasks while the workflow is being renamed.
- Avoid changing worker task semantics until the new lifecycle layer is stable.
- Confirm old `project_analysis` tasks still complete correctly.

## Task 7 - IMPLEMENT AUTOMATIC BASELINE QUEUEING
Subtasks:
### 7.1. Define Queue Trigger

- Decide whether baseline work is queued at discovery insert, discovery refresh, or source scan completion.
- Avoid queueing automatic baseline work for unsupported portal types.
- Preserve broad discovery visibility even when baseline work is delayed.

### 7.2. Add Duplicate Prevention

- Prevent multiple active baseline pipelines for the same opportunity.
- Treat pending, running, retrying, and staged re-analysis tasks as active.
- Keep user-triggered re-analysis from colliding with automatic baseline preparation.

### 7.3. Add Baseline Task Metadata

- Store enough metadata to distinguish automatic baseline preparation from manual re-analysis.
- Track source trigger, portal type, and created reason.
- Keep diagnostics available in worker logs and `agent_tasks.result`.

## Task 8 - UPDATE WORKER HANDOFF FOR BASELINE PIPELINE
Subtasks:
### 8.1. Preserve Existing F2/F3/F4 Chain

- Confirm F2 acquisition still queues F3.
- Confirm F3 still queues F4 when usable chunks exist.
- Confirm F4 remains the only stage that marks full intelligence ready.

### 8.2. Add Baseline-Specific Status Writes

- Write baseline status as documents and intelligence become available.
- Keep document acquisition, document processing, and F4 report statuses separate.
- Do not overload existing analysis statuses with unrelated UI labels.

### 8.3. Validate Failure Isolation

- Allow partial baseline output when some documents fail.
- Keep raw worker errors out of user-facing fields.
- Preserve technical errors in logs and internal result metadata.

## Task 9 - DESIGN BID ITEM DOMAIN MODEL
Subtasks:
### 9.1. Finalize `opportunity_bid_items` Schema

- Include candidate linkage, optional document linkage, portal source, source opportunity ID, section, item number, item code, description, unit, quantity, reference, unit price, raw text, extraction method, extraction status, source URL, and timestamps.
- Add indexes for candidate, source portal, extraction status, and source ordering.
- Keep schema flexible for portals with missing columns.

### 9.2. Define Bid Item Normalization Rules

- Preserve source ordering.
- Normalize quantity and unit without destroying raw source text.
- Store portal-specific fields only in metadata if they do not belong in canonical columns.

### 9.3. Define Bid Item Authority Rules

- Prefer portal-native structured line items.
- Use document-extracted bid items only when portal-native rows are unavailable or clearly incomplete.
- Label inferred items differently from official portal items.

## Task 10 - IMPLEMENT BID ITEM STORAGE
Subtasks:
### 10.1. Create Migration

- Add `opportunity_bid_items` with RLS, indexes, and grants consistent with the existing opportunity tables.
- Add any required helper functions only if needed for query performance.
- Avoid changes to existing F2/F3/F4 tables unless required.

### 10.2. Add Supabase Types

- Regenerate or update generated database types.
- Verify frontend and worker TypeScript/JavaScript references compile.
- Keep type changes scoped to the new bid item model.

### 10.3. Add Data Access Helpers

- Add insert/upsert helpers for portal drivers.
- Add read helpers for Opportunity Overview and Project Workspace.
- Add delete/replace helpers for re-analysis or source refresh.

## Task 11 - EXTRACT PLANETBIDS BID ITEMS
Subtasks:
### 11.1. Audit PlanetBids Line Item UI

- Identify Line Items tab selectors, row structure, section grouping, pagination, and hidden rows.
- Determine whether login/prospective bidder status affects line item visibility.
- Capture sanitized diagnostics for missing or malformed rows.

### 11.2. Implement PlanetBids Extraction

- Navigate to the Line Items tab during acquisition or detail-page processing.
- Extract rows into the normalized bid item shape.
- Preserve raw row text and source ordering.

### 11.3. Validate PlanetBids Bid Items

- Test against at least two PlanetBids opportunities with visible line items.
- Confirm rows appear in `opportunity_bid_items`.
- Confirm extraction failure does not block document acquisition.

## Task 12 - EXTRACT CALTRANS BID ITEMS
Subtasks:
### 12.1. Audit Caltrans Bid Item Sources

- Identify where Caltrans exposes bid item schedules for active advertisements.
- Determine whether bid items are HTML tables, PDFs, spreadsheets, ZIP contents, or separate downloads.
- Document limitations for projects where bid items are not public or structured.

### 12.2. Implement Caltrans Extraction

- Normalize item number, item code, description, unit, and estimated quantity.
- Preserve Caltrans contract number and source metadata.
- Keep extraction robust when some rows are malformed.

### 12.3. Validate Caltrans Bid Items

- Test against known Caltrans projects with bid item data.
- Confirm Opportunity Cards and Overview can read the normalized rows.
- Confirm document acquisition remains unaffected.

## Task 13 - ADD DOCUMENT-BASED BID ITEM FALLBACK
Subtasks:
### 13.1. Identify Candidate Documents

- Use document family/classification to prioritize proposal forms, bid schedules, item lists, and specifications.
- Avoid extracting bid items from irrelevant documents.
- Preserve source document and page references where available.

### 13.2. Implement Conservative Extraction

- Extract table-like bid item rows from processed pages or chunks.
- Mark extraction method as document-derived.
- Store confidence or needs-review status where appropriate.

### 13.3. Validate Fallback Behavior

- Confirm document-derived bid items do not overwrite portal-native rows.
- Confirm missing bid item data produces a clean empty state.
- Confirm inferred rows are labeled clearly in UI.

## Task 14 - BUILD OPPORTUNITY CARD DATA MODEL
Subtasks:
### 14.1. Define Card Fields

- Include project name, agency, bid date, location, estimate, trade/category, scope snippet, document status, intelligence status, and linked project state.
- Keep cards list-friendly and fast to load.
- Avoid loading full report findings for every card.

### 14.2. Implement Card Query

- Fetch all required card metadata in a small number of queries.
- Include bid item availability and baseline readiness.
- Preserve existing filters and Filtered Out behavior.

### 14.3. Validate Card States

- Test newly discovered opportunities.
- Test baseline pending opportunities.
- Test baseline ready opportunities.
- Test opportunities already added to calendar.

## Task 15 - IMPLEMENT OPPORTUNITY CARD UX
Subtasks:
### 15.1. Replace Primary Card Actions

- Make opening the Opportunity Overview the primary card action.
- Remove manual `Analyze Project` from the normal user path.
- Preserve safe retry/re-analysis controls in appropriate detail views.

### 15.2. Add Readiness Indicators

- Show document readiness, intelligence readiness, and bid item availability.
- Use calm, estimator-friendly copy.
- Avoid raw task names or worker errors.

### 15.3. Preserve Navigation After Conversion

- Ensure cards still open the Opportunity dossier after Add to Calendar.
- Do not route analyzed opportunities directly into legacy ProjectDetail.
- Keep `View Project` available only in context where it is clearly a Project Workspace action.

## Task 16 - BUILD OPPORTUNITY DOSSIER ROUTING
Subtasks:
### 16.1. Define Opportunity Route Contract

- Create or update the route that represents an opportunity before it becomes an active project.
- Load candidate, linked report, documents, bid items, and linked project state.
- Handle missing or deleted artifacts gracefully.

### 16.2. Add Tab Routing

- Support `Overview`, `Documents`, and `Intelligence` tabs.
- Preserve stable URLs for direct navigation.
- Keep route structure distinct from Project Workspace routes.

### 16.3. Add Loading And Failure States

- Show baseline pending states without blanking the page.
- Show partial data when some systems have completed.
- Provide retry paths only where they are safe.

## Task 17 - BUILD OPPORTUNITY OVERVIEW COMPOSITION LAYER
Subtasks:
### 17.1. Compose Snapshot Data

- Resolve project name, agency, solicitation ID, location, county, estimate, bid date, job walk, source portal, and status.
- Use shared critical-date and estimate authority helpers.
- Display unknowns consistently.

### 17.2. Compose Summary And Requirements

- Use baseline summary from F4 where available.
- Extract concise important requirements from existing findings.
- Keep detailed citations in the Intelligence tab.

### 17.3. Compose Key Dates

- Show bid due, pre-bid/job walk, questions due, addenda, and submission dates where known.
- Preserve deadline conflict handling.
- Avoid allowing AI findings to override structured metadata.

## Task 18 - IMPLEMENT OPPORTUNITY OVERVIEW UI
Subtasks:
### 18.1. Render Stable Overview Template

- Always render Project Snapshot, Executive Summary, Key Dates, Bid Items, Important Requirements, Quick Facts, and Add to Calendar.
- Keep section order stable.
- Use `N/A`, `Not identified`, or `Needs Review` instead of removing sections.

### 18.2. Render Concise Summary

- Limit summary length.
- Avoid long report blocks.
- Link to Intelligence tab for detailed analysis.

### 18.3. Render Important Requirements

- Prioritize bid-critical requirements.
- Avoid mixing general project description into requirements.
- Show source confidence or needs-review state only when useful.

## Task 19 - IMPLEMENT OPPORTUNITY BID ITEMS UI
Subtasks:
### 19.1. Build Shared Bid Items Table

- Display quantity, unit, and item description as the primary columns.
- Include item number, item code, section, and source as secondary metadata.
- Preserve source ordering.

### 19.2. Add Overview Subset Display

- Show the first 8 to 15 items on Opportunity Overview.
- Add `View All Bid Items` when the list is longer.
- Show a clean empty state when no structured bid items are found.

### 19.3. Add Full Bid Items View

- Support viewing all bid items in the Opportunity context.
- Support grouping by section.
- Preserve portal-native versus document-derived labels.

## Task 20 - IMPLEMENT OPPORTUNITY DOCUMENTS TAB
Subtasks:
### 20.1. Build Document List Model

- Read source documents from `opportunity_documents`.
- Include document family, class, filename, status, size, source, and storage path.
- Keep internal GC working files out of this tab.

### 20.2. Render Document Organization

- Group documents by plans, specifications, addenda, bid forms, insurance, bonds, labor compliance, bidder communications, and supporting documents.
- Show partial acquisition in estimator-friendly language.
- Preserve download and preview actions.

### 20.3. Add Document Search Hook

- Use F3 pages/chunks when available.
- Keep search optional and non-blocking.
- Avoid building a full document viewer unless scoped separately.

## Task 21 - IMPLEMENT OPPORTUNITY INTELLIGENCE TAB
Subtasks:
### 21.1. Reuse Existing F4 Report Renderer

- Render the complete Project Intelligence report.
- Preserve executive summary, findings, citations, unknown states, conflicts, and source documents.
- Keep `NO CITATION = NO FACT`.

### 21.2. Adapt Report Renderer To Opportunity Route

- Ensure report data loads from candidate/report relationships, not project-only assumptions.
- Keep Add to Calendar and View Project actions context-aware.
- Preserve access after conversion.

### 21.3. Preserve Re-Analysis Controls

- Keep safe re-analysis available where appropriate.
- Keep the current report visible during re-analysis.
- Keep failure banner behavior intact.

## Task 22 - HARDEN ADD TO CALENDAR ACTIVATION
Subtasks:
### 22.1. Preserve Idempotent Project Creation

- Reuse existing project if the opportunity is already converted.
- Prevent duplicate projects for one opportunity.
- Preserve origin, source opportunity, and intelligence report links.

### 22.2. Add Lifecycle Metadata

- Write `added_to_calendar_at` and `added_to_calendar_by` or equivalent when available.
- Keep `Add to Calendar` separate from pursuit decision.
- Preserve existing `converted_project_id` behavior.

### 22.3. Validate Activation Flow

- Confirm first activation creates one project.
- Confirm repeated activation reuses the same project.
- Confirm Intelligence Report remains accessible.
- Confirm no F2/F3/F4 tasks are triggered by activation.

## Task 23 - BUILD PROJECT WORKSPACE ROUTING ARCHITECTURE
Subtasks:
### 23.1. Define Project Workspace Route

- Route Opportunity Intelligence projects into the new workspace shell.
- Keep legacy One Link projects on legacy-compatible behavior.
- Branch by project origin explicitly.

### 23.2. Add Workspace Tab Routes

- Support Overview, Bid Readiness, Documents, Intelligence, Addenda, Activity, Subcontractors, Estimate, and Proposal.
- Keep unavailable tabs stubbed or hidden according to product readiness.
- Preserve direct URLs for each tab.

### 23.3. Validate Route Transitions

- Opportunity Overview -> Add to Calendar -> Project Workspace.
- Project Workspace -> Intelligence tab -> Opportunity dossier.
- Calendar -> Project Workspace.
- My Projects -> Project Workspace.

## Task 24 - BUILD PROJECT WORKSPACE DATA ACCESS LAYER
Subtasks:
### 24.1. Load Workspace Context

- Load project, source opportunity, linked report, documents, bid items, pursuit status, and public bid room token.
- Avoid re-running analysis during workspace load.
- Keep missing relationships visible as repairable state.

### 24.2. Add Workspace Cache Boundaries

- Keep workspace queries separate from Opportunity list queries.
- Avoid loading full document chunks unless needed.
- Keep tab-specific data lazy-loaded where practical.

### 24.3. Validate Legacy Separation

- Confirm Opportunity Intelligence projects never enter `Analyzing project...` legacy crawl state.
- Confirm One Link projects still honor `source_url` and `last_crawled_at` behavior.
- Confirm manual projects still load.

## Task 25 - IMPLEMENT PROJECT WORKSPACE SHELL
Subtasks:
### 25.1. Render Workspace Header

- Show project name, agency, bid due date, origin, pursuit status, and key actions.
- Avoid duplicate status badges.
- Use shared date/time formatting.

### 25.2. Render Workspace Navigation

- Add calm, predictable tab navigation.
- Keep tab labels stable.
- Make active tab state obvious.

### 25.3. Render Workspace Empty States

- Show useful placeholders for tabs that are not implemented yet.
- Avoid presenting future features as complete.
- Link back to Opportunity Intelligence where needed.

## Task 26 - IMPLEMENT PROJECT WORKSPACE OVERVIEW
Subtasks:
### 26.1. Reuse Baseline Overview Data

- Show Project Snapshot, Executive Summary, Key Dates, Bid Items, Important Requirements, and Quick Facts.
- Reuse Opportunity Overview composition helpers.
- Add project-specific actions only where relevant.

### 26.2. Add Operational Context

- Show pursuit status and calendar state.
- Show public bid room availability when relevant.
- Show next action prompts without clutter.

### 26.3. Validate Overview Consistency

- Confirm Opportunity Overview and Project Overview agree on critical facts.
- Confirm overridden bid due dates display consistently.
- Confirm bid items remain visible after activation.

## Task 27 - IMPLEMENT PURSUIT STATUS MANAGEMENT
Subtasks:
### 27.1. Define Pursuit Status Values

- Choose final MVP statuses such as `reviewing`, `pursuing`, `passed`, and `submitted`.
- Decide default status after Add to Calendar.
- Keep status separate from project active/archive state.

### 27.2. Add Persistence And Audit Fields

- Store status, updated timestamp, and updater.
- Avoid broad audit-log implementation unless already available.
- Preserve compatibility with Projects and Calendar filters.

### 27.3. Add UI Control

- Add a simple control in Project Workspace.
- Confirm status changes reflect in My Projects and Calendar.
- Keep destructive status changes confirmable where needed.

## Task 28 - IMPLEMENT BID READINESS FOUNDATION
Subtasks:
### 28.1. Define Readiness Item Model

- Include bid bond, performance bond, payment bond, insurance, license, DIR, required forms, mandatory pre-bid/job walk, addenda acknowledgment, submission method, and submission deadline.
- Decide whether MVP readiness items are stored, derived, or hybrid.
- Preserve citation/source references when items are derived from intelligence.

### 28.2. Define Readiness States

- Use `Not Ready`, `Needs Review`, and `Ready to Bid`.
- Keep manual confirmation available.
- Do not block bidding workflows during MVP.

### 28.3. Define F4 Mapping

- Map F4 findings into suggested readiness items.
- Treat unknown or conflicting findings as `Needs Review`.
- Avoid turning readiness into full qualification.

## Task 29 - IMPLEMENT BID READINESS UI
Subtasks:
### 29.1. Render Checklist

- Display grouped readiness items.
- Show detected, missing, confirmed, and needs-review states.
- Keep the interface scannable.

### 29.2. Add Manual Confirmation

- Allow estimator to mark readiness items reviewed or confirmed.
- Preserve derived source text separately from user confirmation.
- Avoid overwriting user confirmations during re-analysis.

### 29.3. Validate Readiness Workflow

- Test a project with complete requirements.
- Test a project with missing requirements.
- Test a project with conflicting requirements.

## Task 30 - IMPLEMENT PROJECT DOCUMENTS WORKSPACE
Subtasks:
### 30.1. Separate Source Documents From Internal Files

- Show acquired bid-package documents from `opportunity_documents`.
- Keep `project_files` as private GC working files.
- Do not expose internal files in public bid rooms.

### 30.2. Render Workspace Document Browser

- Use the same document grouping from the Opportunity Documents tab.
- Add project-context actions such as download all source documents when safe.
- Preserve acquisition and processing status.

### 30.3. Validate Public Bid Room Compatibility

- Confirm public Bid Room only exposes source bid documents intended for subcontractors.
- Confirm GC internal files remain private.
- Confirm source documents remain available after project activation.

## Task 31 - IMPLEMENT PROJECT INTELLIGENCE WORKSPACE
Subtasks:
### 31.1. Reuse F4 Intelligence

- Display the existing F4 report in Project Workspace.
- Do not regenerate reports on workspace load.
- Keep citations and conflict evidence traceable.

### 31.2. Link Between Contexts

- Link from Project Intelligence tab back to Opportunity Intelligence context where appropriate.
- Link from critical Overview facts into detailed Intelligence findings.
- Preserve report access after Delete Project or Delete Analysis flows according to existing rules.

### 31.3. Validate Re-Analysis In Workspace

- Confirm safe re-analysis still keeps old report visible.
- Confirm re-analysis updates Workspace data after success.
- Confirm failure keeps old report and shows failure state.

## Task 32 - IMPLEMENT ESTIMATE / BID ITEMS WORKSPACE
Subtasks:
### 32.1. Render Full Bid Item Schedule

- Show all normalized bid items.
- Support section grouping and source order.
- Preserve portal-native and document-derived labels.

### 32.2. Prepare Estimate-Oriented Structure

- Add columns and layout that can later support cost codes, estimator notes, quantity review, and exports.
- Do not implement pricing automation.
- Do not implement full estimating agent behavior.

### 32.3. Validate Large Bid Item Sets

- Test projects with many line items.
- Confirm table performance remains acceptable.
- Confirm Overview subset and full Estimate tab stay in sync.

## Task 33 - ADD FUTURE WORKSPACE TAB STUBS
Subtasks:
### 33.1. Subcontractors Tab Stub

- Reserve space for future Coverage Agent work.
- Show clear planned-state copy.
- Avoid implying outreach automation exists.

### 33.2. Proposal Tab Stub

- Reserve space for future Proposal Agent work.
- Show planned-state copy around bid forms, submission instructions, and final package review.
- Avoid generating proposals in this phase.

### 33.3. Addenda And Activity Stubs

- Reserve Addenda for future monitoring, acknowledgment, and deadline impact workflows.
- Reserve Activity for status changes, notes, and timeline history.
- Keep both minimal until supporting systems exist.

## Task 34 - UPDATE MY PROJECTS EXPERIENCE
Subtasks:
### 34.1. Separate Opportunity Intelligence Projects

- Show origin and pursuit status clearly.
- Avoid routing Opportunity Intelligence projects into legacy analysis views.
- Preserve legacy project cards where needed.

### 34.2. Add Workspace Navigation

- Route My Projects cards to Project Workspace.
- Preserve Calendar and Bid Room actions.
- Keep project deletion behavior safe.

### 34.3. Add Filtering Hooks

- Prepare filters for reviewing, pursuing, passed, submitted, due soon, and missing readiness.
- Do not overbuild dashboard analytics in this task.
- Keep filters consistent with lifecycle fields.

## Task 35 - UPDATE CALENDAR INTEGRATION
Subtasks:
### 35.1. Use Project Workspace Routing

- Route calendar events for Opportunity Intelligence projects to Project Workspace.
- Preserve existing calendar behavior for manual and legacy projects.
- Keep bid due date formatting authoritative and consistent.

### 35.2. Surface Pursuit And Readiness Signals

- Show pursuit status where useful.
- Show readiness state when implemented.
- Avoid cluttering calendar cells with long intelligence text.

### 35.3. Validate Calendar Activation

- Confirm Add to Calendar creates visible calendar entry.
- Confirm repeated activation does not duplicate entries.
- Confirm deleted projects disappear from Calendar.

## Task 36 - IMPLEMENT SHARED WORKSPACE COMPONENT LIBRARY
Subtasks:
### 36.1. Create Shared Section Components

- Build reusable Snapshot, Summary, Key Dates, Bid Items, Requirements, Quick Facts, Status Badge, and Empty State components.
- Keep components domain-aware but not page-specific.
- Avoid nested card-heavy layouts.

### 36.2. Create Shared Tab Components

- Standardize Opportunity and Project tab behavior.
- Support direct links and active tab states.
- Keep keyboard and mobile behavior sane.

### 36.3. Create Shared Formatting Utilities

- Centralize date/time, money, quantity, unit, status, and unknown-value formatting.
- Reuse existing timezone and bid due authority utilities.
- Remove duplicate formatting logic from pages as they are migrated.

## Task 37 - APPLY VISUAL SIMPLIFICATION PASS
Subtasks:
### 37.1. Reduce Density

- Increase whitespace.
- Reduce unnecessary badges.
- Remove nested containers where they do not clarify hierarchy.

### 37.2. Standardize Information Hierarchy

- Use consistent section ordering.
- Use compact headings for workflow surfaces.
- Keep long report text out of Overview.

### 37.3. Normalize Empty And Partial States

- Use `N/A`, `Not identified`, `Needs Review`, `Preparing`, and `Unavailable` consistently.
- Keep developer errors out of estimator-facing text.
- Preserve detailed diagnostics internally.

## Task 38 - IMPLEMENT BACKWARD COMPATIBILITY AND DATA REPAIR
Subtasks:
### 38.1. Preserve Existing Converted Projects

- Ensure projects converted before F5 still load.
- Backfill lifecycle and origin fields only when safe.
- Provide manual repair notes for ambiguous records.

### 38.2. Preserve Existing Reports And Documents

- Ensure F4 reports remain accessible.
- Ensure source documents remain linked.
- Ensure extracted pages/chunks remain usable for search and citations.

### 38.3. Preserve Legacy One Link Projects

- Confirm legacy source URL and crawl snapshot projects still work.
- Avoid breaking New Project manual/link flows.
- Keep legacy crawl-specific UI out of Opportunity Intelligence workspaces.

## Task 39 - UPDATE DOCUMENTATION AND OPERATIONS NOTES
Subtasks:
### 39.1. Update Roadmap Docs

- Mark completed F5 tasks as implementation proceeds.
- Keep the implementation plan unchanged unless the product direction changes.
- Link relevant migrations and commits from the task list when useful.

### 39.2. Document Operational Workflows

- Document automatic baseline preparation.
- Document bid item extraction behavior.
- Document re-analysis behavior.
- Document Add to Calendar and Project Workspace activation.

### 39.3. Document Known Limitations

- Document unsupported portals or bid item extraction gaps.
- Document manual cleanup paths.
- Document deferred tabs and agents.

## Task 40 - END-TO-END QA AND ROLLOUT
Subtasks:
### 40.1. Validate PlanetBids Workflow

- Scan or refresh a PlanetBids opportunity.
- Confirm automatic baseline preparation.
- Confirm Opportunity Overview, Documents, Intelligence, Add to Calendar, Project Workspace, Bid Readiness, and Bid Items behavior.

### 40.2. Validate Caltrans Workflow

- Scan or refresh a Caltrans opportunity.
- Confirm estimate, documents, bid items where available, and baseline intelligence.
- Confirm partial acquisition and unsupported documents remain estimator-friendly.

### 40.3. Validate Legacy Workflows

- Test manual projects.
- Test One Link projects.
- Test public Bid Room.
- Test Calendar.

### 40.4. Run Final Verification

- Run build.
- Run typecheck.
- Run worker syntax checks when worker files changed.
- Verify no duplicate F2/F3/F4 tasks are created by normal navigation.
- Verify no user-facing page exposes raw worker errors.
