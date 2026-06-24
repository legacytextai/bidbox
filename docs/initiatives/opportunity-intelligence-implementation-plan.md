# Opportunity Intelligence MVP Implementation Plan

Status: Proposed  
Date: June 2026  
Strategy source of truth: `docs/initiatives/opportunity-intelligence-mvp.md`  
Execution roadmap: `docs/agent-architecture-task-list.md`

## Executive Summary

BidBox's Opportunity Intelligence MVP should validate one core loop:

```text
Opportunity Discovery
→ Human Interest Signal
→ Agency Access Management
→ Project Intelligence
→ Qualification
→ Add to Calendar
```

The product should first give contractors broad visibility into public works opportunities in their target areas. The estimator then chooses which opportunities deserve deeper analysis by clicking `Analyze Project`. Only after that should BidBox spend compute to verify agency access, acquire documents, extract project intelligence, and run meaningful qualification.

This plan intentionally avoids building a full autonomous bidding platform. The MVP should prove that 1-5 beta contractors can use BidBox to find relevant public works opportunities, analyze selected jobs faster, and decide which ones are worth adding to their calendar.

Current implementation focus: F4 Project Intelligence is complete. Before resuming F5 Qualification, Phase G will harden the transition from Intelligence Report to active pursuit by creating a Project Workspace layer that reuses F4 intelligence and avoids legacy One Link crawl behavior.

## Current State

### Already Implemented

- `opportunity_sources` stores scan sources.
- `opportunity_candidates` stores discovered opportunities.
- `scan-opportunities` queues PlanetBids scan tasks.
- `agent_tasks` and `agent_run_logs` support background scan execution and diagnostics.
- Railway worker processes PlanetBids scans with Browserbase and Playwright.
- PlanetBids driver extracts metadata such as title, agency, due date, detail URL, estimate when available, commodity codes, scope snippets, and document manifest metadata when available.
- F2 document acquisition is complete for the validated PlanetBids path.
- Production validation proved PlanetBids authentication, vendor/prospective-bidder access, manifest retrieval, document download, Supabase Storage upload, and `opportunity_documents` persistence.
- Validated production projects include `Holiday Decor Rental and Installation Services 26-53` with 3 documents acquired and `PAVEMENT RESTORATION PARK AVENUE & S BAY FRONT ALLEY 9451-3` with 9 documents acquired.
- F3 document processing is complete for the validated PlanetBids/text-native PDF path.
- F3 production validation on `San Miguel Drive Pavement Rehabilitation 9855-2` for City of Newport Beach processed 5 PDFs, extracted 178 pages, created 106 chunks, and produced 0 failures / 0 OCR-required documents.
- `opportunity_document_pages` and `opportunity_document_chunks` now preserve the document → page → chunk citation chain for future Project Intelligence.
- F4 Project Intelligence is complete for the validated MVP path.
- F4 generates document-backed Project Intelligence reports with executive summaries, project snapshot metadata, scope summaries, trade breakdowns, key dates, bid requirements, addenda summaries, risk flags, source document references, and citation-backed findings.
- F4 production validation covered multiple real PlanetBids projects across several agencies and confirmed end-to-end F2 → F3 → F4 execution.
- F4 quality hardening added portal metadata enrichment, engineer-estimate/license propagation, Project Overview executive-summary context, bid due date/time conflict safeguards, and corrected report navigation after calendar conversion.
- F4A Phase 1 deadline hardening keeps one definitive bid due date visible in reports and Bid HQ, surfaces conflicting evidence in an expandable inspection panel, and supports lightweight project-level deadline overrides.
- Full Deadline Resolution Engine work remains deferred to Phase 2; see `docs/initiatives/deadline-resolution-engine.md`.
- Analyzed opportunities can be added to calendar, and converted opportunities retain access to their Intelligence Report.
- Current conversion creates/reuses `projects` records as the Calendar anchor, but the Project Workspace still needs Phase G hardening so Opportunity Intelligence projects do not re-enter legacy One Link crawl flows.
- `/opportunities` displays discovered candidates and scan progress.
- `gc_qualification_profiles` and `qualify-candidates` provide preliminary metadata triage.
- `/calendar` already exists for project date tracking.
- `projects` supports source URLs, due dates, crawl snapshots, scope text, job walk fields, and document visibility fields.
- Supabase Storage stores manually uploaded project files and acquired opportunity source documents.

### Not Yet Implemented

- Agency Access Management for agency/vendor/prospective-bidder registration state.
- Registration memory and human escalation for ambiguous agency registration questions.
- F3A classification accuracy improvements for edge-case document names and titles.
- OCR for scanned PDFs.
- Evidence-backed qualification after analysis.
- Phase G Project Workspace for Opportunity Intelligence pursuits.

## Target User Workflow

1. Contractor configures target geography and basic profile.
2. BidBox scans supported public works portals.
3. Contractor sees a broad opportunity list.
4. Contractor ignores, saves, or chooses `Analyze Project`.
5. BidBox verifies agency access and resolves registration blockers where possible.
6. BidBox acquires available bid package documents for analyzed opportunities.
7. BidBox processes documents into page/chunk evidence.
8. BidBox generates a Project Intelligence report.
9. BidBox qualifies the analyzed project using document-backed facts.
10. Contractor clicks `Add to Calendar` for opportunities worth tracking.

## Discovery Layer

Discovery remains broad. Its job is visibility, not final bid/no-bid judgment.

### Current Foundation

- Phase E in `docs/agent-architecture-task-list.md`.
- SoCal PlanetBids source expansion.
- Source ledger in `docs/opportunity-source-ledger.md`.
- Queue-based scan architecture.

### MVP Requirements

- Keep scan results broad enough that estimators trust they are seeing the market.
- Clearly show metadata:
  - Project title
  - Agency
  - County when available
  - Due date
  - Portal/source
  - Estimated value when available
- Treat existing auto status as preliminary metadata triage only.
- Prevent closed/expired bids from polluting the useful list.
- Keep scan progress reliable and visible.

### Practical Next Steps

1. Continue verifying PlanetBids sources in the source ledger.
2. Add worker stale-task protection before expanding scan volume further.
3. Reframe UI copy from final "qualification" to preliminary scan signals.

## Analyze Project Workflow

`Analyze Project` is the human interest signal.

It prevents BidBox from spending document-processing compute on every scanned opportunity.

### MVP Requirements

- Add an `Analyze Project` action to opportunity cards.
- Store analysis status.
- Queue an analysis task in `agent_tasks` or a closely related background mechanism.
- Show clear statuses:
  - Not analyzed
  - Analysis queued
  - Analyzing
  - Intelligence ready
  - Analysis failed
- Keep the estimator in control.

### Practical Data Questions

Resolve during implementation:

- Should analysis attach directly to `opportunity_candidates`, create a project record, or create a separate `project_intelligence_reports` record first?
- Should `Add to Calendar` create a `projects` row or link an analyzed candidate into the existing calendar model?
- How should repeated analysis requests be de-duped?

MVP bias: choose the smallest schema that supports analysis status, report storage, and calendar integration without blocking later refinement.

## Project Intelligence Layer

Project Intelligence is the core completed MVP analysis layer. The next major build phase is F5 evidence-backed qualification on top of these reports.

### 0. Agency Access Management

Goal: obtain and maintain the agency access required for document acquisition.

Agency Access Management is the layer between broad discovery and reliable document acquisition. It handles the reality that a procurement portal login may not be enough. A contractor or BidBox automation account may also need agency-level vendor registration and solicitation-level prospective bidder or plan holder registration before documents and manifests are available.

Start with PlanetBids because F2 production validation exposed the pattern:

```text
Login
→ Register as Vendor for Agency
→ Become Prospective Bidder / Plan Holder
→ Retrieve Manifest
→ Download Documents
```

MVP requirements:

- Detect agency vendor registration gates.
- Detect prospective bidder / plan holder gates.
- Keep registration logic portal-specific inside the relevant driver.
- Use BidBox's internal automation account first to establish a BidBox agency access network.
- Track agency access state and blockers.
- Create human escalation tasks when a required field cannot be answered confidently.
- Store non-secret registration memory so future agency registrations become more automated.

Out of scope for the first pass:

- Customer-owned portal credential storage.
- Customer-facing registration dashboard.
- Universal support for every portal.
- OAuth/delegated access architecture.

### 1. Document Acquisition

Status: complete for the validated PlanetBids acquisition path.

Goal: retrieve source bid package files for analyzed opportunities.

Start with PlanetBids because:

- The worker already handles Browserbase/Playwright.
- C1 proved Bearer token feasibility.
- The driver can sometimes capture document manifest metadata.

Implemented:

- Downloads available PlanetBids source documents for analyzed opportunities.
- Stores source files durably in the private `opportunity-documents` Supabase Storage bucket.
- Tracks file acquisition status and errors in `opportunity_documents`.
- Tracks candidate acquisition status separately from Project Intelligence `analysis_status`.
- Handles authenticated PlanetBids access using Railway worker secrets and bearer-token document requests.
- Reuses the browser-captured `bid-downloadable-files` manifest response when available.

Production validation:

```text
PlanetBids
→ Authentication
→ Vendor Access
→ Prospective Bidder Registration
→ Manifest Retrieval
→ Document Download
→ Supabase Storage
→ opportunity_documents
```

Validated projects:

- `Holiday Decor Rental and Installation Services 26-53`
  - 3 documents acquired
  - 3 documents stored
  - 0 failures
  - Approximately 57 seconds
- `PAVEMENT RESTORATION PARK AVENUE & S BAY FRONT ALLEY 9451-3`
  - 9 documents acquired
  - 9 documents stored
  - 0 failures
  - Approximately 71 seconds
  - Included `Plans.pdf`, addenda, bidder lists, and supporting documents

Known limitations:

- This is validated for PlanetBids only.
- Non-PlanetBids portals need separate drivers.
- Some agencies may still require additional agency-specific registration behavior.
- F2 stores documents but does not parse, OCR, summarize, qualify, or generate Project Intelligence.

### 2. Document Processing

Status: complete for the validated PlanetBids/text-native PDF processing path.

Goal: extract enough page-citable text evidence to support future Project Intelligence.

Implemented:

- Detects file type and MIME type.
- Processes text-native PDFs with `pdfjs-dist`.
- Stores page-level text in `opportunity_document_pages`.
- Stores retrieval chunks in `opportunity_document_chunks`.
- Preserves document → page → chunk citation metadata.
- Tracks processing status and failures on candidates and documents.
- Marks OCR need as metadata only; OCR is not implemented.

Production validation:

```text
San Miguel Drive Pavement Rehabilitation 9855-2
City of Newport Beach

5 PDFs processed
178 pages extracted
106 chunks created
0 failures
0 OCR-required documents
```

Known F3A backlog:

- Improve deterministic classification accuracy.
- Observed issues:
  - `Notice Inviting Bids` classified as addendum.
  - `Sample Contract` classified as plans.
- This did not block F4 because the evidence extraction and citation chain work correctly.

Out of scope for MVP:

- Quantity takeoff.
- Full drawing understanding.
- Complete spec indexing across every file type.
- Qualification.
- Summarization or recommendations.

### 3. Project Intelligence Report

Status: complete for the validated MVP path.

Goal: summarize the facts an estimator needs to decide whether to track a job.

Report sections:

- Executive Summary
- Scope Summary
- Trade Breakdown
- Requirements
- Bid Events
- Risks

Report rules:

- Clearly mark unknown fields.
- Do not fabricate facts.
- Prefer source-backed statements.
- Make the report short enough for estimator review.
- Preserve source citations for factual findings.
- Start Executive Summary with project context through `Project Overview`.
- Use portal metadata when available for fields such as engineer estimate and license requirements.
- Warn when bid due date/time sources conflict instead of silently rendering contradictory deadlines.

Implemented:

- `project_intelligence` worker task.
- Stored report rows, findings, and citations.
- Citation validation and no-citation-no-fact downgrading.
- Opportunity Report page with Executive Summary, Project Snapshot, report sections, citations, and source documents.
- Analyzed tab / report navigation that preserves access after `Add to Calendar`.

Production validation:

- Real PlanetBids projects.
- Multiple agencies.
- F2 Document Acquisition functioning.
- F3 Document Processing functioning.
- F4 Project Intelligence functioning.
- Source-backed citations and portal metadata verified.

## Qualification Layer

Qualification should happen after Project Intelligence exists.

### Current State

`qualify-candidates` currently performs preliminary metadata triage using title, agency/county, due date, and estimated value when available.

This remains useful but should not be treated as final pursuit qualification.

### Target State

After Project Intelligence, qualification evaluates:

- Geographic fit
- Contract size fit
- License fit
- Scope fit
- Historical fit when enough data exists
- Risk profile

Outputs:

- Strong Match
- Review Carefully
- Poor Match

### MVP Requirements

- Keep scan-time metadata triage separate from post-analysis qualification.
- Base final qualification on extracted project intelligence.
- Explain why the project was classified.
- Surface missing information as a reason for caution, not a hallucinated answer.

## Pursuit Layer

The MVP pursuit layer begins with one signal:

```text
Add to Calendar
```

For Phase G, `Add to Calendar` means create or reuse a `projects` row and open a lightweight Project Workspace seeded from the existing F4 Intelligence Report.

The Intelligence Report and Project Workspace are separate concepts:

- Intelligence Report: the canonical evidence-backed explanation of the opportunity.
- Project Workspace: the operational home once the contractor is tracking/pursuing the project.

Opportunity Intelligence projects should never re-enter legacy One Link crawl flows after F2/F3/F4 have completed.

### Current Foundation

- `/calendar` exists.
- Project bid due dates and job walk dates already appear in calendar contexts.
- Projects can store source URLs and metadata.
- Projects currently serve as the Calendar anchor model.
- `opportunity_candidates.converted_project_id` links converted opportunities to projects.
- F4 Intelligence Reports remain stored separately from projects.

### MVP Requirements

- Let the estimator add an analyzed opportunity to the calendar.
- Create or reuse a `projects` row as the operational anchor.
- Track project origin so legacy One Link projects and Opportunity Intelligence projects use different workspace logic.
- Preserve the Project Intelligence report link and originating opportunity link.
- Show bid due date and key bid events when available.
- Show bid due conflict evidence without replacing the primary deadline.
- Allow a Project Workspace bid due override without introducing full deadline candidate/resolution tables.
- Build a lightweight Project Workspace for active pursuits.
- Avoid building a full pursuit CRM before validation.

Out of scope:

- Pursue/Pass workflow.
- Proposal generation.
- Automated final bid submission.
- Subcontractor outreach automation.
- Coverage management.
- Estimating automation.

## Recommended Build Sequence

1. **Roadmap cleanup**
   - Use `docs/agent-architecture-task-list.md` as the execution source of truth.
   - Keep `docs/tasks.md` as broad historical backlog only.

2. **Discovery hardening**
   - Verify source ledger.
   - Add stale-task protection.
   - Keep Scan Now progress reliable.

3. **UI language cleanup**
   - Reframe scan-time auto status as preliminary triage.
   - Avoid implying metadata-only qualification is final.

4. **Analyze Project action**
   - Add the explicit human-interest action.
   - Store analysis state.
   - Queue analysis work.

5. **Agency Access Management**
   - Model login, agency vendor registration, prospective bidder registration, and manifest access as separate authorization states.
   - Build the first PlanetBids Registration Agent path.
   - Track internal BidBox agency access status.
   - Add human escalation for unknown registration fields.
   - Start registration memory with non-secret field answers.

6. **Document acquisition**
   - Start with PlanetBids documents.
   - Store source files.
   - Track acquisition status.

7. **Document text extraction** ✅ Complete
   - Text-native PDFs are processed into page and chunk evidence.
   - Processing status and failure visibility are implemented.
   - F3A classification accuracy improvements remain future backlog and did not block F4.

8. **Project Intelligence report** ✅ Complete
   - Generated and validated the first practical report format.
   - Includes scope, trades, requirements, bid events, risks, source documents, and citations.

9. **Pursuit Management & Project Workspace** 🔄 Next active task
   - Treat `Add to Calendar` as create/reuse project.
   - Add project origin and report/opportunity linkage.
   - Separate Opportunity Intelligence projects from legacy One Link projects.
   - Build the MVP Project Workspace as a pursuit-management shell over F4 intelligence.
   - Validate Opportunity → Intelligence Report → Add to Calendar → Project Workspace.

10. **Post-analysis qualification**
   - Evaluate the report against the contractor profile.
   - Output Strong Match / Review Carefully / Poor Match.
   - Consider licensing, bonding, insurance, experience, labor compliance, self-perform capability, strategic fit, risk profile, and pursuit recommendation.

11. **Beta feedback loop**
   - Test with 1-5 contractors.
   - Track whether reports save time and whether calendar additions map to real interest.

## MVP Boundaries

The MVP includes:

- Broad public works opportunity discovery.
- Estimator-selected analysis.
- Internal BidBox agency access management where required for document acquisition.
- Document acquisition for analyzed opportunities.
- Basic document text extraction.
- Project Intelligence report.
- Add to Calendar.
- Lightweight Project Workspace seeded from the Intelligence Report.
- Evidence-backed qualification.

The MVP excludes:

- Automated estimating.
- Proposal generation.
- Automatic final bid submission.
- Subcontractor outreach automation.
- Full coverage tracking.
- Complete addenda diffing.
- Every non-PlanetBids driver.
- Perfect document understanding.
- Customer-owned portal credential management.
- Customer-facing Agency Access Coverage dashboard.

## Success Criteria

The MVP succeeds if a beta contractor can:

1. Discover relevant public works opportunities.
2. Select interesting opportunities for analysis.
3. Receive an AI-generated Project Intelligence report.
4. Understand whether the project is worth tracking.
5. Add selected opportunities to the calendar.

Business validation signals:

- Contractor finds at least one relevant opportunity they would have missed or found late.
- Contractor uses `Analyze Project` on a subset of discovered opportunities.
- Project Intelligence report reduces manual portal/document review time.
- Post-analysis qualification matches estimator judgment often enough to be trusted.
- `Add to Calendar` becomes a meaningful signal of real pursuit interest.
- Converted opportunities open a Project Workspace without duplicate document acquisition, processing, intelligence generation, or legacy crawl states.

## Relationship to Agent Architecture Roadmap

This implementation plan maps directly to `docs/agent-architecture-task-list.md`:

- Phase E: Discovery layer.
- Phase F: Agency Access Management and Project Intelligence layer.
- Phase G: Pursuit Management & Project Workspace layer.
- Future Initiatives: estimating, outreach, coverage, compliance, and proposal agents.

The roadmap should not split into competing files. This plan explains execution intent; the Agent Architecture Task List tracks execution phases and tasks.
