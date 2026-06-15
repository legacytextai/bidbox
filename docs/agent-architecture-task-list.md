# BidBox Agent Architecture — Task List
**Version 4.0 — June 2026**  
**Updated:** Opportunity Intelligence MVP strategy adopted. This file is now the execution roadmap for discovery, project intelligence, qualification, and pursuit initiatives.

## Current Product Strategy Source of Truth

See `docs/initiatives/opportunity-intelligence-mvp.md`.

The MVP workflow is now:

```text
Opportunity Discovery
→ Human Interest Signal
→ Project Intelligence
→ Qualification
→ Add to Calendar
```

This replaces the older implied workflow:

```text
Opportunity Discovery
→ Qualification
→ Project
```

Completed history below is preserved. Future phases are reorganized around the new MVP strategy: discovery stays broad, the estimator chooses which opportunities to analyze, Project Intelligence reads the bid package, and qualification happens after document-backed analysis.

---

## Task 1 - PHASE A: DRIVER ARCHITECTURE FOUNDATION ✅ COMPLETE
Commits: `b291a21`

### 1.1. Define Driver Interface ✅
### 1.2. Build Driver Registry ✅
### 1.3. Refactor scan-opportunities ✅
### 1.4. Success Criteria ✅

---

## Task 2 - PHASE B: AGENT INFRASTRUCTURE FOUNDATION ✅ COMPLETE
Commits: `07a47bd`, `ac30963`, `ccb65f4`

### 2.1. Create `agent_tasks` Table ✅
### 2.2. Create `portal_drivers` Table ✅
### 2.3. Create `agent_run_logs` Table ✅
### 2.4. Success Criteria ✅

---

## Task 3 - PHASE C1: BROWSER DRIVER TECHNICAL VALIDATION ✅ COMPLETE
Research spike in `workstream-c/`. No production code.

### 3.1. Findings ✅
- headless: true blocked by PlanetBids bot detection
- headless: false renders fully — rows clickable, bo-detail URLs captured
- Bearer token interceptable from outgoing API requests
- Plans.pdf (20.8MB) downloaded via https.get with Bearer token
- File manifest available via papi/bid-downloadable-files API

### 3.2. Feasibility Verdict ✅
- PlanetBids Driver Feasible: YES
- Winning Technology: Playwright + Browserbase
- Confidence: High

---

## Task 4 - PHASE C2: PLANETBIDS DRIVER PRODUCTION DESIGN ✅ COMPLETE

### 4.0. Architectural Pivot ✅
- Original plan (driver inside Supabase Edge Function) hit WORKER_RESOURCE_LIMIT
- Revised: Railway worker polls agent_tasks, runs Playwright + Browserbase externally
- This is the correct architecture — exactly what agent_tasks was built for

### 4.1. Railway Worker Built and Deployed ✅
- `bidbox-worker/` Node.js service created
- Polls `agent_tasks` every 30 seconds
- Atomic task claiming (prevents double-processing)
- Runs PlanetBids Playwright driver via Browserbase
- Writes candidates to `opportunity_candidates` with `crawl_data`
- Calls `qualify-candidates` after each task
- Deployed to Railway, online and running
- Commits: `36e1a2c`, `f91bf62`, `6183188`, `15a3c76`, `b174615`

### 4.2. scan-opportunities Modified ✅
- PlanetBids sources now create `agent_tasks` rows and return immediately
- Non-PlanetBids sources continue using Firecrawl inline as before
- Response includes `total_queued` count

### 4.3. qualify-candidates Fixed for Service-to-Service ✅
- `verify_jwt = false` set in config.toml
- profile_id accepted directly in request body
- Worker passes hardcoded admin profile_id: `324e7848-6c4d-4fe5-a826-91427265a76e`
- qualify-candidates runs after scans
- Redeployed live to Supabase project `ztuyjlyuzasbceepezua` on 2026-06-08

### 4.4. Production Results ✅
- 63 candidates evaluated across first 8 agencies
- City of Riverside: 4 new (first run)
- City of Carlsbad: 5 new
- City of Huntington Beach: 5 new
- Port of Los Angeles: 2 new
- City of San Diego: 15 new (first successful crawl)
- Total DB at prior checkpoint: 56 candidates

### 4.5. Scraping Polish Fixes ✅ COMPLETE
Commit: `6b9e433`

- [x] Fix title extraction noise
  - Strips `Add to My Bids`, `REMAINING`, and trailing invitation/bid numbers from extracted titles

- [x] Add construction relevance filtering
  - Skips PlanetBids rows with populated commodity codes when none are in the `91xxx` construction range
  - Includes rows with empty commodity codes to avoid false negatives

- [x] Update qualify-candidates value logic
  - Uses `crawl_data.estimated_value` only when it is a positive number
  - Falls back to `parseValueFromTitle(raw_title)` when value is null, 0, or unavailable
  - Production Edge Function redeployed on 2026-06-08

- [x] Improve PlanetBids estimated value extraction
  - Worker now searches labeled estimate text on detail pages instead of relying on the brittle field helper only
  - Supports labels like Engineer's Estimate, Estimated Value, Project Estimate, Construction Estimate, Budget, and Estimate Range
  - Supports `$1,250,000`, `1,250,000`, `$1.2M`, `$850K`, and ranges such as `$1M - $2M`
  - Stores `estimated_value_raw`, `estimated_value_low`, and `estimated_value_high` in `crawl_data`
  - Uses range midpoint as `crawl_data.estimated_value` for display and qualification

- [x] Add scrape timeout guard and jitter
  - 10-minute outer timeout returns partial candidates
  - Browser closes in final cleanup
  - Adds small randomized waits between row/detail actions

### 4.6. Remaining UI Polish
- ⚠️ **Scan Now UI is misleading** — button shows completion when tasks are only queued. Actual scanning happens asynchronously in Railway worker. UI should show queued/running agent status.
- ⚠️ **Agent activity panel needed** — Opportunities page should show active scan tasks, agency names, status, elapsed time, and progress-like state from `agent_tasks`.

---

## Task 4.7 - PHASE C2 WORKER OBSERVABILITY ✅ COMPLETE

### 4.7.1. Persist worker run logs ✅
- Railway worker now inserts/updates `agent_run_logs` for each claimed task
- Logs include driver messages that were previously only visible in Railway stdout

### 4.7.2. Persist soft driver errors ✅
- Completed tasks with driver-level errors now write `result.error_summary`
- `agent_tasks.error` is populated even when task status is `complete`
- This makes failures like selector/render issues visible from Supabase/Lovable

### 4.7.3. PlanetBids row-render diagnostics ✅
- Initial page wait no longer requires `<tr>` immediately
- Worker waits for `body`, counts `tr` and `[role="row"]` fallbacks, and records a body preview if no bidding rows render
- "No active bids" style pages are treated as clean zero-result scans

### 4.7.4. Exact status-row matching ✅
- PlanetBids row selection now requires exact `Bidding` status text inside the row
- Prevents false positives when a closed project title contains the word "Bidding"
- Example fixed class: "Pipeline Construction Bidding and Bids ... Closed"

### 4.7.5. Scan Now queue visibility ✅
- `scan-opportunities` returns `queued_task_ids` and `queued_tasks` for PlanetBids scans
- Response includes `total_queued`, `total_newly_queued`, and `total_already_queued`
- Active `pending`, `running`, and `retrying` tasks are de-duped by source before queueing new work
- `agent_tasks.updated_at` migration added for live progress panels

### 4.7.6. Task lifecycle decision ✅
- Current canonical statuses remain `pending`, `running`, `complete`, `failed`, `retrying`
- We are not renaming `complete` to `completed` because the schema and Railway worker already use `complete`
- Frontend should treat `complete` as the completed terminal state
- Lifecycle timestamps:
  - `created_at`: queued
  - `started_at`: claimed/running
  - `completed_at`: terminal state (`complete` or `failed`)
  - `updated_at`: latest task row update after migration

### 4.7.7. last_scanned_at decision ✅
- Do not update `opportunity_sources.last_scanned_at` at queue time
- Reason: queueing is not scanning; setting it early would hide failed or pending work as if it completed
- Duplicate scan clicks are handled by active-task de-duping instead
- `last_scanned_at` remains a source completion timestamp

---

## Task 5 - PHASE D: PRELIMINARY METADATA TRIAGE ✅ COMPLETE FOR CURRENT RULE SET

> Strategy note: this phase was originally built as the Qualification Engine. Under the Opportunity Intelligence MVP strategy, it should be treated as preliminary metadata triage only. Final pursuit qualification belongs after Phase F Project Intelligence.

### 5.1. Profile + Engine Built ✅
- gc_qualification_profiles table with all parameters
- qualify-candidates edge function with Red/Yellow/Green rules
- Running after scans as preliminary metadata triage

### 5.2. crawl_data Value Matching ✅
- `crawl_data.estimated_value` is now checked first when it is a positive number
- raw_title parsing remains a fallback
- This unlocks Green status for bids with confirmed values in the configured profile range
- Existing candidates need a re-scan or backfill before old `estimated_value: null` rows change

### 5.3. Construction Relevance Filtering ✅
- Decision: filter at scrape time for PlanetBids when commodity codes are available
- Rule: 91xxx commodity codes are construction-related
- Unknown/empty commodity codes remain included

### 5.4. Remaining Qualification Enhancements
- [ ] Rename or reframe UI language so scan-time status is clearly preliminary
- [ ] Revisit scoring after Phase F Project Intelligence produces document-backed facts
- [ ] Replace hardcoded worker profile_id with config or task payload

### 5.5. Expired Bid Handling ✅
- `qualify-candidates` now auto-reds candidates where `bid_due_at < now()`
- Reason: `Bid closed`
- Cleanup migration marks existing expired candidates as auto-red:
  - `supabase/migrations/20260608000002_mark_expired_opportunity_candidates_red.sql`

---

## Task 6 - PHASE E: AGENCY EXPANSION 🔄 IN PROGRESS

### 6.1. Original Agencies (8) ✅
- City of Irvine, City of Riverside, City of San Diego, Port of Long Beach
- City of Long Beach, City of Carlsbad, Port of Los Angeles, City of Huntington Beach

### 6.2. E1 — Southern California PlanetBids Expansion 🔄 STARTED
- Goal: every verified SoCal public agency using PlanetBids
- Process: find portal ID, add row to `opportunity_sources` with `portal_type = 'planetbids'`
- Pure configuration once the portal is verified
- Priority: HIGH
- Coverage ledger: `docs/opportunity-source-ledger.md`

**Completed:**
- [x] First verified SoCal PlanetBids migration created
  - Migration: `supabase/migrations/20260608000001_seed_socal_planetbids_sources.sql`
  - Adds 54 unique PlanetBids portal URLs as the first verified batch
  - This is not the final SoCal PlanetBids universe
  - Uses `ON CONFLICT (listing_url) DO UPDATE`
  - Does not delete existing sources or cascade existing candidates

- [x] Create opportunity source ledger
  - File: `docs/opportunity-source-ledger.md`
  - Tracks configured, production-enabled, and scan-verified states
  - Only mark a source as scan verified after worker logs prove success

**Next:**
- [ ] Apply migration in Supabase production
- [ ] Verify enabled `planetbids` source count after migration
- [ ] Run one scan cycle against expanded sources
- [ ] Monitor worker duration, Browserbase usage, per-source failures, and duplicate candidates
- [ ] Update `docs/opportunity-source-ledger.md` from production scan results
- [ ] Add follow-up migrations for missing verified PlanetBids agencies discovered during review
- [ ] Tune scan intervals if 24-hour cadence is too aggressive for low-volume sources

### 6.3. E2 — Master SoCal Agency Portal Inventory 📋 PLANNED
- Inventory cities, counties, school districts, ports, airports, transit agencies, water districts, sanitation districts, fire authorities, Caltrans, and state agencies
- Track agency name, agency type, county, portal platform, portal URL, priority, status, and notes
- Known non-PlanetBids platforms: Cal eProcure, Bonfire, OpenGov, Periscope/BidSync, DemandStar, agency-direct/custom portals

### 6.4. E3 — New Driver Per Portal Type 📋 PLANNED
Priority order:
- Cal eProcure driver for Caltrans/state opportunities
- Bonfire driver
- OpenGov driver
- Periscope/BidSync or DemandStar driver, depending on E2 count
- Agency-direct drivers for high-value custom portals such as LA County, LACMTA, LADWP

### 6.5. How to Add a New PlanetBids Agency
- Find PlanetBids portal ID from URL: `vendors.planetbids.com/portal/{ID}/`
- Insert into `opportunity_sources`: name, `portal_type = 'planetbids'`, listing_url, `scan_enabled = true`
- Worker picks it up on the next scan/task queue cycle

---

## Task 7 - PHASE F: PROJECT INTELLIGENCE ❌ NOT STARTED

Phase F is the next major MVP initiative.

Goal: when an estimator clicks `Analyze Project`, BidBox should acquire the bid package, process available documents, generate a practical Project Intelligence report, and then run evidence-based qualification.

This phase expands the old "Document Collection" idea into the full Project Intelligence layer. Document collection is still required, but it is no longer the end goal.

### 7.1. F1 — Analyze Project Workflow ✅ COMPLETE

Purpose: capture the estimator's human interest signal before spending compute.

Current repo support:
- `opportunity_candidates` stores discovered opportunities.
- `/opportunities` already lets users review candidate cards.
- `agent_tasks` can support new async task types.
- `projects` already supports source URL, crawl snapshots, scope fields, bid dates, and calendar-related fields.

Completed:
- [x] Added explicit `Analyze Project` action to opportunity cards.
- [x] Added analysis state fields to `opportunity_candidates`.
- [x] Added authenticated `analyze-project` Edge Function.
- [x] Queues `project_analysis` rows in `agent_tasks`.
- [x] Prevents duplicate active analysis tasks per candidate.
- [x] Shows candidate analysis state in `/opportunities`.
- [x] Supports retry after failed analysis state.
- [x] Keeps Project Intelligence language honest: queued analysis does not mean documents were processed or an AI report exists.
- [x] Removed the old primary `Convert to Project` action from unconverted opportunity cards.

MVP boundary:
- `Analyze Project` is the signal that a project deserves deeper analysis.
- It is not an estimating request, proposal request, or subcontractor outreach request.
- It does not download documents, parse documents, generate an AI report, run post-analysis qualification, add to calendar, or create a project.
- `project_analysis` tasks are queued for the future Project Intelligence worker path; F1 does not mark analysis complete.

### 7.2. F2 — Document Acquisition ✅ COMPLETE

Purpose: retrieve source bid package documents for analyzed opportunities.

Current repo support:
- C1 proved Bearer token access and Plans.pdf download feasibility.
- Worker infrastructure exists.
- PlanetBids driver can capture document manifest metadata in `crawl_data.documents` when available.
- Supabase Storage exists for manually uploaded project files and now stores acquired opportunity source documents.

What was built:
- [x] Added explicit PlanetBids login support in the Railway worker using `PLANETBIDS_EMAIL` and `PLANETBIDS_PASSWORD`.
- [x] Reused the C1-proven bearer token and `papi/bid-downloadable-files` manifest approach.
- [x] Added worker handling for `project_analysis` tasks.
- [x] Downloads source documents through the worker, not the frontend or Edge Functions.
- [x] Added private Supabase Storage bucket `opportunity-documents`.
- [x] Added `opportunity_documents` for file-level acquisition metadata.
- [x] Added separate `document_acquisition_status` fields on `opportunity_candidates`.
- [x] Kept `analysis_status` reserved for the broader Project Intelligence pipeline; F2 does not mark Project Intelligence ready.
- [x] Updated `/opportunities` to show document acquisition progress separately from analysis status.
- [x] Re-aligned the worker with the C1 happy path by reusing the browser-captured `bid-downloadable-files` manifest response when available.
- [x] Added C1-style browser headers to manifest and file download requests.
- [x] Added a zero-byte guard so empty downloads cannot be marked acquired.

Validated production runs:
- [x] `Holiday Decor Rental and Installation Services 26-53`
  - 3 documents acquired
  - 3 documents stored
  - 0 failures
  - Approximately 57 second acquisition run
- [x] `PAVEMENT RESTORATION PARK AVENUE & S BAY FRONT ALLEY 9451-3`
  - 9 documents acquired
  - 9 documents stored
  - 0 failures
  - Approximately 71 second acquisition run
  - Included `Plans.pdf` at approximately 26 MB, addenda, bidder lists, and supporting documents

Validated chain:

```text
PlanetBids
-> Authentication
-> Vendor Access
-> Prospective Bidder Registration
-> Manifest Retrieval
-> Document Download
-> Supabase Storage
-> opportunity_documents
```

Current architecture:
- `analyze-project` queues a `project_analysis` task in `agent_tasks`.
- Railway worker claims the task and routes PlanetBids candidates to `bidbox-worker/drivers/planetbids_documents.js`.
- The PlanetBids document driver logs in, opens the solicitation detail page, opens the Documents tab, captures or fetches the document manifest, downloads files with the authenticated bearer token, uploads files to Supabase Storage, and writes file-level records.
- Heavy acquisition work stays in the worker. The frontend and Edge Functions do not download bid documents.

Tables created / used:
- `opportunity_candidates`
  - `document_acquisition_status`
  - `document_acquisition_started_at`
  - `document_acquisition_completed_at`
  - `document_acquisition_error`
- `opportunity_documents`
  - Tracks file name, type, source URL, storage bucket/path, file size, acquisition status/error, manifest data, and related `agent_task_id`.
- `agent_tasks`
  - Stores `project_analysis` work items.
- `agent_run_logs`
  - Stores acquisition logs and screenshots when available.

Storage structure:
- Private bucket: `opportunity-documents`
- Path pattern:

```text
opportunity-candidates/{opportunity_candidate_id}/{opportunity_document_id}/{file_name}
```

Status tracking:
- Candidate-level lifecycle:
  - `not_requested`
  - `queued`
  - `acquiring`
  - `acquired`
  - `failed`
- File-level lifecycle:
  - `queued`
  - `acquiring`
  - `acquired`
  - `failed`
- `analysis_status` remains separate. F2 acquired documents do not mean Project Intelligence has been generated.

Known limitations:
- Production validation is PlanetBids-specific.
- Document acquisition depends on the shared BidBox PlanetBids automation account and existing Railway secrets.
- Some agencies may still require agency-level vendor registration, prospective bidder registration, or other portal-specific authorization before documents are available.
- The worker stores source files and metadata only; it does not parse, OCR, summarize, classify, or qualify documents.
- Non-PlanetBids portals still need their own acquisition drivers.

Lessons learned from PlanetBids authorization:
- A PlanetBids login alone is not always sufficient for document access.
- Some solicitations require vendor access and/or prospective bidder registration before manifest retrieval or file downloads succeed.
- The original C1 path was correct: capture the authenticated browser bearer token and use PlanetBids' `papi/bid-downloadable-files` manifest.
- The production path became reliable after reusing the browser-captured manifest response when available and matching the C1 request headers.
- Generic authorization expansion should not replace first proving the simple manifest-to-storage path.

Acceptance criteria satisfied:
- [x] Authenticated PlanetBids session established.
- [x] Document manifest captured/retrieved.
- [x] Real source files downloaded by the worker.
- [x] Files uploaded to private Supabase Storage bucket `opportunity-documents`.
- [x] `opportunity_documents` rows created.
- [x] Stored files have non-zero file sizes.
- [x] Candidate document acquisition status updates to `acquired`.

#### F2 Retrospective

Original C1 feasibility proof:
- C1 proved PlanetBids login, bearer token capture, `papi/bid-downloadable-files` manifest retrieval, and direct `Plans.pdf` download.
- The proof downloaded a real `Plans.pdf` using an intercepted bearer token plus browser-like request headers.

Challenges encountered:
- F2 initially expanded into generalized authorization handling before re-proving the core acquisition path end to end.
- Some production attempts returned `Manifest HTTP 403`, which made failures look like generic manifest problems rather than authorization-state problems.

Vendor registration discovery:
- Manual testing showed that some PlanetBids agencies require agency-specific vendor registration before document access is granted.
- This is separate from being logged into PlanetBids globally.

Prospective bidder registration discovery:
- Manual testing showed that some solicitations require `Become a Prospective Bidder` before private documents can be downloaded.
- The form can include required fields such as Classification and Status.

Manifest authorization issues:
- Manifest access depends on the current authenticated and authorized portal state.
- The worker is most reliable when it captures the same manifest response the browser receives from the Documents tab, then uses the captured bearer token for file download.

Final successful acquisition path:
- Login to PlanetBids.
- Reach an authorized solicitation detail page.
- Open Documents tab.
- Capture or retrieve manifest.
- Download files with bearer token.
- Upload to `opportunity-documents`.
- Persist `opportunity_documents` metadata.

MVP boundary:
- F2 is complete for the validated PlanetBids acquisition path.
- Do not build every portal's document acquisition flow before validating with beta contractors.
- This phase does not parse documents, generate AI reports, run post-analysis qualification, create projects, or add opportunities to the calendar.

### 7.2A. F2A — Agency Access Management 📋 PLANNED

Purpose: establish and maintain the agency registration state required for reliable document acquisition.

Strategic placement:

```text
Opportunity Discovery
→ Agency Access Management
→ Analyze Project
→ Document Acquisition
→ Project Intelligence
→ Qualification
→ Add to Calendar
```

Rationale:
- Public agencies often require vendor registration before plans, specifications, addenda, bidder lists, notifications, and procurement communications are available.
- A PlanetBids login is not always sufficient; access may require agency-level vendor registration before prospective bidder registration and document downloads.
- Agency registration fields vary by agency, so deterministic automation alone is unlikely to cover all cases.
- BidBox should manage agency access as a first-class platform capability rather than a scraper exception.

#### 7.2A.1. Registration Agent 📋 PLANNED

Needed:
- Detect agency/vendor registration gates before attempting prospective bidder registration.
- Complete known fields from BidBox internal registration data or, later, the contractor's Bid Profile.
- Select known dropdown values and communication preferences.
- Submit registration only when confidence is sufficient.
- Log method, path, and status for registration mutations without logging credentials, tokens, or form values.
- Keep portal-specific registration logic inside the corresponding driver.

MVP boundary:
- Start with PlanetBids where F2 validation exposed agency/vendor/prospective-bidder access requirements.
- Use BidBox's internal automation account first.
- Do not build customer credential storage before internal registration behavior is proven.

#### 7.2A.2. Registration Memory System 📋 PLANNED

Needed:
- Store agency registration field metadata:
  - agency / portal ID
  - field label
  - field type
  - selected answer
  - confidence score
  - answer source
  - timestamp
- Reuse prior answers for similar future registrations.
- Track which answers came from deterministic rules, Bid Profile data, or human resolution.

MVP boundary:
- Store only non-secret registration answers and preferences.
- Do not store portal passwords or bearer tokens in registration memory.

#### 7.2A.3. Human Escalation Workflow 📋 PLANNED

Needed:
- Create a registration task when the agent cannot confidently answer a required field.
- Show:
  - agency name
  - portal type
  - field requiring input
  - available options
  - suggested answer, if available
- Allow a human to provide the answer.
- Resume registration after resolution.
- Persist the answer into registration memory for future automation.

MVP boundary:
- Start with internal BidBox operator escalation.
- Customer-facing escalation can wait until contractor-owned credentials are introduced.

#### 7.2A.4. Agency Access Coverage Dashboard 📋 PLANNED

Needed:
- Track agency access status across configured opportunity sources:
  - registered
  - registration required
  - prospective bidder required
  - blocked
  - human input required
  - verified document access
- Show last checked time and last successful document access.
- Surface access blockers that prevent Project Intelligence from acquiring documents.

MVP boundary:
- Start as an internal coverage dashboard for BidBox's agency access network.
- Customer-facing coverage belongs after internal reliability is proven.

#### 7.2A.5. Bid Profile Agency Registration Management 📋 PLANNED

Needed:
- Add customer-facing agency access settings inside Bid Profile after internal validation.
- Allow contractors to manage registration preferences such as:
  - Register as Bidder
  - Register as Non-Bidder
  - Receive Communications
  - Do Not Receive Communications
  - Prime Contractor
  - Subcontractor
  - Supplier
  - Other
- Make settings contractor-specific rather than globally defined by BidBox.

MVP boundary:
- Phase 2+ customer-facing capability.
- Requires secure contractor portal credential architecture.

#### 7.2A.6. BidBox Internal Agency Registration Network 📋 PLANNED

Needed:
- Track BidBox's own agency registrations as an internal access network.
- Prioritize agencies discovered in Phase E source expansion.
- Use the network to improve document acquisition success rates.
- Treat each successful agency registration as durable platform coverage.

Success criteria:
- BidBox can distinguish login failure, agency vendor registration required, prospective bidder required, and manifest/document failure.
- At least one gated agency successfully progresses:
  `Login -> agency vendor registration -> prospective bidder registration -> manifest -> document download`.
- Agency access state is visible enough that future failures do not collapse into generic `Manifest HTTP 403`.

Dependencies:
- Existing Railway worker + Browserbase architecture.
- `agent_tasks` / `agent_run_logs` diagnostics.
- Opportunity source inventory from Phase E.
- Future secure credential storage for contractor-owned portal credentials.

### 7.3. F3 — Document Processing ❌ NOT STARTED

Purpose: extract usable text from acquired documents.

Current repo support:
- Manual project files exist.
- `crawl-project` can extract page-level metadata from source pages.
- No full bid-package parsing pipeline exists yet.

Needed:
- Detect file types.
- Extract text from text-native PDFs first.
- Store extracted text and processing status.
- Add OCR later for scanned PDFs if beta projects require it.
- Preserve source references so reports can cite where facts came from.

MVP boundary:
- Do not attempt complete plan takeoff or automated estimating.
- Prefer useful text extraction for specs/addenda before advanced drawing intelligence.

### 7.4. F4 — Project Intelligence Report ❌ NOT STARTED

Purpose: turn acquired documents into a structured estimator-facing report.

Report sections should align with `docs/initiatives/opportunity-intelligence-mvp.md`:
- Executive Summary
- Scope Summary
- Trade Breakdown
- Requirements
- Bid Events
- Risks

Needed:
- Generate and store a report artifact.
- Mark unknown or unavailable fields explicitly.
- Avoid fabricating facts when documents are gated, missing, or unreadable.
- Display the report from the opportunity/project workflow.

MVP boundary:
- The report should help an estimator decide whether the job is worth tracking.
- It does not need to generate estimates, proposals, or subcontractor outreach.

### 7.5. F5 — Qualification After Analysis ❌ NOT STARTED

Purpose: run qualification after Project Intelligence exists.

Current repo support:
- `gc_qualification_profiles` exists.
- `qualify-candidates` exists for preliminary metadata triage.

Needed:
- Define document-backed qualification inputs from the Project Intelligence report.
- Evaluate:
  - Geographic fit
  - Contract size fit
  - License fit
  - Scope fit
  - Historical fit, when data exists
  - Risk profile
- Output:
  - Strong Match
  - Review Carefully
  - Poor Match

MVP boundary:
- Existing `auto_status` can remain as preliminary scan triage.
- Final MVP qualification should be evidence-based and tied to analyzed project intelligence.

---

## Task 8 - PHASE G: PURSUIT MANAGEMENT ❌ NOT STARTED

Phase G is deliberately small for MVP.

Goal: after Project Intelligence and Qualification, the estimator needs one clear action: `Add to Calendar`.

### 8.1. Add to Calendar Signal ❌ NOT STARTED

Purpose: capture that an analyzed opportunity is worth tracking.

Needed:
- Add `Add to Calendar` as the MVP pursuit action after analysis.
- Ensure selected opportunities appear in the existing calendar experience.
- Store enough project/date metadata to make the calendar useful.
- Keep the action lightweight and reversible where possible.

MVP boundary:
- No separate "Pursuing / Not Pursuing" workflow is required for MVP.
- No automated final bid submission.
- No proposal generation.
- No estimating workflow.

### 8.2. Active Calendar Tracking ❌ NOT STARTED

Purpose: make selected opportunities visible in the contractor's planning view.

Current repo support:
- `/calendar` exists.
- `projects.bid_due_at` and `projects.job_walk_at` exist.
- Project creation/conversion paths already create calendar-visible records.

Needed:
- Decide whether analyzed opportunities create or link to `projects` when added to calendar.
- Preserve source URL and intelligence report link.
- Show bid due dates and key bid events where available.

MVP boundary:
- Calendar is the pursuit signal.
- Deeper pursuit management belongs after MVP validation.

---

## Task 9 - FUTURE INITIATIVES / POST-MVP ROADMAP

These initiatives remain strategically valuable but are intentionally outside the Opportunity Intelligence MVP.

### 9.1. Estimating Intelligence POST-MVP

Status: Not started.

Reason outside MVP:
- The MVP is not attempting automated estimating.
- Estimating requires deeper plan/spec interpretation, quantity extraction, pricing assumptions, and estimator workflow design.

### 9.2. Outreach Intelligence POST-MVP

Status: Not started.

Reason outside MVP:
- The MVP only needs discovery, analysis, qualification, and Add to Calendar.
- Subcontractor outreach, coverage tracking, and bid solicitation automation should wait until the Project Intelligence loop proves valuable.

### 9.3. Coverage / Compliance / Proposal Agents POST-MVP

Status: Not started.

Reason outside MVP:
- These depend on document-backed scope and requirement extraction.
- They should not distract from validating the core product question: can BidBox find relevant jobs and tell contractors which ones are worth tracking?

---

## Task 10 - OPEN ITEMS / NEXT PRIORITIES

### 10.1. Immediate Next
- Keep Phase E source verification moving so Discovery coverage is credible
- Update `docs/opportunity-source-ledger.md` with production scan-verified statuses
- Add worker stale-task protection so scans cannot hang indefinitely
- Monitor F2 document acquisition across additional gated PlanetBids opportunities
- Design the Agency Access Management data model for internal BidBox agency access state
- Add the PlanetBids Registration Agent path for agency vendor registration before prospective bidder registration
- Define the minimum data model for Project Intelligence reports and source documents

### 10.2. Later
- Begin E2 master agency portal inventory for beta-relevant agencies
- Add Agency Access Coverage dashboard for internal BidBox operations
- Add registration memory and human escalation workflows
- Add customer-facing Bid Profile agency registration management after internal validation
- Decide first non-PlanetBids driver after E2 shows source counts
- Add text extraction and Project Intelligence report generation
- Add evidence-backed qualification after Project Intelligence
- Add `Add to Calendar` as the MVP pursuit action

### 10.3. Architecture Decisions Locked
- ✅ Railway worker + agent_tasks polling (not webhooks)
- ✅ Browserbase for headless browser (not self-hosted)
- ✅ Playwright for portal automation (not Stagehand)
- ✅ Bearer token for document download (not browser download)
- ✅ Single worker, LIMIT 1 per poll cycle initially (can scale horizontally later)
- ✅ Agency/vendor/prospective-bidder registration is portal-specific driver behavior, not generic task-router behavior

### 10.4. Roadmap Ownership
- `docs/agent-architecture-task-list.md` is the source of truth for Opportunity Intelligence execution work
- `docs/initiatives/opportunity-intelligence-mvp.md` is the product strategy source of truth
- `docs/initiatives/opportunity-intelligence-implementation-plan.md` is the practical implementation plan that connects strategy to this roadmap
