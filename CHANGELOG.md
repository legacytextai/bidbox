# BidBox Changelog

All notable changes to the BidBox project are documented in this file.

---

## [F5.3 Autonomous Opportunity Pipeline] - 2026-06-28

### Autonomous Preparation

- Expanded worker refresh behavior so supported opportunities encountered during scan refresh are evaluated for automatic Opportunity Intelligence preparation.
- New opportunities continue to queue preparation immediately.
- Existing unprepared opportunities can now be queued by refresh even when portal metadata is unchanged.
- Material metadata changes can queue refreshed Opportunity Intelligence for unconverted opportunities, including ones that were previously ready.
- Added preparation reason metadata to queued tasks for source/trigger diagnostics.

### Manual Recovery

- Removed `Analyze Project` as the normal card-level action.
- Opportunity cards now open the Opportunity dossier by default, show progress for active preparation, and reserve `Retry Analysis` for failed opportunities.
- The Opportunity Intelligence tab now distinguishes `Refresh Analysis` for existing reports from `Retry Preparation` for unprepared or failed opportunities.
- Manual fallback queueing now checks active acquisition, processing, and intelligence tasks before creating new work.

---

## [F5 Opportunity Experience Visual Recovery] - 2026-06-28

### Opportunity Cards

- Restored the calmer Opportunity card presentation from the reference implementation while preserving F5 routing, lifecycle state, and tab architecture.
- Re-established the editorial card hierarchy: project title, agency, portal badge, bid due date, estimate, source, and one primary action.
- Removed visual clutter from cards, including duplicate lifecycle/status badges, county lines, whole-card click behavior, and dashboard-heavy metadata styling.

### Opportunity Overview

- Kept the simplified Overview architecture: Project Snapshot, Executive Summary, Bid Items.
- Refined Executive Summary into a single estimator briefing section with typographic hierarchy for Project Overview, Major Requirements, Required Licenses, Bond Requirements, and Primary Risks.
- Updated design guidance so future F5 work preserves the restored visual language.

---

## [F5 Opportunity Overview Simplification] - 2026-06-25

### Overview Tab

- Reduced Opportunity Overview from 6 sections to 3: Project Snapshot, Executive Summary, Bid Items.
- Executive Summary is now the complete intelligence briefing — AI prose paragraphs followed by license requirements and critical bid requirements within one section, separated by a subtle rule. No sub-headers, no separate "Key Requirements" card.
- Removed Key Dates, Key Requirements, Documents sections from Overview. Documents live in the Documents tab; additional dates and requirements evidence live in the Intelligence tab.
- Removed `documents` prop from `OpportunityOverviewTab` — the component now accepts only `data: OpportunityOverviewData`.
- Updated `docs/design-guidelines.md` §Opportunity Overview from 6-section to 3-section canonical definition.

---

## [F4A Deadline Display & Override Hardening] - 2026-06-23

### Deadline Workflow

- Kept a single definitive bid due date visible in Opportunity Intelligence reports and Bid HQ.
- Added expandable conflict evidence so estimators can inspect competing cited deadline evidence without replacing the primary deadline.
- Added lightweight Project Workspace bid due overrides using project-level fields only.
- Documented the full Deadline Resolution Engine as deferred Phase 2 architecture.

---

## [Phase G Pursuit Management Planning] - 2026-06-22

### Phase Objective

Begin Phase G documentation and architecture alignment before implementation.

---

### Pursuit Management & Project Workspace

- Reframed Task 8 from a narrow Add to Calendar feature into Phase G: Pursuit Management & Project Workspace.
- Documented that Intelligence Report and Project Workspace are separate concepts.
- Confirmed Opportunity Intelligence remains the source of truth for project evaluation.
- Confirmed `Add to Calendar` creates or reuses a `projects` record.
- Confirmed `projects` remains the Calendar anchor model for MVP.
- Documented that Opportunity Intelligence projects should not re-enter legacy One Link crawl flows.
- Documented that legacy One Link projects and Opportunity Intelligence projects should branch by project origin.
- Added Phase G task structure for project origin tracking, conversion hardening, legacy crawl separation, Project Workspace MVP, intelligence integration, dashboard updates, calendar validation, and end-to-end workspace validation.
- Paused F5 Qualification Agent as the next implementation phase until the Project Workspace bridge is stable.

---

## [Opportunity Intelligence F4 MVP Complete] - 2026-06-22

### Phase Objective

Close Task 7.4 — F4 Project Intelligence Report as MVP complete. At the time, F5 Qualification Agent was identified as the next intelligence phase; Phase G has since been prioritized as the workspace bridge before F5 implementation.

---

### F4 - Project Intelligence Report

- Implemented and validated document-backed Project Intelligence reports.
- Added worker-driven report generation from F3 document/page/chunk evidence.
- Stored reports, findings, and citations in the F4 intelligence tables.
- Preserved source-backed citation chains from report finding to source document, page, chunk, and excerpt.
- Added Executive Summary output with `Project Overview` context.
- Added Project Snapshot metadata, including source portal metadata where available.
- Added scope summary, trade breakdown, key dates, bid requirements, addenda summary, risk flags, and source document references.
- Added explicit unknown, needs-review, and conflict states for unavailable or conflicting facts.
- Enforced no-citation-no-fact behavior so unsupported factual findings are downgraded.

### F4 Quality And Workflow Hardening

- Confirmed F2 Document Acquisition, F3 Document Processing, and F4 Project Intelligence function end-to-end.
- Validated F4 against multiple real PlanetBids projects across several agencies.
- Confirmed portal metadata flows into reports, including engineer estimates and license requirements when available.
- Improved Executive Summary consistency so reports start with project context before bid requirements.
- Added bid due date/time conflict safeguards and source-backed deadline display.
- Corrected the Opportunity → Intelligence Report workflow so analyzed opportunities keep report access after being added to calendar.
- Corrected converted project navigation so the report page can still open the linked project.

### Roadmap And Documentation

- Marked F4 Project Intelligence as `✅ COMPLETE`.
- Updated platform status:
  - F1 Opportunity Discovery / Analyze Project: ✅ Complete
  - F2 Document Acquisition: ✅ Complete
  - F3 Document Processing: ✅ Complete
  - F4 Project Intelligence: ✅ Complete
- Phase G Pursuit Management & Project Workspace is now the next active implementation phase.
- Task 7.5 — F5 Qualification Agent remains planned after the Project Workspace bridge is stable.
- Defined F5 purpose: determine whether the contractor should pursue an analyzed opportunity using Project Intelligence findings and contractor profile inputs, including licensing, bonding, insurance, experience, labor compliance, self-perform capability, strategic fit, risk profile, and pursuit recommendation.

---

## [Opportunity Intelligence F1-F3 Validation] - 2026-06-16

### Phase Objective
Advance the Opportunity Intelligence MVP from broad discovery into validated document-backed evidence processing, while preserving the boundary that Project Intelligence and Qualification start in F4/F5.

---

### F1 - Analyze Project Workflow

- Completed the `Analyze Project` workflow as the estimator's human-interest signal.
- Added analysis state fields to `opportunity_candidates`.
- Added the authenticated `analyze-project` Edge Function.
- Queued `project_analysis` tasks through `agent_tasks`.
- Added duplicate prevention for active analysis/acquisition tasks.
- Updated `/opportunities` so the primary action is `Analyze Project`, not old Yes/Maybe/No triage or Convert to Project.
- Kept UI copy explicit that queued/acquired/processed states do not mean Project Intelligence has been generated.

---

### F2 - Document Acquisition

- Implemented PlanetBids document acquisition in the Railway worker.
- Added `opportunity_documents` and candidate-level `document_acquisition_*` fields.
- Created the private `opportunity-documents` Supabase Storage bucket.
- Added authenticated PlanetBids access using `PLANETBIDS_EMAIL` and `PLANETBIDS_PASSWORD`.
- Added PlanetBids-specific prospective bidder registration support.
- Validated the full production acquisition chain:
  - PlanetBids authentication
  - Vendor/prospective-bidder access
  - Manifest retrieval
  - Document download
  - Supabase Storage upload
  - `opportunity_documents` persistence
- Production validation examples:
  - `Holiday Decor Rental and Installation Services 26-53`: 3 documents acquired, 3 stored, 0 failures.
  - `PAVEMENT RESTORATION PARK AVENUE & S BAY FRONT ALLEY 9451-3`: 9 documents acquired, 9 stored, 0 failures, including `Plans.pdf`, addenda, bidder lists, and supporting documents.

---

### F3 - Document Processing

- Implemented the F3 evidence-processing pipeline.
- Added processing fields to `opportunity_candidates` and `opportunity_documents`.
- Added `opportunity_document_pages`.
- Added `opportunity_document_chunks`.
- Added `document_processing` worker task handling.
- Added `pdfjs-dist` to the worker for text-native PDF extraction.
- F2 now automatically queues F3 document processing after successful acquisition.
- F3 processes acquired files in the worker, not the frontend or Edge Functions.
- Text-native PDFs are extracted page by page.
- Page text is stored in `opportunity_document_pages`.
- Retrieval chunks are stored in `opportunity_document_chunks`.
- Citation metadata preserves the document -> page -> chunk chain.
- Non-PDF files are marked `unsupported`.
- Scanned/image-only PDFs are marked as needing OCR when text extraction is insufficient.
- No OCR, summaries, reports, qualification, estimating, recommendations, or F4 intelligence generation were added.

Production validation target:

```text
San Miguel Drive Pavement Rehabilitation 9855-2
City of Newport Beach
```

Production validation results:

```text
5 PDFs processed
178 pages extracted
106 chunks created
0 failures
0 OCR-required documents
```

Validated chain:

```text
PDF
-> Document Processing Task
-> PDF Text Extraction
-> opportunity_document_pages
-> opportunity_document_chunks
-> Citation Metadata
```

Verified:
- `opportunity_documents` populated correctly.
- `opportunity_document_pages` populated correctly.
- `opportunity_document_chunks` populated correctly.
- Document -> page -> chunk citation chain verified.
- Candidate and document processing statuses updated correctly.
- Production processing completed successfully.

---

### F3 Bug Fixes

- Fixed a production PDF.js cleanup failure in `bidbox-worker/drivers/document_processing.js`.
- Root cause: `pdf.destroy()` does not exist on the pinned `pdfjs-dist` legacy `PDFDocumentProxy`, and the call threw synchronously.
- Fix: guarded both `pdf.cleanup()` and `pdf.destroy()` with `typeof` checks before calling them.
- Validation passed:
  - worker syntax checks
  - `npm run build`
  - `npx tsc --noEmit`

---

### Roadmap And Documentation

- Updated Opportunity Intelligence roadmap documents to mark F3 as `✅ COMPLETE`.
- Updated platform status:
  - F1 Opportunity Discovery / Analyze Project: ✅ Complete
  - F2 Document Acquisition: ✅ Complete
  - F3 Document Processing: ✅ Complete
  - F4 Project Intelligence: ✅ Complete
  - Phase G Pursuit Management & Project Workspace: 🔄 Next active task
  - F5 Qualification Agent: ⏸ Paused until the Project Workspace bridge is stable
- Added F3A backlog item for classification accuracy improvements.
- Documented observed classification issues:
  - `Notice Inviting Bids` classified as addendum.
  - `Sample Contract` classified as plans.
- Clarified that F3A was not an F3 blocker and did not block F4.
- Reaffirmed the architecture boundary:
  - F3 classifies, extracts, organizes, chunks, cites, and tracks status.
  - F3 does not interpret requirements, generate intelligence reports, answer estimator questions, resolve precedence conflicts, qualify opportunities, or make pursuit recommendations.

---

## [Phase 1 Opportunity Intelligence Push] - 2026-06-09

### Phase Objective
Expand Southern California PlanetBids coverage, fix qualification/scanning correctness issues found in production, and prepare the Scan Now UX for live queued-worker progress.

---

### Production Deployments And Coordination

- Confirmed `qualify-candidates` was redeployed on Supabase project `ztuyjlyuzasbceepezua`.
- Confirmed Railway worker deploys from GitHub branch `phase1-opportunity-intelligence`.
- Confirmed Railway does not launch a new deployment for every Scan Now click; Scan Now queues `agent_tasks`, and the already-running worker service drains that queue.
- Confirmed Railway worker scaling is replica-based: each replica runs one polling worker process.
- Found current Railway plan/service limits cap the worker at **2 replicas** through the UI, despite an attempted change to 3 via Railway agent.
- Recommended operating at 2 replicas for now, with future options to upgrade Railway or add in-process worker concurrency.

---

### Source Expansion - Phase E1

- Added the first verified SoCal PlanetBids expansion batch:
  - Migration: `20260608000001_seed_socal_planetbids_sources.sql`
  - Count: 54 configured PlanetBids sources
  - Scope: cities, ports, school districts, water/sanitation agencies, airports, transit, and special districts.
- Added source ledger:
  - File: `docs/opportunity-source-ledger.md`
  - Purpose: operational proof sheet for agencies BidBox is configured to crawl.
  - Important rule: a source is not considered successfully crawling until marked **Scan verified**.
- Ran a second discovery pass and added 22 more candidate sources:
  - Migration: `20260609000001_seed_socal_planetbids_sources_pass2.sql`
  - Ledger total increased from 54 to 76 configured PlanetBids sources.
  - New additions include Anaheim, Huntington Park, Indio, Moreno Valley, Palmdale, Santa Fe Springs, Upland, Eastvale, Downey USD, Brea Olinda USD, Rio Hondo CCD, Chaffey College, MiraCosta CCD, EVMWD, IEUA, Santa Margarita Water District, SBCTA, Imperial County DPW, and others.
- Noted a source-verification issue:
  - Portal `48397` is labeled `Los Angeles World Airports` in the first-pass migration, but public search results also reference that portal ID as `Santa Clara Valley Water District`.
  - No rename/removal was made; this requires production scan/log verification first.

---

### Estimated Value Extraction

- Updated backend value handling so `qualify-candidates` reads `crawl_data.estimated_value`.
- Confirmed the frontend should only display estimated value when the backend actually populates it.
- Confirmed a missing estimated value on opportunity cards was not a frontend rendering bug; records had `estimated_value: null` in `crawl_data`.
- Added PlanetBids estimate extraction work so detail-page values can be stored when available.
- Verified Browserbase quota exhaustion temporarily blocked all new extraction work until the Browserbase plan was upgraded.

---

### Worker Diagnostics And Browserbase

- Added worker-side diagnostic persistence:
  - Worker writes `agent_run_logs`.
  - Worker persists soft driver errors into `agent_tasks.error` and `result.error_summary`.
  - This removed the debugging blind spot where tasks completed with `{ found: 0, new: 0, errors: 1 }` and no stored error message.
- Diagnosed Browserbase failures:
  - Root cause was `HTTP 402 Payment Required`.
  - Browserbase free plan minutes were exhausted.
  - After upgrading Browserbase, sessions began creating successfully again.
- Confirmed worker behavior:
  - `agent_tasks` is the shared scan queue.
  - Each worker replica claims one pending task using `UPDATE ... WHERE status = 'pending'`.
  - Multiple replicas can scan different agencies in parallel without duplicate task execution.
- Improved worker queue throughput:
  - Worker replicas now immediately try to claim the next pending task after completing one.
  - The 30-second poll delay is now used only when no pending task is available.
  - `qualify-candidates` is throttled to at most once every 2 minutes per worker replica to avoid rapid repeated qualification calls during large queue drains.

---

### Candidate Correctness Fixes

- Fixed PlanetBids false positives caused by matching `"Bidding"` anywhere in a row.
  - The bug allowed closed projects with titles containing the word "Bidding" to be imported.
  - Driver logic was tightened to match the actual status cell instead of any row text.
- Fixed PlanetBids zero-candidate scrape failures caused by brittle row detection.
  - Driver now waits for PlanetBids API/network readiness instead of relying on a fixed 3-second delay.
  - Broadened result-row detection across table, grid, and result-row markup variants.
  - Driver clicks Search when the portal renders controls but no rows appear initially.
  - Zero-row failures now log final URL, API response count, row counts, found-bids text, body preview, and results-container HTML preview.
- Added qualifier hard rule for expired bids:
  - Candidates with `bid_due_at < now()` are auto-red.
  - Prevents old/closed bids from remaining visible as yellow/maybe.
- Added cleanup migration for expired candidates:
  - Migration: `20260608000002_mark_expired_opportunity_candidates_red.sql`.

---

### Scan Now UX Backend Support

- Added backend support for Lovable's new live Scan Now progress UI.
- Updated `scan-opportunities` response payload to include:
  - `total_queued`
  - `total_newly_queued`
  - `total_already_queued`
  - `queued_task_ids`
  - `queued_tasks`
- Added de-duping for active PlanetBids tasks:
  - Existing `pending`, `running`, or `retrying` task for a source is returned instead of queueing a duplicate.
- Added `agent_tasks.updated_at` migration:
  - Migration: `20260608000003_agent_tasks_updated_at.sql`.
  - Enables live progress panels to sort/filter by latest task updates.
- Documented task lifecycle:
  - `pending`: queued
  - `running`: claimed by worker
  - `complete`: terminal success state used by current schema/worker
  - `failed`: terminal failure state
  - `retrying`: active retry state
- Decided not to update `opportunity_sources.last_scanned_at` at queue time.
  - Reason: queueing is not scanning; updating early would make failed or pending work look complete.
  - Duplicate Scan Now clicks are handled by active-task de-duping instead.
- Fixed Scan Now `504 IDLE_TIMEOUT` root cause after source expansion.
  - Removed the old 2-second per-source throttle from the PlanetBids queue path.
  - Split `scan-opportunities` into a fast bulk PlanetBids enqueue lane and a slower non-PlanetBids driver lane.
  - Moved `qualify-candidates` invocation out of the per-source loop for non-PlanetBids scans.
  - Added a `partial` response safety flag when non-PlanetBids work would be too large for the Edge Function request window.

---

### Lovable / Frontend Coordination

- Provided Lovable deployment prompts to:
  - Pull latest from `phase1-opportunity-intelligence`.
  - Apply pending Supabase migrations.
  - Redeploy `scan-opportunities`.
- Confirmed Lovable's new `ActiveScansPanel` expects task status value `complete`, not `completed`.
- Left Lovable frontend changes intact while committing backend support.
- Confirmed future frontend can use returned `queued_task_ids` / `queued_tasks` instead of relying on timestamp-based lookup.

---

### Commits Referenced Today

- `96060c4` - expand socal sources and improve estimate extraction
- `a0e616f` - persist worker scan diagnostics
- `b1ffff7` - filter closed bids and mark expired candidates
- `7dd2c16` - support scan now task progress

---

## [Phase 1 Session 1] – 2026-05-26

### 🎯 Phase Objective
Lay the foundation for automated bid opportunity discovery — enabling BidBox to scan public procurement portals, surface new bid opportunities, and allow GCs to review and convert them into active projects with one click.

---

### Database

#### New Tables

1. **`opportunity_sources`** — Configuration for procurement portals to monitor.
   - `id` (uuid, PK), `name`, `portal_type`, `listing_url`, `scan_enabled`, `scan_interval_hours`, `last_scanned_at`
   - Supports multiple portal types: `planetbids`, `caltrans`, `epro`, `ersp`, `bonfirehub`, `ramp`

2. **`opportunity_candidates`** — Raw bid opportunities discovered during scans.
   - `id` (uuid, PK), `source_id` (FK), `source_url` (unique), `portal_type`, `raw_title`, `agency`, `bid_due_at`, `scope_text`
   - Review workflow: `status` (pending | red | yellow | green | converted), `review_notes`, `reviewed_by`, `reviewed_at`, `converted_project_id`
   - Unique constraint on `source_url` to prevent duplicates across rescans

3. **`agent_runs`** — Audit log for every scan execution.
   - `id` (uuid, PK), `source_id` (FK), `started_at`, `completed_at`, `candidates_found`, `candidates_new`, `errors`, `raw_log`
   - Enables observability and debugging of scan pipeline issues

#### Seed Data

- **8 PlanetBids agencies seeded** across Southern California:
  - City of Irvine, City of Riverside, City of San Diego
  - Port of Long Beach, City of Long Beach, City of Carlsbad
  - Port of Los Angeles, City of Huntington Beach

---

### Backend

#### New Edge Function: `scan-opportunities`

- **Trigger:** Manual ("Scan Now" button) or scheduled (cron-ready)
- **Pipeline:**
  1. Reads enabled `opportunity_sources` from DB
  2. Scrapes each listing URL via **Firecrawl** (`waitFor` adapted per portal type — 8s for PlanetBids JS-rendered pages)
  3. Extracts individual opportunities via **Lovable AI Gateway** (Gemini 2.5 Flash) with structured tool-calling
  4. Upserts candidates into `opportunity_candidates` (URL-deduplicated)
  5. Logs execution to `agent_runs` with full raw logs
- **Dual extraction paths:**
  - **PlanetBids path:** Uses `extract_planetbids_opportunities` tool — filters Stage="Bidding", extracts `bid_id` from `/bo-detail/{id}` links, builds detail URLs via portal ID
  - **Generic path:** Uses `extract_opportunity_list` tool for non-PlanetBids portals with URL validation
- **Resilient design:** Always returns HTTP 200 with `success: false` on failure (per project contract)

---

### Frontend

#### New Page: `/opportunities`

- **Auth-gated** dashboard for reviewing discovered bid opportunities
- **Card grid layout** (responsive 1→2→3 columns)
- **Filter tabs:** All, Pending, Green, Yellow, Red, Converted (with live counts)
- **Per-card actions:**
  - Status triage (Red / Yellow / Green buttons)
  - Review notes input (auto-saves on blur)
  - External link to source URL
  - **"Convert to Project"** — one-click project creation:
    - Creates project from candidate metadata (`raw_title`, `agency`, `bid_due_at`, `source_url`, `portal_type`, `scope_text`)
    - Auto-triggers `crawl-project` edge function for background enrichment
    - Marks candidate as `converted` with `converted_project_id` FK
    - Toast with "View Project" action button
- **"Scan Now"** button with spinner state and last-scanned timestamp
- **Empty state** with contextual messaging and CTA

---

### Navigation

- Added `/opportunities` route to `App.tsx`
- Sidebar navigation link added (inferred from standard layout)

---

### Known Limitations / Next Steps

- Firecrawl API key required for scan functionality (currently stored in Lovable Cloud secrets)
- Scan is **manual-only** in Session 1; daily cron automation planned for Session 2
- No auto-classification of trades or scope analysis yet (candidate title is raw)
- Caltrans portal path deferred to Phase 1 Session 2

---

## [Phase 1 Sessions 2–3] – 2026-05-28

### 🎯 Phase Objective
Refine the opportunity discovery pipeline to PlanetBids-only sources, add a user qualification profile system so every discovered candidate is automatically pre-scored against the GC's real bid parameters, and update the dashboard to surface the most relevant candidates first.

---

### Phase 1A Refinements — Opportunity Discovery Pipeline

#### Sources Narrowed to PlanetBids Only

The original seed included Caltrans and a mix of portal types. The sources table was reseeded with 8 Southern California PlanetBids portals only:

- City of Irvine (Orange County)
- City of Riverside
- City of San Diego
- Port of Long Beach
- City of Long Beach
- City of Carlsbad
- Port of Los Angeles
- City of Huntington Beach

The reseed uses `DELETE FROM opportunity_sources` (which cascades to `opportunity_candidates`) before inserting. This was intentional — PlanetBids is the only reliably scrapeable portal type at this stage.

#### PlanetBids Extraction Refinement

The `scan-opportunities` edge function was updated with a PlanetBids-specific extraction path:

- Portal ID extracted from listing URL via regex (`/portal/(\d+)/`) before any scraping
- `waitFor: 8000ms` in Firecrawl to allow Ember.js rendering time
- LLM system prompt explicitly instructs: extract only rows where `Stage = Bidding`; exclude Closed, Rejected, Awarded
- `bid_id` extracted from `/bo-detail/{id}` hrefs found in scraped markdown; detail URL constructed as `https://vendors.planetbids.com/portal/{portalId}/bo/bo-detail/{bid_id}`
- `agency` always set to `source.name` (not LLM output) for consistency

**Known limitation — detail URL reliability:**
PlanetBids is built on Ember.js. The `/bo-detail/{bid_id}` links are rendered by JavaScript click handlers, not present as static `href` attributes in the initial page HTML. Firecrawl captures the rendered DOM as markdown, but `bid_id` extraction from that markdown is unreliable — some bids have discoverable links, many do not. Constructed detail URLs may point to incorrect bids. Two identified solutions for a future phase: **VendorLine API** ($395/year, structured PlanetBids data) or an **OpenClaw browser agent** capable of interacting with Ember.js UI directly.

**Known bug — free tier limit bypass:**
Converting an opportunity to a project via the Opportunities dashboard bypasses the 3-project free tier limit that exists on the standard New Project flow. Not yet fixed.

---

### Phase 1B — User Qualification Profile + Smart Filtering

#### Database Changes

**New table: `gc_qualification_profiles`**

Stores one row per user. `profile_id` is a FK to `profiles.id` (= `auth.uid()`) with a UNIQUE constraint — one profile per user. No company/tenant layer in this phase (see Architecture Decisions below).

| Column | Type | Description |
|---|---|---|
| `target_counties` | `text[]` | California counties the GC bids in |
| `licenses_held` | `text[]` | Contractor license classes held (e.g. A, B) |
| `min_project_value` | `numeric` | Minimum project value to consider |
| `max_project_value` | `numeric` | Maximum project value to consider |
| `bond_capacity` | `numeric` | Bonding capacity |
| `agency_exclusions` | `text[]` | Agencies to always auto-Red |
| `trade_categories` | `text[]` | Scopes of interest (empty = all trades) |

Array columns default to `'{}'` (not NULL) to simplify UI-side iteration. RLS: four policies (SELECT/INSERT/UPDATE/DELETE) all gated on `profile_id = auth.uid()`.

Seeded with one row for `constructionaisolutions.co@gmail.com`: Orange/LA/Riverside/San Diego counties, licenses A and B, $2M–$15M range, $50M bond capacity, no exclusions, all trades. Seed uses a subquery on `profiles.email` — no hardcoded UUIDs. If the email is not in `profiles` when the migration runs, the INSERT silently skips.

**New columns on `opportunity_candidates`:**

| Column | Type | Notes |
|---|---|---|
| `auto_status` | `text` | System-assigned: red/yellow/green. CHECK constraint. NULL = not yet qualified. |
| `auto_status_reason` | `text` | Human-readable explanation, e.g. "County unknown; Value not determinable" |
| `qualification_score` | `integer` | 0–100. CHECK constraint enforces range. |
| `qualified_at` | `timestamptz` | Timestamp of last auto-qualification run |

`auto_status` is completely separate from the manual `status` field. The auto-qualifier never reads or writes `status`. An index on `auto_status` was added for dashboard sort performance.

Migration file: `supabase/migrations/20260528000001_gc_qualification_profiles.sql`

#### New Edge Function: `qualify-candidates`

Registered with `verify_jwt = true`. Accepts optional `candidate_id` (qualify one) or `profile_id` (qualify all pending for a specific user) in the POST body. Defaults to `auth.uid()` if neither is provided.

**Execution flow:**

1. Identifies calling user from Bearer token via `supabase.auth.getUser()`
2. Loads `gc_qualification_profiles` for the resolved user — returns early with a message if no profile exists; candidates stay `auto_status = null`
3. Loads all `opportunity_candidates` where `status = 'pending'` (manually reviewed candidates are never touched)
4. Runs each candidate through the rule engine
5. Writes `auto_status`, `auto_status_reason`, `qualification_score`, `qualified_at` to each row individually
6. Returns `{ evaluated, auto_green, auto_yellow, auto_red, skipped, errors }`

**Qualification rule engine:**

Red rules are evaluated first. If any Red rule fires, Yellow is not evaluated. Yellow flags are all collected (not short-circuited). Green is assigned if nothing fired.

*Red rules (hard disqualifiers):*
- Agency matches an entry in `agency_exclusions` (case-insensitive)
- County is confirmed and outside all `target_counties`
- Extracted value is confirmed and below `min_project_value`
- Extracted value is confirmed and above `max_project_value`

*Yellow rules (soft flags — all collected):*
- County cannot be determined from available data
- Project value cannot be determined from available data
- `bid_due_at` is within 5 days of now
- `scope_text` is null or fewer than 50 characters

*Green:* assigned if no Red or Yellow fired.

**Scoring:**
- Red: 5–10
- Yellow: 30–50, minus 10 per additional Yellow flag (floor 30)
- Green: 70 base, +10 for confirmed county match, +10 for confirmed value in range (ceiling 100)

**County inference:**
At the candidate stage, `crawl_data` is not populated — only `raw_title`, `agency`, `bid_due_at`, and `source_url` come from the listing scrape. County is inferred by mapping the `agency` field through a static `AGENCY_COUNTY` lookup table inside the edge function. `crawl_data.county` is checked first if present.

**⚠️ Important:** `AGENCY_COUNTY` is a hardcoded map of exact `source.name` strings to California counties. When new rows are added to `opportunity_sources`, a corresponding entry must be manually added to `AGENCY_COUNTY` in `supabase/functions/qualify-candidates/index.ts` or those candidates will permanently receive a Yellow "County unknown" flag.

**Value parsing:**
Dollar amounts are extracted from `raw_title` via regex. Handles: `$5M`, `$2.5M`, `$2,500,000`, `$150K`, `$1.2B` (suffix case-insensitive). `crawl_data.estimated_value` takes precedence if present.

**License checking — dormant in Phase 1:**
`licenses_held` is stored in the profile but no Red rule fires on license mismatch. There is no license requirement data at the candidate stage — `crawl_data` is not populated until after `crawl-project` runs on a converted opportunity. Ready to activate in Phase 2 when structured crawl data is available earlier in the pipeline.

#### Scanner → Qualifier Wiring

`scan-opportunities` modified to call `qualify-candidates` after each source run, after `finishRun()` writes the agent_run record. The Authorization header from the original scan request is passed through to the qualifier.

Errors from `qualify-candidates` are non-fatal — a failed or timed-out qualifier never fails the scan run.

**⚠️ Known limitation:** If `scan-opportunities` is called without a user JWT (e.g. a future cron job), `authHeader` will be empty and the qualify call is silently skipped. Needs redesign when automated scheduled scanning is added.

**Note on logging:** Qualification result counts appear in Supabase Functions console logs but are not written to `agent_runs.raw_log` — `finishRun()` writes that field before the qualify call is made.

#### Profile Settings Page (`/settings/profile`)

Form sections: Geography (county multi-select), Licensing (license class multi-select), Project Size (min/max currency inputs), Bond Capacity, Agency Exclusions (multi-select from live `opportunity_sources`), Trade Categories. On save: UPSERTs to `gc_qualification_profiles`, then calls `qualify-candidates` for all pending candidates and shows a toast with re-evaluated count. "Bid Profile" link added to sidebar nav.

#### Opportunities Dashboard Updates

- Auto-status badge on each card (outlined/ghost style, distinct from manual status buttons). Hidden if `auto_status` is null.
- Tooltip on badge shows `auto_status_reason` and `qualification_score`
- Sort order on All view: green → yellow → null → red
- Collapsible "Filtered Out" section — auto-Red candidates hidden by default

---

### Architecture Decisions

**Single-user profile model**
`gc_qualification_profiles` ties to `profiles.id`, not a company table. A `gc_companies`/`gc_company_members` multi-tenant layer was designed in full during this session and explicitly deferred — there is one GC using the system and the added complexity had no immediate benefit. When a company layer is added later, only the FK on `gc_qualification_profiles` changes; the qualification logic and edge function do not need to change.

**Candidates are upstream of tenancy**
`opportunity_candidates` has no `gc_id` or `gc_company_id`. Candidates are globally visible to all authenticated users. This is intentional for Phase 1 — a shared candidate pool is the correct mental model when there is one GC. Per-company candidate scoping is a Phase 2 concern.

**ON CONFLICT DO NOTHING preserves reviewed candidates**
Re-running the scanner never overwrites a candidate that has been manually reviewed. A coordinator's decision is durable across re-scans.

**`auto_status` and `status` are always separate**
The auto-qualifier writes only `auto_status`, `auto_status_reason`, `qualification_score`, and `qualified_at`. It never reads or writes `status`. This separation is enforced by convention in the edge function, not by a DB constraint.

---

### Known Limitations and Open Items

| Item | Notes |
|---|---|
| PlanetBids detail URLs may be incorrect | Ember.js click-rendered links; `bid_id` extraction unreliable. Future: VendorLine API or OpenClaw browser agent. |
| Convert to Project bypasses free tier limit | 3-project enforcement missing on opportunity conversion path. Not yet fixed. |
| License checking dormant | `licenses_held` stored but no Red rule fires. Activate in Phase 2 when `crawl_data` carries detail-page fields. |
| `AGENCY_COUNTY` lookup is static | New `opportunity_sources` rows need a matching entry in `qualify-candidates/index.ts` manually. |
| Cron scans skip qualification | Auth header passthrough requires a user JWT; automated scans without a session silently skip qualify-candidates. |
| CaleProcure not integrated | `caleprocure.ca.gov` uses PeopleSoft AJAX; scraping deferred. |
| Qualify results not in `agent_runs.raw_log` | Counts in Supabase Functions console logs only. |
| `types.ts` not regenerated | Must be regenerated from live schema after migration is applied. Lovable used `as any` casts as a workaround. |
| Branch not merged to main | All Phase 1 work is on `phase1-opportunity-intelligence`. |

---

## [Sprint 1] — 2026-06-02

### Objective
Prove whether a browser-driver acquisition architecture is viable for PlanetBids and build the foundational infrastructure required to support it.

### Workstream A — Driver Architecture (COMPLETE)

Decoupled BidBox from Firecrawl via a driver abstraction layer.

New files:
- supabase/functions/_shared/opportunity_driver.ts — OpportunityDriver interface with scan(source, context) method. Defines CandidateData, ScanResult, DriverContext types.
- supabase/functions/_shared/firecrawl_driver.ts — FirecrawlDriver implementing the interface. Contains all Firecrawl + Gemini LLM logic extracted from scan-opportunities, both PlanetBids and generic paths.
- supabase/functions/_shared/driver_router.ts — runDriver(source, context) dispatches on source.portal_type. Adding a new driver in Phase C2 is a one-line case addition, zero changes to scan-opportunities.

Refactored: scan-opportunities/index.ts now calls runDriver() instead of Firecrawl directly. ~360 lines removed. Zero behavioral change. All 8 PlanetBids sources continue scanning identically.

### Workstream B — Agent Infrastructure (COMPLETE)

Three new tables deployed to hosted Supabase:

- agent_tasks — unified job queue for all future agent types (discovery, document collection, spec extraction, outreach). Fields: id, task_type, status (CHECK constraint), priority, payload jsonb, result jsonb, error, timestamps. Indexed on status and priority-ordered pending queue.
- portal_drivers — maps portal_type to driver name and mode. Seeded: planetbids, caltrans, simple_html → firecrawl_driver. Update planetbids row to planetbids_driver when Phase C2 ships.
- agent_run_logs — per-run audit trail linked to agent_tasks. Fields: id, task_id (FK), status, logs, screenshots jsonb, artifacts jsonb, timestamps.

All three tables have RLS: authenticated read, service_role full write.

### Workstream C — PlanetBids Technology Validation (COMPLETE)

Research spike against City of Irvine PlanetBids portal (portal ID 15927). Technology tested: raw Playwright.

Findings:

1. headless: true — portal renders nothing. Tables: 0, rows: 0. PlanetBids detects headless mode and blocks rendering.
2. headless: false — portal renders fully. Tables: 2, rows: 32. Full bid list visible including titles, invitation numbers, due dates, stage.
3. Row click — successfully navigated to bo-detail/141798 (real database ID captured via Ember router navigation).
4. Detail page extraction (unauthenticated) — title, bid due date, estimated value ($1,410,000), license requirements (Class A / C-10), county (Orange), commodity codes (91200, 91300, 91350, 91382, 91430), scope description, document list all extracted successfully.
5. Authentication — login via identity.planetbids.com (Stytch OAuth). Bearer token issued and sent on all subsequent api-external.prod.planetbids.com requests. Token interceptable from outgoing request headers.
6. Document manifest — papi/bid-downloadable-files?bid_id=141798 returns structured JSON with exact file paths on files-prod01.planetbids.com including serverFullPath and serverFilename.
7. Document download — Plans.pdf (20,864,506 bytes) successfully downloaded to disk using Node.js https.get with intercepted Bearer token and Referer/Origin headers. No Browserbase required for downloads.

### Sprint 1 Feasibility Verdict

PlanetBids Driver Feasible: YES

Winning Technology: Playwright + Bearer token extraction

Confidence: High

Known risks:
- headless: true blocked by PlanetBids — Browserbase required for production cloud scanning (listing page only)
- Bearer token expires — production driver must handle token refresh via papi/oauth/refresh/
- PlanetBids uses commodity codes (91xxx) not NAICS (2xxxxx) — qualification engine needs commodity code support
- AGENCY_COUNTY lookup in qualify-candidates is static — new sources need manual entries

Recommended next step: Phase C2 — build PlanetBids driver using Playwright + Browserbase for listing scan, Bearer token extraction for document download, wire into driver router.

---

## [Sprint 1 — Phase C2 + Railway Worker] — 2026-06-03

### Objective
Move PlanetBids browser automation out of Supabase Edge Functions (which hit WORKER_RESOURCE_LIMIT) and into an external Railway worker that polls agent_tasks.

### Architecture Pivot
The original C2 design ran Playwright + Browserbase inside a Supabase Edge Function. This immediately hit WORKER_RESOURCE_LIMIT — the edge runtime cannot support a full browser session. The correct architecture was always agent_tasks → external worker, which is exactly what Phase B built the infrastructure for.

### Railway Worker (bidbox-worker/)
New Node.js service deployed to Railway. Files: index.js (polling loop), drivers/planetbids.js (Playwright driver), lib/supabase.js, Dockerfile.worker, railway.toml.

Polling loop: every 30 seconds, SELECT pending planetbids_scan tasks LIMIT 1, atomic claim via UPDATE WHERE status=pending, run driver, write results, mark complete. Errors are non-fatal — worker continues polling even if a task fails.

PlanetBids driver (Node.js port of the Deno driver from C1): connects to Browserbase via CDP, navigates listing page, clicks each Bidding row, captures bo-detail URL via Ember.js router navigation, extracts metadata from detail page (title, bid due date, estimated value, license requirements, county, commodity codes, scope text), fetches file manifest via papi/bid-downloadable-files API using intercepted Bearer token, returns structured candidates.

After writing candidates: calls qualify-candidates edge function with hardcoded admin profile_id. qualify-candidates updated to accept profile_id in request body (verify_jwt = false) to support service-to-service calls without a user JWT.

### scan-opportunities Modified
PlanetBids sources (portal_type = planetbids) now INSERT an agent_tasks row and return immediately instead of running runDriver() inline. Non-PlanetBids sources continue using Firecrawl as before. Response includes total_queued count.

### Production Results (first full run)
- 8 agencies scanned via Railway worker
- 56 total candidates in database
- 63 candidates evaluated by qualify-candidates (all Yellow — county confirmed, value unknown)
- qualify-candidates running automatically after every scan
- City of San Diego: 15 new on first successful crawl
- City of Huntington Beach: 5 new
- City of Carlsbad: 5 new
- City of Riverside: 4 new
- Port of Los Angeles: 2 new

### Known Issues
- Scan Now UI shows immediate completion but worker runs for 20-40 mins asynchronously
- 1-2 row timeout errors per portal on last rows (re-navigation timing)
- All candidates Yellow — qualify-candidates not yet reading crawl_data.estimated_value
- Title extraction includes "Add to My Bids REMAINING X days" noise from detail page
- No bearer token captured without login — file manifests skipped

### Next Priorities
- Fix qualify-candidates to read crawl_data.estimated_value for Green/Red determination
- Add construction relevance filtering (commodity code 91xxx)
- Expand to all SoCal PlanetBids agencies
- Phase F: authenticated document download
