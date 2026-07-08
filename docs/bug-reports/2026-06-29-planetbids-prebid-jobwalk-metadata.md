# BidBox Bug Report: PlanetBids Pre-Bid / Job Walk Metadata Extraction Failure

**Date:** June 29, 2026  
**Project:** BidBox  
**Branch:** `phase1-opportunity-intelligence`  
**Primary impacted area:** PlanetBids portal metadata extraction and Project Snapshot rendering  
**Status:** Parked / unresolved pending deterministic parser harness  
**Severity:** High for trust, medium for immediate workflow if scoped away from bid items  

---

## 1. Executive Summary

This report documents the prolonged investigation into BidBox's failure to reliably extract and display basic PlanetBids pre-bid / job walk metadata on the Project Snapshot and related intelligence surfaces.

The core user-facing failure was simple:

> PlanetBids displays structured portal metadata such as `Pre-Bid Meeting`, `Meeting Type`, `Date & Time`, `Attendance Required`, and `Meeting Link`, but BidBox displayed incomplete, contradictory, or incorrect values such as `Required / Unknown / Unknown`, `N/A`, or incorrectly inferred meeting status.

The investigation uncovered that the problem is not an LLM problem, not a document-processing problem, and not primarily a UI problem. The evidence points to brittle PlanetBids parser logic, multiple duplicated parsing paths, and confusion between separate acquisition paths:

- `planetbids_scan` — source/listing scan path
- `project_analysis` → `acquirePlanetBidsDocuments` — single-candidate acquisition/re-analysis path

Several fixes were attempted and pushed. Some issues were resolved, especially Caltrans estimate/bid-items and portal-authoritative bid-item persistence. However, the PlanetBids pre-bid/job-walk extraction issue remains unresolved for the key failing project, Polytechnic High School Improvements, because validation became tangled between closed-bid listing scans, single-candidate re-analysis, missing debug persistence, and parser changes made before inspecting the actual DOM.

The final recommendation is to stop live debugging this issue through Railway/Lovable loops and instead build an offline deterministic parser harness using saved raw PlanetBids HTML/text snapshots.

---

## 2. Original Problem Statement

The issue was discovered while reviewing BidBox opportunity/project pages after the autonomous pipeline/backfill work.

### 2.1 Polytechnic High School Improvements

Observed in BidBox:

- Project Snapshot showed job walk / pre-bid as needing review or incomplete.
- Later versions showed variants such as:
  - `Required`
  - `Unknown`
  - `Unknown`
  - or `Pre-Bid Meeting / Mandatory: Yes / Attendance Required: Yes / Date: Unknown / Time: Unknown`

Observed on PlanetBids source portal:

- `Pre-Bid Meeting`: Yes
- `Meeting Type`: Remote
- `Date & Time`: `06/04/2026 9:00 AM (PDT)`
- `Meeting Link`: present
- `Attendance Required`: Yes
- Additional details indicated a second mandatory pre-bid conference held virtually via Zoom and registration required.

Expected BidBox behavior:

- Project Snapshot should display that a pre-bid/job walk exists.
- It should distinguish:
  - whether there is a meeting
  - whether attendance is required/mandatory
  - date/time
  - remote/in-person type
  - meeting link
  - location if available
- It should not rely on LLM inference for deterministic portal metadata.

---

## 3. Related Observed Cases

### 3.1 Santa Ana Bikeway / Memory Lane and Flower Street Bikeway

PlanetBids source portal showed:

```text
Pre-Bid Meeting
No
```

BidBox at one point showed incorrect output like:

```text
Pre-Bid Meeting
Mandatory: Yes
Attendance Required: No
Date: Unknown
Time: Unknown
```

This was contradictory because a project with `Pre-Bid Meeting: No` should not render as mandatory.

Later debug payload showed the worker eventually wrote:

```json
{
  "pre_bid_meeting": "No",
  "pre_bid_exists": false,
  "pre_bid_meeting_at": null,
  "pre_bid_attendance_required": null,
  "pre_bid_meeting_link": null
}
```

That suggests the pre-bid meeting extractor was at least correct for the Santa Ana `No` case after fixes.

### 3.2 TCA SR 241 Loma Improvements Project Design Services

PlanetBids source portal showed:

- `Pre-Bid Meeting`: Yes
- `Meeting Type`: Remote
- `Date & Time`: `06/10/2026 1:30 PM (PDT)`
- `Meeting Link`: present
- `Attendance Required`: No
- Additional details present

BidBox showed incomplete/incorrect output:

- `Job Walk / Pre-Bid`: `N/A`
- or missed meeting type/date/link

This indicated that the problem was not isolated to Polytechnic.

---

## 4. Systems and Files Involved

The investigation touched or referenced the following pieces:

### 4.1 Worker drivers

- `bidbox-worker/drivers/planetbids.js`
  - Listing/source scan path.
  - Runs during `planetbids_scan` tasks.
  - Scrapes listing/detail page metadata and writes candidate `crawl_data` through `persistScannedCandidate`.

- `bidbox-worker/drivers/planetbids_documents.js`
  - Single-candidate acquisition path.
  - Runs during `project_analysis` tasks through `acquirePlanetBidsDocuments`.
  - Re-authenticates to PlanetBids for one candidate/bid, refreshes portal metadata, downloads documents, and writes merged metadata through `mergeCandidatePortalMetadata`.

- `bidbox-worker/index.js`
  - Task dispatcher and persistence logic.
  - Handles `planetbids_scan`, `project_analysis`, `document_processing`, `project_intelligence`, etc.

- `bidbox-worker/drivers/bid_items.js`
  - Portal-authoritative bid item logic.

- `bidbox-worker/drivers/caltrans.js`
- `bidbox-worker/drivers/caltrans_documents.js`
  - Caltrans extraction and validation.

### 4.2 Frontend / adapter

- `src/lib/opportunityView.ts`
  - Shared adapter that maps candidate/project/report data into Project Snapshot / Opportunity Overview data.

- `src/components/project-workspace/OpportunityIntelligenceWorkspace.tsx`
  - Legacy workspace/intelligence surface.

- `src/components/opportunity/OpportunityOverviewTab.tsx`
  - Renders Project Snapshot / Opportunity Overview fields.

- `src/pages/OpportunityReport.tsx`
  - Intelligence report view and fallback logic.

### 4.3 Database / tasks

- `agent_tasks`
  - Queue table for worker tasks.
  - Lacks true lease/heartbeat model; historical zombie tasks have been observed.

- `opportunity_candidates.crawl_data`
  - Stores portal metadata extracted from PlanetBids/Caltrans.

- `opportunity_bid_items`
  - Stores portal-native bid items after bid-item extraction.

- `opportunity_intelligence_reports`
  - Stores intelligence output and report-level metadata snapshots.

---

## 5. Key Architectural Lesson

The main architectural mistake was allowing deterministic portal metadata to be treated like an AI/intelligence extraction problem.

Correct architecture:

```text
PlanetBids Information Page
        ↓
Portal-specific deterministic parser
        ↓
Canonical portal metadata in crawl_data
        ↓
All downstream surfaces read those fields
        ↓
LLM enriches only document-derived insights and cited exceptions
```

Incorrect architecture observed or suspected during debugging:

```text
PlanetBids page / documents / intelligence findings / fallbacks
        ↓
Multiple partially overlapping parsers and adapters
        ↓
UI attempts to reconstruct basic portal facts
```

Portal metadata such as pre-bid status, meeting type, date/time, attendance required, meeting link, bid due date, estimate, bonds, and liquidated damages should not be inferred by LLMs when the portal already exposes them.

Exception:

- Addenda may override portal metadata if an addendum explicitly changes a meeting date/time/location/mandatory status/cancellation.
- That should be a separate explicit override layer with citations, not a generic LLM fallback.

---

## 6. What Was Fixed Successfully

### 6.1 Caltrans engineer estimate

Status: **Fixed / validated**

Problem:

- Caltrans projects sometimes missed deterministic Engineer's Estimate values.
- Project `11-431854` had a clear estimate of `$3,040,000.00`.

Fixes implemented:

- Hardened Caltrans deterministic estimate parser.
- Validated live project `11-431854`.

Validation result:

- `estimated_value = 3040000`
- `estimated_value_raw = "$3,040,000.00"`
- UI Project Snapshot displayed approximately `$3M`.

### 6.2 Caltrans bid items

Status: **Fixed / validated**

Problem:

- Bid items were not importing.
- Caltrans line items are available under a deterministic `Bid Items` dropdown/panel.

Fixes implemented:

- Worker now expands the Caltrans bid items panel.
- Extracts native bid item rows.
- Stores them in `opportunity_bid_items`.

Validation result for Caltrans `11-431854`:

- Worker logged:
  - `Expanding Caltrans Bid Items`
  - `Caltrans bid item rows discovered: 57`
  - `Bid items stored: 57 (portal_tab)`
- UI displayed all 57 rows with item numbers, descriptions, quantities, and units.

### 6.3 Portal-authoritative bid items

Status: **Mostly fixed / architecturally enforced**

Problem:

- Worker had previously stored document-derived bid items such as `document_table` rows.
- Polytechnic had fabricated/incorrect bid item data derived from documents.

Desired invariant:

For PlanetBids and Caltrans:

- Only portal-native bid items may be persisted.
- If the portal exposes zero native bid items, store zero rows.
- Do not write document-derived or AI-derived rows.

Fixes implemented:

- Removed/guarded document-derived fallback paths.
- Added architectural enforcement so non-portal bid-item rows are refused for PlanetBids/Caltrans.
- Added database-level migration to enforce portal bid-item authority.

Key commit:

- `ab63c3d5914d302b06e7c97950647874c6b4ae91` — final P0 data correctness commit with portal bid-item authority enforcement.

Later regression:

- A stale reference to `bidItemFallback` remained in `bidbox-worker/index.js` and caused:

```text
ReferenceError: bidItemFallback is not defined
```

Fix:

- Removed stale `bid_item_fallback: bidItemFallback` return field.
- Commit: `acd13f7`.

---

## 7. What Remains Unresolved

### 7.1 PlanetBids Pre-Bid / Job Walk / Meeting metadata

Status: **Not closed**

The parser has been patched multiple times, but the Polytechnic case is not conclusively fixed.

Remaining issue:

- Polytechnic High School has clear source portal metadata.
- BidBox has not been validated to correctly display all of:
  - meeting exists
  - mandatory/attendance required
  - meeting type remote
  - date/time
  - meeting link
  - location/notes

### 7.2 Root cause remains insufficiently proven for Polytechnic

A major reason the issue dragged on was that validation kept switching between:

- Santa Ana, which has `Pre-Bid Meeting: No` and no job walk section in captured text.
- Polytechnic, which is the actual failing case with real meeting details.
- TCA SR 241, which shows another valid meeting case.

The final conclusion from the Santa Ana debug payload:

```text
Working Days
Bid Bond
Bid Bond
10.00%
Payment Bond
0.00%
Performance Bond
0.00%
Pre-Bid Meeting Information
Pre-Bid Meeting
No
Online Q&A
Online Q&A
Yes
Q&A Deadline
06/23/2026 2:00 PM (PDT)
Contact Information
...
```

There is no `Job Walk` text in that excerpt. Therefore Santa Ana is not the right target for debugging a job-walk-present case.

Polytechnic is the correct target.

---

## 8. Timeline of Major Debugging Events and Commits

### 8.1 Initial P0 data correctness work

#### Commit: `8ea024be11c1aaf30b76ef96bf204e640eaf1f36`

Purpose:

- Initial P0 correctness pass.

Reported root causes:

- Caltrans bid items panel was a clickable `div.panel-heading`, not a normal button/link.
- PlanetBids bid items relied too heavily on visible DOM and did not handle API/Angular payloads.
- PlanetBids acquisition could overwrite richer portal metadata with stale in-memory `crawl_data`.
- Caltrans estimate parsing was too narrow.

Files changed:

- `bidbox-worker/drivers/planetbids_documents.js`
- `bidbox-worker/drivers/planetbids.js`
- `bidbox-worker/drivers/caltrans_documents.js`
- `bidbox-worker/drivers/caltrans.js`
- `bidbox-worker/index.js`
- `src/lib/opportunityView.ts`
- `src/components/project-workspace/OpportunityIntelligenceWorkspace.tsx`
- `CHANGELOG.md`
- `docs/initiatives/f5-opportunity-project-workspace-task-list.md`

Validation:

- Caltrans `11-431854` live validation successful.
- PlanetBids authenticated validation incomplete.

### 8.2 Portal-authoritative bid-item enforcement

#### Commit: `ffc31b29c8af93523e0e8ff9a8bda770e624c3d2`

Purpose:

- Remove fabricated/document-derived bid items.
- Stop UI from loading non-portal bid-item methods.
- Fix job walk display preference so portal metadata takes priority over intelligence findings.

Reported root causes:

- Fabricated bid items came from document-derived fallback after document processing.
- UI/dossier loaded all bid-item methods.
- Job walk display preferred intelligence findings over portal metadata.

Validation:

- Portal replacement deletes legacy non-portal methods.
- Caltrans still returns 57 native bid items.

Remaining issue:

- Authenticated Polytechnic acquisition could not be run locally.

### 8.3 Architectural portal bid-item authority

#### Commit: `ab63c3d5914d302b06e7c97950647874c6b4ae91`

Purpose:

- Add stronger guardrails for portal-authoritative bid items.
- Remove intelligence-derived fallbacks from Project Snapshot for portal facts.

Files changed:

- `bidbox-worker/drivers/bid_items.js`
- `src/lib/opportunityView.ts`
- `src/components/project-workspace/OpportunityIntelligenceWorkspace.tsx`
- `supabase/migrations/20260629190000_enforce_portal_bid_item_authority.sql`
- `CHANGELOG.md`
- `docs/initiatives/f5-opportunity-project-workspace-task-list.md`

Validation:

- Non-portal bid-item rows refused.
- Caltrans `11-431854` still correct.

### 8.4 Pre-bid metadata authority fix

#### Commit: `0da15e7`

Purpose:

- Preserve explicit `false` for `Pre-Bid Meeting: No`.
- Remove AI fallback for deterministic portal metadata.

Root bug:

```js
pre_bid_exists: preBidExists || null
```

This erased explicit `false`, because:

```js
false || null === null
```

Fix:

```js
pre_bid_exists: preBidExists ?? null
```

### 8.5 Pre-bid date/time extraction attempt

#### Commit: `186d609`

Purpose:

- Fix pre-bid date/time extraction.

Reported failures:

- `clean(textContent)` collapsed newlines.
- Regex using `[^\n]` then captured too much text.
- Container size limit could reject valid PlanetBids components.
- `querySelectorAll` missed `td` labels.
- No body-text fallback for `Date & Time`.

Fixes attempted:

- Use `innerText` instead of `textContent` for preserved newlines.
- Raise container size limit.
- Include `td` selector.
- Add body-text fallback.

### 8.6 Stale bidItemFallback reference fix

#### Commit: `acd13f7`

Problem:

```text
ReferenceError: bidItemFallback is not defined
```

Cause:

- `bidbox-worker/index.js` still returned `bid_item_fallback: bidItemFallback` after the fallback path had been removed.

Fix:

- Removed stale return field.

### 8.7 Pre-bid parser rewrite

#### Commit: `3d77bb8`

Purpose:

- Replace DOM section scan with body-text key/value parser anchored to exact `Pre-Bid Meeting Information` heading.

Reported root cause:

```js
field('Pre-Bid Meeting')
```

used a regex like:

```regex
/Pre-Bid Meeting[:\s]+([^\n]{1,300})/i
```

This matched the heading:

```text
Pre-Bid Meeting Information
```

and captured:

```text
Information
```

Then:

```js
parseBooleanSignal("Information") === null
```

and downstream fallback logic could misinterpret other non-empty strings as truthy.

Fixes attempted:

- Add `extractPreBidMeetingSection()`.
- Remove `field('Pre-Bid Meeting')` fallback.
- Treat section parser as authoritative when heading is found.

### 8.8 Job Walk parser refactor

#### Commit: `bac0a09`

Purpose:

- Apply same section key/value parser architecture to Job Walk extraction.

Reported root cause:

- `field('Job Walk')` had the same heading-label leak pattern.
- It could capture `Information` from `Job Walk Information`.

Fixes attempted:

- Added `extractJobWalkSection()`.
- Replaced global job-walk fallback parsing with section-scoped values.
- Kept job walk and pre-bid dates separate.

Validation status:

- Not conclusively validated against Polytechnic.

### 8.9 DOM/pipeline debug instrumentation

#### Commit: `c2b707b`

Purpose:

- Persist DOM inspection and pipeline debug payload to `agent_tasks.payload` instead of relying on Railway stdout.

Problem with first instrumentation:

- DOM inspection gate used URL/bid ID and fired.
- Stage 1–5 gate used title regex and did not fire.
- Result: `dom_inspection` and Stage 6 populated, Stages 1–5 null.

### 8.10 Debug gate fix

#### Commit: `10d889b`

Purpose:

- Align debug gating so all stages populate for Santa Ana bid ID `142972`.

Result:

- All debug stages populated for Santa Ana.

### 8.11 Debug gate switched to Polytechnic

#### Commit: `d7f96b4`

Purpose:

- Change debug target from Santa Ana bid ID `142972` to Polytechnic bid ID `142261`.

Issue encountered:

- Targeted `planetbids_scan` for LBUSD appeared stuck or unhelpful.
- Likely because Polytechnic is closed or because listing scan path is not the right path for closed bids.

Recommendation:

- Debug instrumentation needs to be moved into the single-candidate acquisition path (`project_analysis` → `acquirePlanetBidsDocuments`) if Polytechnic is the target.

---

## 9. Tooling / Process Problems Observed

### 9.1 Confusion between acquisition paths

Two different paths were repeatedly mixed up:

#### Source scan path

```text
planetbids_scan
  → scrapePlanetBids
  → planetbids.js
  → persistScannedCandidate
```

Useful for:

- scanning active source listings
- discovering new opportunities
- debugging active listing scraper

Not reliable for:

- closed bids
- testing a specific candidate if not visible on listing page

#### Single-candidate acquisition path

```text
project_analysis
  → runProjectAnalysisAcquisition
  → acquirePlanetBidsDocuments
  → mergeCandidatePortalMetadata
```

Useful for:

- refreshing one existing candidate
- closed bids with direct detail URL
- Project Workspace `Re-Analyze` / `Prepare Intelligence` flow

The debug instrumentation was initially added only to `planetbids.js`, which meant it only ran for `planetbids_scan`, not the single-candidate re-analysis path.

### 9.2 Lovable cannot access Railway stdout

Lovable can:

- query Supabase
- inspect code
- queue tasks
- read persisted task payloads

Lovable cannot:

- read Railway worker stdout directly from the sandbox

Therefore, any debugging data needed by Lovable must be persisted to Postgres, such as:

- `agent_tasks.payload._debug_prebid`
- `agent_tasks.result`
- a debug table

### 9.3 Claude Code lacked production credentials locally

Claude repeatedly could not:

- connect to Supabase
- access Browserbase
- run authenticated PlanetBids acquisition locally

Therefore, local claims like “this should work after re-acquisition” were not enough. Production validation was always required.

### 9.4 Too many live-system variables

The investigation simultaneously involved:

- closed vs active bids
- source scans vs single-candidate acquisitions
- worker deploy timing
- Railway worker crashes/queues
- document processing failures
- Project Intelligence regeneration
- stale vs fresh `crawl_data`
- UI adapter rendering
- parser behavior

This made it hard to isolate the real parser bug.

---

## 10. Recommended Next Approach

Do not continue live debugging through Lovable/Railway until there is a deterministic parser harness.

### 10.1 Create fixture-based parser tests

Add a folder such as:

```text
bidbox-worker/fixtures/planetbids/
```

Suggested fixtures:

```text
santa_ana_bikeway_information.txt
polytechnic_information.txt
sr241_loma_information.txt
```

Each fixture should contain the raw `document.body.innerText` or a stable HTML snapshot from the PlanetBids Information page.

### 10.2 Extract parser into a pure function

Create a parser function that accepts text/HTML and returns canonical metadata:

```ts
parsePlanetBidsInformationPage(input: string): {
  pre_bid: {
    exists: boolean | null;
    required: boolean | null;
    meeting_type: 'remote' | 'in_person' | 'hybrid' | null;
    datetime: string | null;
    location: string | null;
    meeting_link: string | null;
    notes: string | null;
  };
  job_walk: {
    exists: boolean | null;
    required: boolean | null;
    datetime: string | null;
    location: string | null;
    notes: string | null;
  };
}
```

### 10.3 Write explicit tests

#### Santa Ana expected output

Input excerpt:

```text
Pre-Bid Meeting Information
Pre-Bid Meeting
No
Online Q&A
...
```

Expected:

```json
{
  "pre_bid": {
    "exists": false,
    "required": null,
    "meeting_type": null,
    "datetime": null,
    "location": null,
    "meeting_link": null,
    "notes": null
  },
  "job_walk": {
    "exists": false,
    "required": null,
    "datetime": null,
    "location": null,
    "notes": null
  }
}
```

#### Polytechnic expected output

Expected:

```json
{
  "pre_bid": {
    "exists": true,
    "required": true,
    "meeting_type": "remote",
    "datetime": "2026-06-04T09:00:00-07:00",
    "meeting_link": "present",
    "notes": "registration required / mandatory virtual conference"
  }
}
```

Exact shape may need final adjustment based on fixture.

#### TCA SR 241 expected output

Expected:

```json
{
  "pre_bid": {
    "exists": true,
    "required": false,
    "meeting_type": "remote",
    "datetime": "2026-06-10T13:30:00-07:00",
    "meeting_link": "present",
    "notes": "optional pre-proposal Zoom meeting"
  }
}
```

### 10.4 Only after tests pass, reconnect to worker

Once fixture tests pass:

1. Wire the pure parser into `planetbids.js`.
2. Wire the same pure parser into `planetbids_documents.js`.
3. Remove duplicated parsing logic.
4. Validate one source scan and one single-candidate re-analysis.

---

## 11. Recommended Repo Bug Report Location

Create:

```text
Bug Reports/
```

Add this file as:

```text
Bug Reports/2026-06-29-planetbids-prebid-jobwalk-metadata.md
```

This report should be committed so the investigation is preserved and can be resumed later without reconstructing the entire chain from chat history.

---

## 12. Recommended Claude Code Prompt To Park This Properly

```text
Create a new folder in the repo root called `Bug Reports` if it does not already exist.

Add a markdown file:

`Bug Reports/2026-06-29-planetbids-prebid-jobwalk-metadata.md`

Populate it with the full bug report provided by the user. Do not summarize it. Preserve all sections, commit references, root causes, attempted fixes, unresolved issues, and recommended next approach.

After creating the file:

1. Run `git diff --check`.
2. Commit the file with message:
   `Document PlanetBids pre-bid job walk metadata bug report`
3. Push to `phase1-opportunity-intelligence`.

Do not modify application code.
Do not modify worker code.
Do not attempt to fix the parser in this task.
This is documentation-only.
```

---

## 13. Immediate Product Work To Resume After Parking This

After parking this bug, move on to work that produces clear progress and does not depend on the failing PlanetBids metadata parser:

1. Populate portal-native bid items for every non-closed project.
2. Simplify Documents tabs and add download buttons.
3. Fix Opportunity `All` count to reflect visible filtered projects only.
4. Replace `Analyzed` tab with `Saved` workflow.
5. Add System Health / Admin Operations dashboard.

---

## 14. Prompt To Populate Bid Items For All Non-Closed Projects

```text
Run a controlled production backfill to populate portal-native bid items for all non-closed opportunities/projects.

Scope:
- Include PlanetBids and Caltrans only.
- Exclude closed / past-due opportunities where bid due date is in the past, unless they are already in active user projects and explicitly need repair.
- Do not run document-derived bid item extraction.
- Do not use AI for bid items.
- Only persist native portal bid items with `extraction_method = 'portal_tab'` or equivalent portal-native method.
- If a portal exposes zero native bid items, ensure existing non-portal/fabricated rows are removed and zero rows remain.

Before running:
1. Count eligible candidates by portal and status.
2. Report the count.
3. Confirm the worker path that will be used:
   - Caltrans: deterministic Bid Items dropdown/panel extraction.
   - PlanetBids: native Line Items / Bid Items tab/API payload extraction.
4. Confirm that non-portal methods are blocked by the current database/worker guardrails.

Execution:
1. Queue controlled `project_analysis` tasks or a dedicated bid-item backfill task for eligible non-closed candidates.
2. Rate-limit the run so it does not overwhelm Browserbase, Railway, OpenAI, or Supabase.
3. Do not regenerate full Project Intelligence unless required by the existing task path. Prefer metadata/bid-item acquisition only if available.
4. Track progress in `agent_tasks`.

Validation:
After completion, return:
- Total eligible candidates.
- Total attempted.
- Total succeeded.
- Total failed.
- Total with native bid items found.
- Total with zero native bid items.
- Total rows inserted into `opportunity_bid_items`.
- Any failures grouped by portal/source/error.

Spot-check:
- Caltrans `11-431854` still has exactly 57 native bid items.
- At least one PlanetBids project with a native Line Items tab stores only portal-native rows.
- Polytechnic does not show fabricated/document-derived bid items.

Do not modify parser logic in this task.
Do not work on pre-bid/job-walk metadata in this task.
This task is bid-items backfill only.
```

---

## 15. Final Status

This issue should be considered **parked**, not resolved.

Resolved:

- Caltrans estimate parser.
- Caltrans bid item extraction for `11-431854`.
- Portal-authoritative bid-item guardrails.
- Stale `bidItemFallback` crash.
- Santa Ana `Pre-Bid Meeting: No` case appears to be handled correctly in `crawl_data`.

Unresolved:

- Polytechnic pre-bid/job walk metadata extraction and display.
- Reliable parser architecture for PlanetBids meeting sections.
- Unified parser used by both `planetbids.js` and `planetbids_documents.js`.
- Offline parser fixtures/tests.
- Removal of temporary debug instrumentation after final resolution.

Recommended next action:

- Do not resume live debugging until raw Polytechnic fixture data is captured and a fixture-based parser test exists.
