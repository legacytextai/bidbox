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
- Project Intelligence report generation.
- Evidence-backed qualification after analysis.
- Calendar action specifically tied to analyzed opportunities.

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

Project Intelligence is the next major build phase.

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
- This does not block F4 because the evidence extraction and citation chain work correctly.

Out of scope for MVP:

- Quantity takeoff.
- Full drawing understanding.
- Complete spec indexing across every file type.
- Intelligence report generation.
- Qualification.
- Summarization or recommendations.

### 3. Project Intelligence Report

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

The MVP pursuit layer has one action:

```text
Add to Calendar
```

This is the only pursuit signal needed for validation.

### Current Foundation

- `/calendar` exists.
- Project bid due dates and job walk dates already appear in calendar contexts.
- Projects can store source URLs and metadata.

### MVP Requirements

- Let the estimator add an analyzed opportunity to the calendar.
- Preserve the Project Intelligence report link or context.
- Show bid due date and key bid events when available.
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
   - F3A classification accuracy improvements remain future backlog and should not delay F4.

8. **Project Intelligence report** ⬜ Next
   - Generate the first practical report format.
   - Prioritize scope, trades, requirements, bid events, and risks.

9. **Post-analysis qualification**
   - Evaluate the report against the contractor profile.
   - Output Strong Match / Review Carefully / Poor Match.

10. **Add to Calendar**
   - Let the estimator add analyzed opportunities to the existing calendar.
   - Use this as the MVP pursuit signal.

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
- Evidence-backed qualification.
- Add to Calendar.

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

## Relationship to Agent Architecture Roadmap

This implementation plan maps directly to `docs/agent-architecture-task-list.md`:

- Phase E: Discovery layer.
- Phase F: Agency Access Management and Project Intelligence layer.
- Phase G: Add-to-Calendar pursuit layer.
- Future Initiatives: estimating, outreach, coverage, compliance, and proposal agents.

The roadmap should not split into competing files. This plan explains execution intent; the Agent Architecture Task List tracks execution phases and tasks.
