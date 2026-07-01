# LA County DPW Driver Implementation

Status: Milestone 1 Planned — Not Started
Document type: Engineering task list
Source design spec: `docs/initiatives/lacounty-dpw-driver-design-spec.md`
Reconnaissance report: `docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md`
Roadmap placement: `docs/agent-architecture-task-list.md` §6.4 (E3 — New Driver Per Portal Type)
Portal type key: `lacounty_dpw` · Branch: `phase1-opportunity-intelligence`

## Milestones

Milestone 1 (this list, Tasks 1–16) delivers metadata ingestion only:

```
Listing → Detail metadata → opportunity_candidates → Portal Intelligence → Visible inside BidBox
```

No document acquisition. No authentication. No Playwright. No Browserbase. Metadata only, HTTP-first.

Milestone 2 (Task 17 is investigation only) is authenticated document acquisition, kept as a completely separate implementation milestone. Task 17 is a spike that produces findings — it does not build the document driver.

---

## Task 1 - SCHEMA & CONFIGURATION VERIFICATION
Subtasks:
### 1.1. Verify `opportunity_sources` columns
- Confirm against the live schema: `portal_type`, `listing_url`, `scan_enabled`, `scan_interval_hours`, `refresh_enabled`, `refresh_cadence_hours`, and the `last_refresh_*` / `last_scanned_at` fields the scan-runner writes. These names come from the recon report and are not yet verified against the database.

### 1.2. Verify `opportunity_candidates` OML columns
- Confirm every column written by `portalOwnedCandidateFields()` exists: `estimated_value`, `estimated_value_low`, `estimated_value_high`, `county`, `project_address`, `required_licenses`, `required_naics`, `portal_bid_id`, `portal_department`, `crawl_data`.

### 1.3. Confirm no migration is required for Milestone 1
- If a column is missing, raise it before Task 2 rather than mid-build. Milestone 1 is expected to need zero schema changes.

## Task 2 - PORTAL TYPE REGISTRATION
Subtasks:
### 2.1. Register `lacounty_dpw` in platform detection
- Add to the `PortalType` union, `PORTAL_PATTERNS` (`/dpw\.lacounty\.gov/i`), and `getPortalDisplayName` in `src/lib/platformDetection.ts`; mirror the pattern in `supabase/functions/crawl-project/index.ts`.

### 2.2. Establish the canonical agency label
- Use "Los Angeles County Department of Public Works" as `source.name` / `agency`, and "LA County DPW" as the short display name.

## Task 3 - EDGE FUNCTION UPDATES
Subtasks:
### 3.1. `refresh-opportunities`
- Extend the `TaskType` union and `resolveTaskType()` (`lacounty_dpw → lacounty_dpw_scan`); add `lacounty_dpw_scan` to the active-task `.in("task_type", [...])` guard so an in-flight scan is not double-queued.

### 3.2. `scan-opportunities`
- Extend the taskType union and add a `lacounty_dpw` partition in the per-portal queueing block, alongside `planetbids` and `caltrans`.

## Task 4 - WORKER INTEGRATION
Subtasks:
### 4.1. Claim and dispatch the scan task
- Add `lacounty_dpw_scan` to the worker claim query `.in('task_type', [...])` and to the `processTask()` switch, routing to `runLaCountyDpwScan(task, supabase)`.

### 4.2. Include DPW in scan post-processing arrays
- Add `lacounty_dpw_scan` to the three `['planetbids_scan','caltrans_scan']` arrays so the scan gets the scan-shaped `taskResult`, triggers `maybeQualifyCandidates()`, and writes `opportunity_sources.last_refresh_*` on failure.

### 4.3. Add a graceful `document_prefetch` no-op for `lacounty_dpw`
- `persistScannedCandidate()` auto-queues a `document_prefetch` task for every new candidate, and `runDocumentPrefetchTask()` throws for unknown portal types. Add a `lacounty_dpw` branch that returns `{ found: 0, acquired: 0, skipped: 0, failed: 0 }` so Milestone 1 does not generate failing prefetch tasks. Milestone 2 replaces this stub with the real driver.

## Task 5 - LA COUNTY DPW SCAN DRIVER
Subtasks:
### 5.1. Scaffold `bidbox-worker/drivers/lacounty_dpw.js`
- Export `scrapeLaCountyDpw(source, log)` returning `{ candidates, errors, errorMessages }`. HTTP-first — no Playwright, no Browserbase — using a realistic desktop User-Agent (Milestone 1 constraint).

### 5.2. Add the `runLaCountyDpwScan()` runner in `index.js`
- Mirror `runCaltransScan`: create the `agent_run_logs` row, set `opportunity_sources` status (`running → partial|failed|complete`), loop candidates through `persistScannedCandidate`, and return `{ found, new, refreshed, unchanged, errors, errorSummary, logs }`.

### 5.3. Driver-level failure isolation and idempotency
- Per-detail-page parse failures are non-fatal (record and continue); a listing-level failure returns `candidates: []` with `errors > 0`; re-scans are idempotent on `source_url`.

Reuse note: `runLaCountyDpwScan` is a candidate for a shared "agency-direct scan runner" once a second agency-direct driver exists (see Reusable Infrastructure appendix).

## Task 6 - LISTING PARSER
Subtasks:
### 6.1. Fetch and parse the listing
- GET `https://dpw.lacounty.gov/contracts/Opportunities.aspx` and parse all `<tbody>` rows. DataTables paginates client-side, so every row is present in the initial HTML — do not attempt network pagination.

### 6.2. Extract row fields and follow the href
- Capture `{ detail_href, name, project_id, open_date, close_date, description }` per row. Always follow the row's authoritative href; never reconstruct a detail URL from the ID prefix. Treat `project_id` as an opaque string (it may contain hyphens, e.g. `RFB-IS-26201059`).

Reuse note: the HTTP fetch (UA, timeout, retry/backoff, Imperva-challenge detection) and the "server-rendered table → rows" parse are the first reusable Agency Direct utilities.

## Task 7 - DETAIL TEMPLATE REGISTRY
Subtasks:
### 7.1. Build a path-matched extractor registry
- Register extractors for `aed_bid`, `cons`, `asd_rfp`, `rfb`, and `aed_rfp`, each keyed on its detail path segment. Each extractor returns template-native fields plus `documents[]` metadata (title, notes, pages, size) and plan-holder URLs — without downloading anything.

### 7.2. Confirm the unverified templates
- The `rfb` and `aed_rfp` field sets are not yet confirmed (rfb returned 200 but was not rendered; aed_rfp is inferred). Confirm both against live pages while building their extractors.

### 7.3. Generic fallback extractor
- If a detail href matches no registered template, emit a candidate from listing-level fields plus a full label→value capture into `crawl_data`, set `crawl_data.template_unrecognized = true`, and record a non-fatal warning. A new DPW division must surface as a candidate rather than crash the scan.

Reuse note: the template-registry abstraction (path matcher + extractor + fallback) is the core reusable Agency Direct pattern.

## Task 8 - METADATA NORMALIZATION
Subtasks:
### 8.1. Map template-native fields to the OML contract
- One normalizer maps each template's labels onto the shared candidate contract. The "bid due" concept resolves from whichever of `Closing Date` / `Bid Opening Date` / `Proposal Due Date` the template provides.

### 8.2. Tolerant, lossless parsing
- Parse money defensively (strip `$`/commas). Parse dates across `M/D/YYYY` and `MM/DD/YYYY HH:MM AM/PM`, and handle non-date sentinels ("Open Continuously", "N/A") by setting `bid_due_at = null` while preserving the raw value in `crawl_data`. Set `county` to the constant "Los Angeles". Never throw on a malformed value.

Reuse note: money/date/sentinel parsers and the label→OML mapper are shared normalization helpers usable by every agency-direct driver.

## Task 9 - CANDIDATE PERSISTENCE
Subtasks:
### 9.1. Persist through the existing pipeline
- The driver returns candidates only; the runner calls `persistScannedCandidate({ ..., portal_type: 'lacounty_dpw' })` per candidate. Do not write `opportunity_candidates` directly and do not queue follow-on tasks from the driver.

### 9.2. Confirm auto-queued follow-ons
- Confirm that a new candidate auto-queues `portal_intelligence` (priority 3) and `document_prefetch` (priority 2, handled by the Task 4.3 no-op in Milestone 1), and that refreshes mark `new` / `refreshed` / `unchanged` without re-triggering F2/F3/F4.

## Task 10 - SOURCE CONFIGURATION
Subtasks:
### 10.1. Insert the `opportunity_sources` row
- `name = "Los Angeles County Department of Public Works"`, `portal_type = 'lacounty_dpw'`, `listing_url = 'https://dpw.lacounty.gov/contracts/Opportunities.aspx'`, `scan_enabled = true`, `scan_interval_hours = 24`, `refresh_enabled = true`, `refresh_cadence_hours = 24`. No credentials are stored on this row.

### 10.2. Stage before scheduling
- Insert in a non-scheduled state (or disabled) so validation runs on demand before the nightly scheduler picks it up.

## Task 11 - VALIDATION
Subtasks:
### 11.1. Run one targeted manual scan
- Queue a single `lacounty_dpw_scan` and confirm one candidate is created per advertised opportunity across all templates currently present.

### 11.2. Field-level correctness
- Spot-check `raw_title`, `bid_due_at` (including a null for an "Open Continuously" RFP), `estimated_value`, `portal_bid_id`, `county`, and a populated `crawl_data.documents[]`.

### 11.3. Idempotency and failure behavior
- Re-run and confirm rows report `unchanged`. Confirm a simulated structural change (zero rows parsed from a 200 response) reports `failed`, not a silent "0 opportunities". Confirm the stubbed `document_prefetch` tasks complete cleanly.

## Task 12 - PORTAL INTELLIGENCE VALIDATION
Subtasks:
### 12.1. Confirm summaries generate
- Verify `portal_intelligence` runs on DPW candidates and produces a coherent summary from `crawl_data` and OML columns with no DPW-specific code changes.

### 12.2. Cross-template sanity
- Check summaries for at least one `aed_bid`, one `cons`, and one `asd_rfp` candidate.

## Task 13 - UI VALIDATION
Subtasks:
### 13.1. Candidate visibility
- Confirm DPW candidates render in the BidBox opportunities UI with correct agency label, title, due date, and estimate.

### 13.2. Navigation and detail
- Verify the portal summary displays and the source link resolves to the correct `dpw.lacounty.gov` detail page.

## Task 14 - PRODUCTION READINESS
Subtasks:
### 14.1. Scheduling and cadence
- Enable the source in the nightly `refresh-opportunities` cadence and confirm it queues and completes on schedule without manual intervention.

### 14.2. WAF politeness and resilience
- Use bounded concurrency plus an inter-request delay; watch for Imperva/Incapsula challenge markers. The Browserbase fallback remains design-only in Milestone 1.

### 14.3. Observability and ledger
- Confirm `agent_run_logs`, `last_refresh_error`, and the `template_unrecognized` signal surface failures. Mark the source scan-verified in `docs/opportunity-source-ledger.md` only after production logs prove success.

## Task 15 - DOCUMENTATION UPDATES
Subtasks:
### 15.1. Record completed engineering state
- After the build lands, update this task list with status and note any deviations from the design spec. Documentation describes completed work; it must not block implementation.

### 15.2. Update the source ledger
- Add the LA County DPW entry to `docs/opportunity-source-ledger.md` and update its state as configuration and scan verification complete.

## Task 16 - COMMIT / PUSH
Subtasks:
### 16.1. Branch discipline
- All work stays on `phase1-opportunity-intelligence`; never commit to `main`.

### 16.2. Logical commits
- Group into: (a) detection + edge functions + worker routing, (b) scan driver + listing parser + template registry + normalizer, (c) source config + docs/ledger updates. Push only when explicitly approved.

## Task 17 - DOCUMENT ACQUISITION SPIKE (MILESTONE 2 — INVESTIGATION ONLY)
Subtasks:
### 17.1. SSO / registration investigation
- Manually verify the LA County SSO login flow, whether vendor registration is required or free, account-wide vs. per-project scope, and the login page selectors. No automation is built.

### 17.2. Document-flow feasibility
- Confirm the two-step trigger, the ~1–2 minute server-side preparation, and the dual PDF delivery mode (download event vs. inline navigation). Assess whether the per-document trigger URL is stable enough to serve as the `opportunity_documents` idempotency key.

### 17.3. Evaluate Bid Express as an alternate source
- Determine whether Bid Express hosts the plan set with less friction than the DPW SSO flow.

### 17.4. Output
- Write findings back into the design spec §6/§7 and open Milestone 2 as its own task list. Do not implement the document driver in this milestone.

---

## Appendix — Agency Direct Reusable Infrastructure (Future Extraction)

These are identified now so subsequent agency-direct drivers (LACMTA, LADWP) do not duplicate code. Do not implement them during Milestone 1; build DPW-specific code first, then extract once a second driver proves the shared shape.

- Shared HTTP fetch utility — realistic User-Agent, timeout, bounded retry/backoff, and Imperva/Incapsula challenge detection. Natural home for the swappable Browserbase fallback transport. Emerges from Task 6.1.
- Shared HTML parsing helpers — server-rendered table → row objects, and label→value extraction from flat detail pages. Emerges from Tasks 6 and 7.
- Template registry abstraction — path matcher + extractor + safe generic fallback. The reusable heart of the pattern. Emerges from Task 7.
- Metadata normalization helpers — money parser, multi-format/sentinel-tolerant date parser, and the template-native → OML mapper. Emerges from Task 8.
- Retry/backoff utility — shared by both the fetch layer and future document flows. Emerges from Task 5.3 / Task 6.1.
- Common agency-direct scan runner — the `runLaCountyDpwScan` bookkeeping (run logs, source status, persist loop, tallies) generalized. Emerges from Task 5.2.
