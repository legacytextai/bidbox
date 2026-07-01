# Driver Design Specification — LA County DPW (Agency Direct Driver v1)

**Status:** Design / RFC. No production code written.
**Author:** Engineering
**Date:** 2026-07-01
**Branch:** `phase1-opportunity-intelligence`
**Reconnaissance source of truth:** [`docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md`](../handoff/2026-07-01-lacounty-dpw-agency-expansion.md) — Section 0 (Verified Findings). This spec assumes reconnaissance is complete and does not re-open it.

> This document is the engineering blueprint for implementing the LA County Department of Public Works acquisition driver. It is written so a second engineer can implement without revisiting the portal. All portal facts referenced here are the *verified* findings from the recon report; all BidBox integration points below were read directly out of the current codebase (`bidbox-worker/index.js`, `supabase/functions/refresh-opportunities`, `supabase/functions/scan-opportunities`, `bidbox-worker/drivers/caltrans*.js`, `src/lib/platformDetection.ts`) at commit `8b39158`.

---

## 1. Executive Summary

### 1.1 Purpose

Introduce **LA County Department of Public Works (DPW)** as the third portal type in BidBox, and in doing so establish the reusable **Agency Direct Driver** pattern for custom, non-SaaS agency portals. DPW is the first agency-direct target; LACMTA, LADWP, and similar custom portals will follow the same skeleton.

The portal type key is **`lacounty_dpw`**.

### 1.2 Goals

1. **Metadata ingestion (Milestone 1).** Discover all currently-advertised DPW opportunities from the native listing, extract per-project metadata via HTTP-only requests, and persist them as `opportunity_candidates` that flow through the existing pipeline (portal intelligence, qualification, refresh).
2. **Document acquisition (Milestone 2).** Acquire the gated bid documents for a candidate by automating — in a real authenticated browser — the exact human workflow (SSO login → trigger document → wait for server-side preparation → capture the PDF → upload to Supabase Storage).
3. **Zero coupling between the two.** Metadata ingestion never depends on, waits for, or is blocked by document acquisition. Documents being unavailable (auth expired, WAF challenge, portal slow) must degrade gracefully to "metadata-only" candidates.
4. **Establish the Agency Direct pattern.** The scan driver's internal structure (listing parse → follow href → template-dispatched extractor → normalized candidate) becomes the template other agency-direct drivers copy.

### 1.3 Non-Goals

- **Not** using RAMPLA as an acquisition source. RAMPLA is a Salesforce Experience Cloud SPA and is explicitly ruled out (recon 0.1). The driver targets `dpw.lacounty.gov` directly.
- **Not** reverse-engineering document download endpoints, ViewState internals, or building a synthetic POST-based download. Documents are acquired by driving the same browser flow a human uses (recon "Important Observation").
- **Not** scraping `AWARDED` / `PENDING AWARD` (bid results / historical) in v1. The default listing GET returns the currently-advertised set, which is the whole v1 scope. Bid results are a documented future extension.
- **Not** portal-native bid-item extraction. DPW exposes no bid-item table; bid items (if ever needed) come from the bid schedule PDF via the existing document-processing pipeline (F3), not this driver.
- **Not** changing `portal_intelligence.js` or `project_intelligence.js`. They are portal-agnostic and consume `crawl_data` + OML columns + acquired documents; they require no DPW-specific code.

---

## 2. Existing Architecture Integration

The driver plugs into the current pipeline at exactly the same seams Caltrans uses. Nothing about the pipeline shape changes; DPW is added as new branches alongside `planetbids` and `caltrans`.

### 2.1 End-to-end flow

```
opportunity_sources (1 new row, portal_type='lacounty_dpw')
  │
  ▼
refresh-opportunities  OR  scan-opportunities   (Supabase edge functions)
  │   resolveTaskType('lacounty_dpw') → 'lacounty_dpw_scan'
  │   inserts agent_tasks row (task_type='lacounty_dpw_scan', payload={source_id,source_name,listing_url,portal_type,...})
  ▼
Railway Worker  (bidbox-worker/index.js, polling agent_tasks)
  │   claim query .in('task_type',[...]) must include 'lacounty_dpw_scan'
  │   processTask() switch dispatches to runLaCountyDpwScan(task, supabase)
  ▼
Scan Driver  (bidbox-worker/drivers/lacounty_dpw.js)
  │   scrapeLaCountyDpw(source, log) → { candidates, errors, errorMessages }
  ▼
persistScannedCandidate()  (existing, in index.js)  ← one call per candidate
  │   • upsert opportunity_candidates keyed on source_url
  │   • on NEW insert, auto-queues:
  │       - portal_intelligence  (priority 3)
  │       - document_prefetch    (priority 2)
  ▼
portal_intelligence task → portal_intelligence.js  (no DPW code needed; reads crawl_data/OML)
document_prefetch task   → runDocumentPrefetchTask() routes by candidate.portal_type
                            → 'lacounty_dpw' branch → acquireLaCountyDpwDocuments()
                            → Document Driver (bidbox-worker/drivers/lacounty_dpw_documents.js)
                            → Supabase Storage 'opportunity-documents' + opportunity_documents rows
  ▼
(user-triggered, unchanged) project_analysis → document_processing → project_intelligence
```

### 2.2 Concrete integration points (files, functions, lines at `8b39158`)

**A. Edge functions — enqueue.**
- `supabase/functions/refresh-opportunities/index.ts`
  - `type TaskType` (line ~9): add `"lacounty_dpw_scan"`.
  - `resolveTaskType()` (line ~128): add `if (portalType === "lacounty_dpw") return "lacounty_dpw_scan";`.
  - Active-task guard `.in("task_type", ["planetbids_scan","caltrans_scan"])` (line ~224): add `"lacounty_dpw_scan"` so an in-flight DPW scan isn't double-queued.
- `supabase/functions/scan-opportunities/index.ts`
  - `queueWorkerScanSources` taskType union (line ~52) and the per-portal filtering block (lines ~395–406, currently `planetbids` / `caltrans` / `otherSources`): add a `lacounty_dpw` partition that queues `lacounty_dpw_scan`.

**B. Worker — claim & dispatch.** `bidbox-worker/index.js`
  - Claim query `.in('task_type', [...])` (line ~1027): add `'lacounty_dpw_scan'`.
  - `processTask()` switch (line ~1100): add `else if (task.task_type === 'lacounty_dpw_scan') { result = await runLaCountyDpwScan(task, supabase); }`.
  - Scan-result shaping & post-processing arrays that currently read `['planetbids_scan','caltrans_scan']` (lines ~1120, ~1228, ~1251): add `'lacounty_dpw_scan'` so the DPW scan (i) gets the scan-shaped `taskResult`, (ii) triggers `maybeQualifyCandidates()`, and (iii) writes `opportunity_sources.last_refresh_*` on failure.
  - `runDocumentPrefetchTask()` portal dispatch (line ~1079): add `else if (candidate.portal_type === 'lacounty_dpw') { result = await acquireLaCountyDpwDocuments({ supabase, task, candidate, log }); }`.

**C. New worker files.**
  - `bidbox-worker/drivers/lacounty_dpw.js` — scan driver (Milestone 1).
  - `bidbox-worker/drivers/lacounty_dpw_documents.js` — document driver (Milestone 2).
  - `runLaCountyDpwScan()` — a thin scan-runner in `index.js` mirroring `runCaltransScan()` (agent_run_logs bookkeeping, source status updates, per-candidate `persistScannedCandidate` loop, tallies).

**D. Frontend / detection.** `src/lib/platformDetection.ts` and `supabase/functions/crawl-project/index.ts`
  - Add `'lacounty_dpw'` to the `PortalType` union, `PORTAL_PATTERNS` (`/dpw\.lacounty\.gov/i`), and `getPortalDisplayName` ("LA County DPW"). Note a `ramp` pattern already exists for `rampla.org`; leave it — it is unused by this driver.

### 2.3 Database interactions

- **`opportunity_sources`** — one new row (see §7.4 for columns). Read by the edge functions; `last_refresh_*`/`last_scanned_at` written by the scan-runner exactly as Caltrans does.
- **`opportunity_candidates`** — written exclusively through `persistScannedCandidate()`. The driver must **not** write this table directly. Idempotency key is `source_url` (the canonical detail-page URL). See §3.7 and §5.
- **`agent_tasks`** — scan task consumed; `portal_intelligence` + `document_prefetch` follow-on tasks auto-queued by `persistScannedCandidate()` on first insert.
- **`agent_run_logs`** — scan-runner creates a `running` row and updates it to `complete`/`complete_with_errors`, mirroring `runPlanetBidsScan`/`runCaltransScan`.
- **`opportunity_documents`** — written by the document driver (Milestone 2). Idempotency key `(opportunity_candidate_id, source_url)`; existing rows with `acquisition_status='acquired'` and a `storage_path` are skipped (same guard Caltrans uses).

### 2.4 Storage interactions

- Bucket **`opportunity-documents`** (constant `DOCUMENT_BUCKET` in the doc drivers). The DPW document driver uploads acquired PDFs here and records `storage_path` on the `opportunity_documents` row. Storage path convention should match the existing drivers (candidate-scoped prefix); confirm the exact key format against `caltrans_documents.js` at implementation time and reuse it.

---

## 3. Scan Driver Design (`lacounty_dpw.js`)

The scan driver is **HTTP-first and unauthenticated** (recon 0.2/0.4/0.6). This is a deliberate departure from `caltrans.js`, which launches Playwright even for its listing — DPW's listing and detail pages are fully server-rendered, so a plain HTTP client (Node `undici`/`fetch`, or `got`) plus an HTML parser (`cheerio`) is sufficient and far cheaper. Playwright/Browserbase is reserved for the document driver and for the WAF-fallback path (§8.7).

### 3.1 Driver contract (must match existing scan drivers)

Exported entry point `scrapeLaCountyDpw(source, log)` returns `{ candidates, errors, errorMessages }`, where:
- `source` = `{ source_id, source_name, listing_url, portal_type }` (from the task payload).
- `candidates` = array of candidate objects shaped for `persistScannedCandidate` (see §5 for the field contract).
- `errors` = integer count; `errorMessages` = string[] (deduped and truncated to 5 by the runner).

The scan-runner `runLaCountyDpwScan()` wraps this exactly like `runCaltransScan`: it records `agent_run_logs`, sets `opportunity_sources.last_refresh_status` to `running` → `partial|failed|complete`, loops candidates through `persistScannedCandidate`, and returns `{ found, new, refreshed, unchanged, errors, errorSummary, logs }`.

### 3.2 Discovery flow

1. GET the listing URL from `source.listing_url` (canonical default: `https://dpw.lacounty.gov/contracts/Opportunities.aspx`). Send a realistic desktop `User-Agent` and standard `Accept` headers (recon 0.6 — a realistic UA is what passed Imperva cleanly).
2. Parse the server-rendered rows out of the HTML table. The default GET returns the currently-advertised set (recon 0.2) — no filter postback required for v1.
3. For each row, capture `{ detail_href (absolute), listing_name, project_id, open_date, close_date, description_snippet }`. The row **carries the exact detail href** — the driver follows it and **never reconstructs a detail URL from the `project_id` prefix** (recon 0.3, hard rule).
4. Resolve each `detail_href` to an absolute URL against the listing origin and classify its **template** by path segment (§4).
5. For each detail URL: GET the page, run the template-specific extractor, merge listing-level fields, and emit a normalized candidate.
6. De-duplicate on the absolute detail URL within the run (a `Set`, same as `caltrans.js`).

### 3.3 Listing parsing

- The listing is a `<table>` enhanced by client-side DataTables. All rows are present in the initial HTML (recon 0.2) — parse the `<tbody>` rows directly; do **not** attempt to reproduce DataTables' client-side paging.
- Extract per row: the anchor `href` (detail link), the visible name/ID string (e.g. `BRC0000681 - Magic Johnson Park…`), the open date, the close date, and any inline description snippet.
- `project_id` is parsed from the detail href query string (`?project_id=…`), **not** from the display text, and is treated as an **opaque string** (may contain hyphens, e.g. `RFB-IS-26201059`; recon 0.4). No `^[A-Z]{3}\d+$` assumptions.

### 3.4 Pagination

- **None at the network layer.** DataTables paginates client-side over already-delivered rows. One GET = the full current listing. The driver reads every `<tbody>` row.
- **Filter dropdowns are WebForms postbacks** (`main_ddlProjectType`, `main_ddlPhase`; recon 0.2). v1 does not use them — the default view is the target set. If a future milestone needs `AWARDED`/`Closed`, that is a ViewState POST (see §10.4 and §11), explicitly out of scope now.

### 3.5 Detail extraction

- GET each detail URL; parse server-rendered HTML (no JS). Pages are flat (no tabs/accordions; recon 0.4).
- Dispatch to the template extractor selected in §4. Each extractor returns a raw label→value map plus the template's canonical field names, which the normalizer (§5) maps to OML columns.
- **Document metadata is captured here even though files are gated** (recon 0.5): the extractor records each document's `{ title, notes, page_count, file_size, register_href }` into `crawl_data.documents[]`. This powers portal intelligence and gives the document driver its worklist — without downloading anything.
- Capture the public **plan-holder list URLs** (`PlanHolders.aspx?plan_type=…`) into `crawl_data` for optional future competitive-intel use; do not fetch them in v1.

### 3.6 Metadata normalization

- Each template extractor produces template-native fields; a single **normalizer** maps them to the shared OML candidate contract (§5). The normalizer owns tolerant parsing:
  - **Money:** reuse the `parseMoney` approach from `caltrans.js` (strip `$`/commas → Number, else null).
  - **Dates:** must handle `M/D/YYYY`, `MM/DD/YYYY HH:MM AM/PM`, and **non-date sentinels** `"Open Continuously"` / `"N/A"` (recon 0.4). Non-date due values → `bid_due_at = null`, with the raw string preserved in `crawl_data`. Follow the Caltrans precedent of storing a neutral, sortable timestamp only when a real date exists, and always preserving the raw value.
- Raw, unmapped fields always land in `crawl_data` (the JSONB overflow blob) so nothing observed is lost even before it has a typed column.

### 3.7 Candidate persistence

- The driver returns candidates; `runLaCountyDpwScan` calls `persistScannedCandidate({ supabase, source_id, source_name, portal_type:'lacounty_dpw', candidate, triggerReason, sourceTaskId, log })` per candidate.
- `persistScannedCandidate` (existing) upserts on `source_url`, and **on first insert** auto-queues `portal_intelligence` (priority 3) and `document_prefetch` (priority 2). The driver need not (and must not) queue those itself.

### 3.8 Refresh strategy

- Re-running the scan is the refresh mechanism. `persistScannedCandidate` computes `changedPortalMetadata(existing, next)` and marks each candidate `new` / `refreshed` / `unchanged`; scan-time refreshes deliberately do **not** re-trigger F2/F3/F4 (matches current OML behavior).
- Cadence is driven by `opportunity_sources.scan_interval_hours` / `refresh_cadence_hours` via the nightly `refresh-opportunities` scheduler. Start at **24h** (recon-appropriate; DPW posts on a daily-ish cadence) and tune after observing real posting frequency.

### 3.9 Failure handling, retries, idempotency

- **Per-candidate isolation:** a single detail-page parse failure records an error message and continues (mirrors the Caltrans card loop). One bad detail page never fails the whole scan.
- **Listing-level failure:** if the listing GET fails or returns unparseable HTML, the driver returns `candidates: []` with `errors > 0`; the runner sets the source status to `failed` and writes `last_refresh_error`. No candidates are mutated.
- **Idempotency:** guaranteed by `source_url` upsert in `persistScannedCandidate`. Re-scanning is always safe; a candidate seen again updates in place.
- **Retries:** transient HTTP failures (5xx, timeouts) on the listing or a detail page get a small bounded retry with backoff inside the driver. Task-level retry is the platform's existing behavior (task stays claimable/reset on failure); do not build a second retry loop on top.
- **Partial success semantics:** `errors > 0` with `≥1` persisted candidate → source status `partial` (existing runner logic). This keeps a mostly-good scan from being reported as a hard failure.

---

## 4. Template Architecture

DPW routes each opportunity to one of several detail templates with **different field vocabularies** (recon 0.3/0.4). A giant `if/else` over template names would rot as templates are added. Use a **registry of template extractors**.

### 4.1 Registry model

- A **template registry**: an ordered map from a **path matcher** (the detail URL's `/contracts/<segment>/<Page>.aspx` shape) to a **template extractor**.
- Each **template extractor** is a small, self-contained unit exposing:
  - `templateId` — stable string, e.g. `aed_bid`, `cons`, `asd_rfp`, `rfb`, `aed_rfp`.
  - `matches(detailUrl)` — predicate on the path segment / page name.
  - `extract(html, context)` — returns `{ nativeFields, documents, planHolders, rawLabels }` where `nativeFields` uses the template's own label names.
- The scan driver: for each detail href, find the first registry entry whose `matches` is true, call its `extract`, then hand `nativeFields` to the shared **normalizer** (§5) which maps to the OML contract.

### 4.2 Confirmed templates (recon 0.3)

| `templateId` | Detail path | Page | Notes |
|---|---|---|---|
| `aed_bid` | `/contracts/aed_bid/ProjectDetail.aspx` | ProjectDetail | Building sealed bids. Has `Spec No`, `Proposers Conference(s)`, `Bid Package From Cashier`. |
| `cons` | `/contracts/cons/ProjectDetailAdv.aspx` | ProjectDetailAdv | Infrastructure/construction. Richest template: `Federal No`, `Project Limit`, `Bid Opening Date`, `Cities/Communities`, dedicated `Addenda` section, doc table with Notes/Pages/Size. |
| `asd_rfp` | `/contracts/asd_rfp/ProjectDetail.aspx` | ProjectDetail | Sundry-services RFP/RFSQ. `RFP Issue Date`, `Proposal Due Date` (may be "Open Continuously"), addenda inline in docs. |
| `rfb` | `/contracts/rfb/ProjectDetail.aspx` | ProjectDetail | Purchasing/RFB. Fetched live (200) but field set not yet rendered — confirm during Milestone 1 build. |
| `aed_rfp` | `/contracts/aed_rfp/ProjectDetail.aspx` | ProjectDetail | **Inferred** by symmetry with the AEDRFP type; not observed live. Confirm during Milestone 1. |

### 4.3 Unknown-template safety

- If a detail href matches **no** registered template (a new `/contracts/<segment>/…` appears), the driver must **not** crash the run. It should: (a) emit a candidate using a **generic/minimal extractor** that captures listing-level fields (name, project_id, open/close dates, detail URL) plus the whole page's label→value pairs into `crawl_data.rawLabels`; (b) record a non-fatal error/warning naming the unrecognized path; (c) set a `crawl_data.template_unrecognized = true` flag. This guarantees new DPW divisions still surface as candidates and generates a clear signal to add an extractor.

### 4.4 Why this scales

- Adding a template = adding one registry entry; no edits to the scan loop, normalizer contract, or worker plumbing.
- The same registry pattern is what the **Agency Direct framework** (§10) generalizes: a driver = { listing parser, template registry, normalizer }.

---

## 5. Metadata Mapping

### 5.1 Target contract (what `persistScannedCandidate` consumes)

`portalOwnedCandidateFields()` maps a candidate onto these normalized columns (verbatim from `index.js`):

| OML column | Source in candidate |
|---|---|
| `source_url` | canonical absolute detail URL (idempotency key) |
| `raw_title` | `"<project_id> - <project name>"` |
| `agency` | `source_name` (set by runner — "LA County Department of Public Works") |
| `bid_due_at` | normalized close/bid-open/proposal-due timestamp, or `null` |
| `estimated_value` | engineer's estimate / contract estimate ($) or `null` |
| `estimated_value_low` / `_high` | `null` (DPW gives point estimates, not ranges) |
| `county` | constant `"Los Angeles"` (all DPW work is LA County) |
| `project_address` | project location / limit / cities-communities text if present |
| `required_licenses` | `text[]` column — supply a string array of license/classification codes if present, else `null`. Never a bare string. (M1: `null`, matching Caltrans.) |
| `required_naics` | `text[]` column — `null` (not exposed by DPW) |
| `portal_bid_id` | `project_id` (opaque string) |
| `portal_department` | division/template label (e.g. "Public Works — Construction") |
| `crawl_data` | JSONB overflow: every raw field, `documents[]`, `planHolders`, template id, extraction metadata |

Everything not in a typed column lives in `crawl_data`. The driver must always populate `crawl_data` richly (this is what portal intelligence reads).

### 5.2 Per-template field differences → normalized mapping

| Normalized concept | `aed_bid` | `cons` | `asd_rfp` | `rfb` / `aed_rfp` |
|---|---|---|---|---|
| Title | `Project Name` | `Project Name` | `Project Name` | confirm in M1 |
| Portal ID | `Spec No` (+ `project_id`) | `Project ID` (= `project_id`) | `Project ID` | confirm |
| Bid due (`bid_due_at`) | `Closing Date` (date+time) | `Bid Opening Date` | `Proposal Due Date` (may be "Open Continuously") | confirm |
| Advertise/open | `Open Date` | `Advertise Date` | `RFP Issue Date` | confirm |
| Estimate | `Estimate` ($) | (often not shown) | `Estimate` ($) | confirm |
| Location (`project_address`) | (limited) | `Project Limit` + `Cities/Communities` | (limited) | confirm |
| Scope/description | `Description` | `Scope` | (from listing snippet) | confirm |
| Pre-bid | `Proposers Conference(s)` (date, mandatory flag, address) | (in body text) | `Proposers Conference Date` (or "N/A") | confirm |
| Contact | Name/Phone/Email | Name/Phone/Email | Name/Phone/Email | confirm |
| Addenda | (in docs) | dedicated **Addenda** section | inline in docs list | confirm |
| Documents | title-only links | title + **Notes/Pages/Size** | title + inline addenda | confirm |

### 5.3 Normalization strategy

- **One normalizer, template-native inputs.** Each extractor speaks its own labels; the normalizer maps those labels to the contract above. The "bid due" concept resolves from whichever of `Closing Date` / `Bid Opening Date` / `Proposal Due Date` the template provides.
- **Tolerant, lossless parsing.** Money and dates parsed defensively; unparseable or sentinel values → `null` in the typed column, raw preserved in `crawl_data`. Never throw on a weird value — degrade to null + raw.
- **County is constant** `"Los Angeles"`; do not attempt to parse it per project.
- **`raw_title` format** mirrors Caltrans (`"<id> - <title>"`) for UI consistency.

---

## 6. Document Acquisition Design (`lacounty_dpw_documents.js`)

Milestone 2. Entry point `acquireLaCountyDpwDocuments({ supabase, task, candidate, log })`, invoked from `runDocumentPrefetchTask()` for `portal_type='lacounty_dpw'`. Returns the same result shape the prefetch handler expects: `{ found, acquired, skipped, failed }`.

This driver **automates the verified human workflow** (recon 0.5 / "Important Observation"). It does **not** synthesize download URLs.

### 6.1 The workflow to automate (verified)

```
For the candidate's detail page:
  1. Open an authenticated browser session (SSO already established — see §7).
  2. Navigate to the candidate.source_url (ProjectDetail / ProjectDetailAdv page).
  3. For each document in crawl_data.documents[] (worklist built by the scan driver):
       a. Trigger the document link (the "Project Manual" / "Plans" / etc. control).
       b. If redirected to SSO SignIn, complete/refresh auth, return to detail page, trigger again.
       c. Wait for server-side document preparation (~1–2 minutes; the page/tab
          eventually navigates itself to the PDF).
       d. Capture the resulting PDF (it opens directly in the browser / triggers a download).
       e. Upload bytes to Supabase Storage 'opportunity-documents'; upsert opportunity_documents row.
       f. Return to the detail page (browser Back) for the next document.
```

### 6.2 Technology

- **Playwright with a real/authenticated browser context.** Reuse the `caltrans_documents.js` structure: a login step, a `waitForDetailPage`-style readiness check, per-document acquisition, storage upload, and `opportunity_documents` upsert. **Browserbase** is the remote-browser execution target (fallback/primary per ops config), consistent with how the worker already runs Playwright.

### 6.3 Navigation & PDF detection

- **Two-step trigger.** The document control first bounces through `OpportunitiesNewRegister.aspx` → SSO. On an authenticated session it should proceed; the driver must tolerate the "click once → auth → click again" pattern (recon 0.5) and detect when it has landed back on the detail page vs. on the SSO page.
- **PDF detection is dual-mode.** The PDF may (a) trigger a Playwright `download` event, or (b) render inline as a navigation to a PDF resource (the recon notes "PDF opens directly inside browser" and "replaces the current page"). The driver must handle **both**: register a `page.waitForEvent('download', …)` *and* watch for a navigation whose response `content-type` is `application/pdf`. Whichever fires first is the artifact.
- Caltrans already uses `page.waitForEvent('download', { timeout: 120000 })`; reuse that 120s ceiling as the floor here because DPW's server-side prep is explicitly ~1–2 minutes.

### 6.4 Waiting strategy

- The **~1–2 minute server-side preparation** is the defining constraint. After triggering a document:
  - Wait on a race of: `download` event OR navigation-to-PDF OR a hard timeout.
  - Set the per-document hard timeout to **≥180s** (prep can be ~120s; add margin). Do not use the default Playwright 30s.
  - While waiting, do not spam re-clicks; a single re-trigger only if the driver detects it's still on the SSO/detail page after auth (the documented double-click), then wait again.

### 6.5 Download handling & upload pipeline

- On capture, read the artifact bytes (from the `download` object, or by fetching the in-browser PDF resource within the authenticated context).
- **Idempotency & upsert** (reuse Caltrans pattern exactly):
  - Look up `opportunity_documents` by `(opportunity_candidate_id, source_url)`. If `acquisition_status='acquired'` and `storage_path` set → skip.
  - Otherwise upsert a row with `acquisition_status='queued'` first, then upload bytes to `opportunity-documents`, then update the row to `acquired` with `storage_path`, `file_size`, `file_type`.
  - Populate `file_name`, `file_type` (pdf), `source_url` (the per-document trigger URL / stable doc identifier), `manifest_data` (the scan-captured `{title, notes, page_count, file_size}`), and `document_family`/`document_class`/`document_source_order` consistent with the existing schema.
- The per-document `source_url` used as the idempotency key must be **stable across runs**. Prefer the deterministic `OpportunitiesNewRegister.aspx?project_type=…&project_id=…&<doc-discriminator>` form captured at scan time; if the trigger URL is not stable, synthesize a deterministic key from `(candidate project_id + document title)` and store the volatile URL in `manifest_data`.

### 6.6 Timeout, recovery, and partial results

- **Per-document failure isolation:** one document that fails to prepare/download marks that `opportunity_documents` row `failed` (with `acquisition_error`) and moves on. Other documents still acquire. The task returns `{ found, acquired, skipped, failed }`.
- **Session recovery:** if a mid-run navigation lands unexpectedly on SSO, run the auth refresh (§7) once and retry the current document; if it fails twice, mark that document failed and continue.
- **Whole-candidate failure:** if auth cannot be established at all, the task fails cleanly; the candidate stays metadata-complete (portal intelligence already ran). Document acquisition is best-effort and never corrupts the candidate.
- **Do not** re-download `acquired` documents; the idempotency guard makes re-running the prefetch safe.

---

## 7. Authentication Strategy

Document acquisition requires an authenticated **LA County SSO** session (`app.pw.lacounty.gov/adm/uamsso`; recon 0.5). Metadata acquisition requires **no** auth and must stay that way.

### 7.1 Session model

- A single **service vendor account** authenticates to DPW SSO. The document driver logs in (or restores a saved session) at the start of a prefetch task and reuses that context for every document on the candidate.
- Model after `caltrans_documents.js`, which drives an interactive login (email/password fields, submit) and validates success by inspecting page text. DPW's SSO login page selectors are captured during Milestone 2 build.

### 7.2 Credential storage

- Credentials live in **worker environment variables / secrets** (e.g. `LACOUNTY_DPW_SSO_USERNAME`, `LACOUNTY_DPW_SSO_PASSWORD`), never in the repo or the database — consistent with how Caltrans/PlanetBids credentials are handled. Rotate via the deployment secret store.
- **This spec does not put any credential in code or config files.** The implementer wires env vars only.

### 7.3 Reuse, expiration, refresh

- **Within a task:** one login, reused across all of the candidate's documents.
- **Across tasks:** optionally persist Playwright `storageState` (cookies) in a short-lived secure store to skip re-login while the session is valid. If persisted state fails (expired), fall back to a fresh interactive login transparently.
- **Expiration handling:** treat an unexpected SSO redirect mid-flow as "session expired" → re-authenticate once → retry the in-flight document.
- **Concurrency caution:** if the vendor account tolerates only one active session (as PlanetBids does — note the existing PlanetBids lock in `index.js`), guard DPW document tasks with a similar **single-flight lock** so two workers don't invalidate each other's session (see §9).

### 7.4 `opportunity_sources` row (config)

One row, e.g.:
- `name` = "LA County Department of Public Works"
- `portal_type` = `lacounty_dpw`
- `listing_url` = `https://dpw.lacounty.gov/contracts/Opportunities.aspx`
- `scan_enabled` = true, `scan_interval_hours` = 24
- `refresh_enabled` = true, `refresh_cadence_hours` = 24

Auth credentials are **not** stored here — only in worker secrets.

---

## 8. Error Handling

| Failure | Detection | Response |
|---|---|---|
| **Listing GET timeout / 5xx** | HTTP status / thrown error | Bounded retry+backoff; if still failing, return `candidates:[]`, `errors>0`; runner marks source `failed`, writes `last_refresh_error`. No candidate mutation. |
| **Listing HTML unparseable** (structure changed) | 0 rows parsed from a 200 response, or missing expected columns | Treat as failure (not "0 opportunities"). Emit explicit error "listing structure changed"; do **not** silently report an empty scan. Mirrors the existing scheduler philosophy of failing loudly on 0 sources. |
| **Detail page parse error** | per-page extractor throws | Non-fatal: record error message, skip that candidate, continue loop. |
| **Unrecognized template** | no registry match (§4.3) | Generic extractor + `template_unrecognized` flag + warning; candidate still created with listing-level metadata. |
| **Non-date due value** ("Open Continuously") | normalizer date parse | `bid_due_at=null`, raw preserved; not an error. |
| **Auth failure (documents)** | SSO error text / cannot reach detail page authenticated | Whole document task fails cleanly; candidate stays metadata-complete; `document_acquisition` best-effort. |
| **Document prep timeout (>180s)** | no download/PDF navigation within ceiling | Mark that `opportunity_documents` row `failed` (`acquisition_error`), continue other docs. |
| **Unexpected SSO redirect mid-flow** | navigation to SignIn URL during acquisition | Re-auth once, retry current doc; 2nd failure → mark doc failed. |
| **Missing documents** (none listed) | empty `crawl_data.documents[]` | Not an error; prefetch returns `found:0`. |
| **Imperva escalation** (JS/CAPTCHA challenge) | challenge page / non-200 with Incapsula markers on the HTTP path | Fail the HTTP request; **escalate to the Browserbase real-browser path** (§8.7) for that scan; alert if escalation persists. Never attempt to solve CAPTCHAs. |
| **Portal-wide change** (paths, SSO flow) | broad parse/auth failures across candidates | Source status `failed`; surfaced via `last_refresh_error` + logs; human investigates. Template registry localizes most such changes to one extractor. |

### 8.7 Imperva fallback path

The HTTP-first scan passes Imperva today (recon 0.6) but escalation is possible under load. Design the scan driver so its **fetch layer is swappable**: the default is a plain HTTP client; on detecting an Incapsula challenge, the same listing/detail parsing runs against pages fetched through a **Browserbase real browser** (realistic fingerprint). Parsing logic is identical; only the transport changes. This keeps the cheap path default while guaranteeing a resilient fallback without a rewrite.

---

## 9. Performance

### 9.1 Scan duration (Milestone 1)

- One listing GET (~1 request) + one GET per opportunity. At the observed volume (~21 currently advertised), that is ~22 lightweight HTML fetches. Detail responses are ~20–35 KB and returned in <3s each (recon 0.6).
- **Sequential** detail fetching with a small politeness delay is the safe default and completes in well under a minute at current volume. This is comfortably faster than the Playwright-based Caltrans scan.

### 9.2 Concurrency & rate limiting (scan)

- **Bounded concurrency** for detail fetches (e.g. 2–4 in flight) is acceptable and keeps scans fast if volume grows, but must be paired with a small inter-request delay to avoid nudging Imperva toward escalation.
- Add jitter and a modest per-request delay; respect the WAF. Recon load-tested only a light burst — do not assume unlimited throughput (§11).
- If Imperva escalates, drop to the Browserbase path (§8.7) and reduce concurrency to 1.

### 9.3 Document acquisition duration (Milestone 2)

- Dominated by the **~1–2 minute server-side preparation per document**. A candidate with N gated documents costs roughly `N × (prep + download)` — minutes, not seconds. This is inherent to the portal, not the driver.
- **Documents are acquired sequentially within a candidate** (single browser context, one PDF at a time; matches the human flow and the Caltrans driver's per-file loop).

### 9.4 Document concurrency & locking

- Because document prep is slow and the SSO session is likely single-active (§7.3), **serialize DPW document tasks** behind a single-flight lock (pattern already exists for PlanetBids: `acquirePlanetBidsLock`/`releasePlanetBidsLock` in `index.js`). Introduce an analogous `acquireLaCountyDpwLock` if testing confirms the account is single-session.
- Document tasks are `priority 2` (below scan/portal-intelligence), so slow document work never starves metadata ingestion.

---

## 10. Future Extensibility — the Agency Direct Driver framework

### 10.1 The reusable shape

An Agency Direct driver is three composable pieces:
1. **Listing parser** — GET a server-rendered listing, yield rows each carrying an authoritative detail href.
2. **Template registry** — path-matched extractors, each producing template-native fields + a documents worklist (§4).
3. **Normalizer** — maps template-native fields to the shared OML candidate contract (§5).

Plus, when documents are gated, an optional **document driver** that automates the agency's human download flow in an authenticated Playwright/Browserbase session (§6).

### 10.2 How a new agency plugs in

1. Add a `portal_type` string; register it in `resolveTaskType` (refresh + scan edge functions), the worker claim query, the `processTask` dispatch, and (if it has documents) the `runDocumentPrefetchTask` portal switch — the same four seams DPW uses (§2.2).
2. Implement `drivers/<agency>.js` = listing parser + template registry + normalizer.
3. Add one `opportunity_sources` row and a `platformDetection` pattern.
4. Portal intelligence, qualification, F3/F4 come free (portal-agnostic).

The goal is that a new agency-direct integration is **new driver code + config**, with **no** pipeline surgery.

### 10.3 How new templates are added

- Add one entry to the driver's template registry (`templateId`, `matches`, `extract`). No changes to the scan loop, normalizer contract, or worker. Unrecognized templates already degrade safely (§4.3), so a new division surfaces as candidates before its extractor exists.

### 10.4 Documented future extensions (not v1)

- **Bid results / awarded history** via the `main_ddlPhase=AWARDED` postback (ViewState POST) for win/award analytics.
- **Plan-holder / competitive intelligence** from the already-captured `PlanHolders.aspx` URLs.
- **Bid Express plan-room** as an alternate, possibly less-gated document source (recon flagged this as a promising lead vs. DPW SSO).
- **Persistent SSO session cache** across document tasks (§7.3) once auth is proven stable.

---

## 11. Risks

### 11.1 Remaining technical unknowns (carry-over from recon §5)

- **`rfb` and `aed_rfp` field sets** not yet rendered/confirmed — resolved during Milestone 1 build (both are low-risk `ProjectDetail.aspx` variants).
- **SSO registration/login flow specifics** — is the vendor account free/self-service, account-wide vs per-project, and what exactly the login page requires. This is the top Milestone 2 unknown; a spike (§12) de-risks it before committing to the document driver.
- **Per-document trigger URL stability** — needed for the `opportunity_documents` idempotency key; if unstable, use a synthesized deterministic key (§6.5).
- **Bid Express** may host the actual plans with less friction — worth a spike; could simplify or replace the SSO document flow.

### 11.2 Operational risks

- **Imperva escalation under production cadence.** Only a light burst was tested. Sustained nightly scans could trigger challenges. Mitigations: politeness delays, bounded concurrency, Browserbase fallback (§8.7), and monitoring for Incapsula challenge markers.
- **Slow document prep (~1–2 min each)** makes bulk document acquisition long and browser-session-bound; serialization + lock (§9.4) is required, and a large backlog could lag. Documents are best-effort by design, which contains the blast radius.
- **Single-session SSO account** could serialize all document work; if throughput becomes a problem, a second vendor account / session pool is the lever.

### 11.3 Maintenance risks

- **ASP.NET WebForms fragility.** Label-text-driven extraction can break if the agency re-labels fields. The template registry localizes breakage to one extractor, and the "unrecognized/parse-error → non-fatal + loud error" policy (§4.3/§8) turns silent drift into visible signals.
- **SSO flow changes** would break document acquisition without touching metadata — the two-driver split keeps metadata resilient to that.

### 11.4 Future improvements

- Golden-HTML fixtures per template for regression tests (see §12 M1 exit criteria).
- Structured alerting on `template_unrecognized` and on Imperva escalation.

---

## 12. Recommended Implementation Order

Milestones are independently shippable. **Metadata ingestion ships first and completely, with zero document work.**

### Milestone 0 — Plumbing & config (small)

- **Objective:** Register `lacounty_dpw` as a known portal type end-to-end so a scan task can be created and claimed (even before the driver exists).
- **Deliverables:** `portal_type` added to `resolveTaskType` + `TaskType` union + active-task guard (`refresh-opportunities`); scan-opportunities partition; worker claim query + `processTask` branch (stubbed to call the scan runner); `platformDetection` + display name; the `opportunity_sources` row (scan disabled until M1).
- **Dependencies:** none.
- **Exit criteria:** A manually-queued `lacounty_dpw_scan` task is claimed and dispatched by the worker without "Unsupported task type"; source row visible to the scheduler; no candidates yet.

### Milestone 1 — Metadata ingestion (HTTP-first scan) — **primary deliverable**

- **Objective:** Discover all currently-advertised DPW opportunities and persist normalized candidates through the existing pipeline — **no document acquisition**.
- **Deliverables:**
  - `drivers/lacounty_dpw.js`: listing parser, template registry with `aed_bid`/`cons`/`asd_rfp`/`rfb`/`aed_rfp` extractors (+ generic fallback), normalizer (money/date/sentinel tolerant), `crawl_data.documents[]` metadata capture (no downloads).
  - `runLaCountyDpwScan()` runner in `index.js` (mirrors `runCaltransScan`): run logs, source status, `persistScannedCandidate` loop, tallies; `lacounty_dpw_scan` added to the scan-result arrays (lines ~1120/1228/1251).
  - Confirm `rfb`/`aed_rfp` field sets against live pages during build.
  - Golden-HTML fixtures for each template + parser unit tests.
- **Dependencies:** M0.
- **Exit criteria:** Enabling the source and running a scan creates one candidate per advertised opportunity; each has correct `raw_title`, `bid_due_at` (or null for "Open Continuously"), `estimated_value` where present, `portal_bid_id`, `county="Los Angeles"`, and a populated `crawl_data` including document metadata; `portal_intelligence` runs and produces a summary; re-running the scan reports rows as `unchanged` (idempotency proven); a structural change (missing rows) reports `failed`, not "0 opportunities". **Document acquisition is untouched and unblocked by its absence.**

### Milestone 2 — Document acquisition (authenticated Playwright)

- **Objective:** Acquire gated bid documents for a candidate by automating the SSO → prepare → capture PDF → upload flow.
- **Pre-work (spike):** Manually verify the SSO login page selectors, whether vendor registration is required/free, session single-vs-multi, per-document trigger-URL stability, and evaluate Bid Express as an alternate source. Time-boxed; de-risks the build.
- **Deliverables:**
  - `drivers/lacounty_dpw_documents.js`: `acquireLaCountyDpwDocuments()` — login/session (§7), per-document trigger with double-click tolerance, dual-mode PDF detection (download event OR PDF navigation), ≥180s prep wait, storage upload + `opportunity_documents` upsert with idempotency, per-document failure isolation.
  - `runDocumentPrefetchTask()` `lacounty_dpw` branch; optional `acquireLaCountyDpwLock` if the account is single-session.
  - Credentials wired as worker secrets (no code/config credentials).
- **Dependencies:** M1 (needs candidates + `crawl_data.documents[]` worklist).
- **Exit criteria:** For a candidate with gated documents, a `document_prefetch` task acquires ≥1 PDF into `opportunity-documents` with an `acquired` `opportunity_documents` row and valid `storage_path`; re-running skips already-acquired docs; auth expiry mid-flow recovers once; a failed document is isolated (others still acquire) and the candidate remains metadata-complete. Downstream user-triggered `document_processing` → `project_intelligence` can consume the acquired PDFs unchanged.

### Milestone 3 — Hardening & scheduling (small)

- **Objective:** Production-ready operation.
- **Deliverables:** enable nightly scheduling (24h cadence) via `refresh-opportunities`; Imperva-escalation Browserbase fallback (§8.7) wired and tested; politeness/concurrency tuning; alerting on `template_unrecognized` and WAF escalation; a short runbook.
- **Dependencies:** M1 (M2 optional for scheduling metadata).
- **Exit criteria:** DPW scans run on schedule for a week without manual intervention; failures surface via `last_refresh_error` and logs; no silent empty scans; WAF fallback verified against a simulated challenge.

---

*End of specification. Implementation may begin at Milestone 0; Milestone 1 (metadata ingestion) is the first shippable deliverable and is fully decoupled from document acquisition.*
