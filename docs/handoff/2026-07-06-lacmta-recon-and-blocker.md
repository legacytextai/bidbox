# BidBox Engineering Handoff — LA Metro (LACMTA) Recon, Blocker, and Live Validation

**Date:** 2026-07-06
**Branch:** `phase1-opportunity-intelligence`
**Scope:** LA County Metropolitan Transportation Authority (Metro), `business.metro.net`
**Status:** **Live deployment validation passed.** Two scans run back-to-back through the production Railway worker + Browserbase, both `errors: 0`. 75 solicitations discovered, fully detail-enriched, zero duplicates on re-scan. Source is enabled in production (`scan_enabled=true`, `refresh_enabled=true`). See §6 for the full validation record and the two real bugs it caught before this was true.

---

## 0. Why This Document Exists

This was a planned, approved implementation session (plan: metadata-only ingestion for LA Metro, following the LA County DPW "Agency Direct" pattern). Recon was completed and an initial driver was built using a plain local Playwright transport (`chromium.launch()`, matching `caltrans.js`). Validating that version against the live portal triggered what looked like a hard WAF block, and the initial conclusion was that Metro should be deprioritized.

**That conclusion was wrong and was corrected before any of it was committed.** The block was against local headless Chromium specifically — the same failure signature that historically caused `planetbids.js` to require Browserbase instead of a direct launch (see `docs/agent-architecture-task-list.md` Task 3.1). Plain HTTP `curl` to the same URL succeeded, and Playwright succeeded against an unrelated site, isolating the block to "headless Chromium → Metro" rather than "any traffic → Metro" or "any Playwright traffic → anywhere." That is not proof that Metro blocks Browserbase, which uses different infrastructure and fingerprinting than a local headless launch. The driver was rebuilt on the Browserbase transport before anything was committed. This document preserves everything learned — recon findings, the corrected transport reasoning, and what remains to validate — so a future session doesn't have to repeat any of it.

---

## 1. Portal Architecture — Confirmed Findings

**Domain:** `business.metro.net/webcenter/portal/VendorPortal`
**Platform:** Oracle WebCenter Portal / ADF Faces — not a static ASP.NET site (unlike LA County DPW) and not a known third-party procurement SaaS (PlanetBids, Bonfire, etc.).

### 1.1 No stable per-item URL — the central architectural fact

- A plain HTTP GET of the Open Solicitations listing URL returns only Oracle ADF's device-capability "loopback" bootstrap script (`AdfLoopbackUtils`) — a ~6.7KB JS payload that probes screen size/fonts/media features and self-submits a follow-up request. **Zero solicitation data is present without executing that JS.**
- Clicking a solicitation number (`href="#"`, `onclick="this.focus();return false;"`) fires a **POST to the exact same listing URL** with `Adf-Page-Id` incremented (e.g. `...?Adf-Window-Id=o4k7icn9j&Adf-Page-Id=12`), not a GET to a distinct resource. This is Oracle ADF's server-side partial-page-render (PPR) mechanism — the response is a ViewState-dependent fragment tied to the live browser session, not a bookmarkable document.
- No hidden JSON/XHR/REST endpoint was found in live network traffic (captured a full page load and a row click; only static JS/CSS/image assets for the ADF framework itself were observed beyond the PPR POST).
- **Conclusion:** there is no stable per-solicitation URL and no API. Any driver must hold open a live, stateful Playwright session for the entire scan — the same conclusion the plan anticipated as the reason Playwright (not DPW's HTTP-only pattern) would be required, now confirmed with direct evidence rather than assumed because "it's Oracle."

### 1.2 The on-screen listing table hard-caps at 25 rows — no pagination control exists

- The visible Open Solicitations table renders **exactly 25 rows** and has an internal scrollable `<div class="af_table_data-body">`, but scrolling that div to its end reveals no more than the 25 already-rendered rows.
- An exhaustive DOM search (all `[aria-label]`/`[title]` attributes containing "next/previous/page/scroll", all images near the table wrapper, the "View" dropdown) found **no pagination control of any kind**. The live solicitation count is ~70 (confirmed via the PDF export, see below), so roughly two-thirds of open solicitations are invisible in the default on-screen view with no way to page to them.

### 1.3 The "Download into PDF" export bypasses the 25-row cap

- Clicking **Download into PDF** produces a complete server-generated report of every open solicitation (confirmed: ~70 rows across the export, vs. 25 on screen), with columns `Number, Title, Type, Due Date, Issue Date, Status`. This export does **not** include NAICS Code(s) (which the live on-screen table does show as a column).
- This is not subject to the 25-row cap and is a real file download (not a PPR fragment), making it capturable via Playwright's `download` event and parseable with `pdfjs-dist` (already a dependency in `bidbox-worker`, used identically in `drivers/document_processing.js`).

### 1.4 The search form is the only way to reach a specific solicitation's detail view

- The visible search form (Solicitation Number, Solicitation Title, Set Aside Program, Buyer/Contract Administrator, NAICS Code) filters the same capped table.
- **Confirmed live:** searching for an exact Solicitation Number (tested with `RQ143998`, the last row in the PDF export, i.e. far outside the 25-row default view) returns **exactly one matching row**, whose link can then be clicked to reach the detail view — regardless of the row's position in the full ~70-item list.
- **Confirmed live:** clicking "Back to Solicitations List" from a detail view **preserves the active search filter** (the search box still contained the number, and the filtered single-row result was still shown), so a per-item loop of *fill search box → Search → click result → extract → Back* is a clean, repeatable pattern for iterating every number obtained from the PDF export.

### 1.5 Detail view field structure — confirmed via live DOM inspection

The ADF detail form renders each field as a label/value `<td>` pair:
```html
<td class="af_panelLabelAndMessage_label ...">LABEL</td>
<td class="... af_panelLabelAndMessage_content-cell">VALUE</td>
```
followed by a hidden duplicate editable-widget mirror of the same field further down the DOM (an ADF rendering artifact) — taking the **first** occurrence per label in document order reliably gets the real display value.

Confirmed fields present on a real solicitation (`PS141682`): `Number`, `Title`, `Description`, `Type`, `Set Aside Program`, `Funding Source`, `NAICS Code(s)`, `Aditional Information` (sic — typo is in the source), `Issue Date`, `Due Date and Time`, `Pre-Bid/Proposal Conference Date and Time`, `Pre-Bid/Proposal Conference Location`, `Forecasted Award Date`, `Contract Administrator`, `Phone No.`, `Fax`, `Email`. Dates are formatted `DD-Mon-YYYY` or `DD-Mon-YYYY, HH:MM:SS` (e.g. `22-Jul-2026, 14:00:00`).

### 1.6 Solicitation-list scope — resolved

The left-nav lists six pages: Open Solicitations, Small Business Prime (Set Aside), LMCSBE Program, Bid Tabulation, Medium Size (MSZ) I, Medium Size (MSZ) II. Checked "Small Business Prime (Set Aside)" live: it is a distinct real URL (`.../solicitations/smallbusinessprimesetaside`, unlike the per-row PPR interaction), but **every solicitation number found there already appears in Open Solicitations** (`RQ143949`, `PS143477`, `OP142160`, etc. all cross-checked). **Confirmed: these are filtered subsets, not separate datasets.** Open Solicitations alone is the correct — and sufficient — scope.

### 1.7 Content mix (informational, not acted on)

Open Solicitations mixes genuine construction/infrastructure work (Doran Street Grade Separation, Union Station Gateway HVAC, CEQA/NEPA compliance, fire-life safety systems, Hi-Rail vehicle procurement) with a high volume of parts/supply RFQs (respirators, sensors, cables, gloves) for bus/rail maintenance. Per explicit direction during planning, **no relevance filtering was to be applied at scan time** — the driver was designed to ingest everything and let downstream qualification/search/AI decide relevance. This remains the right approach if/when this agency is revisited.

---

## 2. What Was Built

A metadata-only scan driver following the LA County DPW "Agency Direct" pattern, on a Browserbase transport:
- `portal_type = 'lacmta'` registered at all four integration seams (`src/lib/platformDetection.ts`, `supabase/functions/crawl-project/index.ts`, `supabase/functions/refresh-opportunities/index.ts`, `supabase/functions/scan-opportunities/index.ts`, `bidbox-worker/index.js` claim/dispatch/result-shaping/document_prefetch-no-op-stub).
- `bidbox-worker/lib/browserbase.js`: a shared Browserbase session-bootstrap helper (`connectBrowserbaseSession(log)`), extracted because the session-create + CDP-connect handshake was already duplicated three times (`drivers/planetbids.js`, `drivers/planetbids_documents.js`, `drivers/portal_intelligence.js`) before this change. A fourth copy for Metro would have made that worse; a shared helper immediately improves it. The three existing call sites were **intentionally left as-is** — they are working production code this session couldn't validate against Browserbase, so migrating them is a separate, deliberately-scoped follow-up, not bundled into this change.
- `bidbox-worker/drivers/lacmta.js`: download+parse the PDF export for full enumeration (regex-based row reconstruction from accumulated multi-line blocks, mirroring the existing `caltrans.js` "blob of rendered text → regex fields" convention), then per-number search→click→extract-detail→back loop using the generic `af_panelLabelAndMessage_label` pairing described in §1.5. Connects via `connectBrowserbaseSession()` — same transport as `planetbids.js` — with **no local-Chromium fallback**, matching `planetbids.js`'s behavior of failing cleanly if `BROWSERBASE_API_KEY`/`BROWSERBASE_PROJECT_ID` aren't configured rather than silently falling back to a transport already shown to get blocked.
- A disabled `opportunity_sources` + `portal_drivers` seed migration (`20260706193000_seed_lacmta_source.sql`), `driver_mode = 'browserbase'`.

## 3. The Original Blocker, and Why It Doesn't Mean What It First Looked Like

The first implementation attempt used a plain local `chromium.launch({ headless: true })` (the `caltrans.js` pattern, not `planetbids.js`'s). Validating that version live produced:

| Request | Result |
|---|---|
| Plain `curl` to the Metro listing URL | `200 OK` |
| Local Playwright headless Chromium → `example.com` | `200 OK` |
| Local Playwright headless Chromium → the same Metro listing URL | **`500` — "Web Page Blocked... Attack ID: 20000051"** |

The initial read was "Metro's WAF blocks automated browsers, therefore Metro is a dead end." That read doesn't hold up: **`planetbids.js` hit this exact failure signature already** — Task 3.1 in `docs/agent-architecture-task-list.md` records "headless: true blocked by PlanetBids bot detection... Winning Technology: Playwright + Browserbase." PlanetBids' bot protection was never a dead end; it was a transport problem, solved once, in one place. The Metro result is evidence against local headless Chromium specifically, not against Browserbase, which runs from different infrastructure with different fingerprinting. Concluding "Metro is blocked" from a test that never used the transport BidBox actually runs in production was the mistake — corrected in this same session before anything was committed.

## 4. What Has and Has Not Been Validated

No `BROWSERBASE_API_KEY`/`BROWSERBASE_PROJECT_ID` are available in this development environment (only the template `.env.example` — the real values live in Railway's environment, same as `PLANETBIDS_EMAIL`/`PLANETBIDS_PASSWORD`), and per direction, no attempt was made to source them or to hit Metro again from this sandbox. What **has** been validated locally, against fixtures built from real captured data (not guessed):

- `parseListingPdfText` — regex-based row reconstruction from multi-line-wrapped PDF export text, tested against a reconstruction of the real export content, including the tricky cases: multi-line wrapped titles, `(2)`-suffixed numbers, a single-letter prefix (`C137794(2)`), and a title containing an embedded `M/D/YYYY`-style date that must not be confused with the `DD-Mon-YYYY` due/issue date tokens. All parsed correctly.
- `parseMetroDate` — Pacific-time parsing for both `DD-Mon-YYYY, HH:MM:SS` and date-only `DD-Mon-YYYY` forms, verified across a PDT case and a PST (winter) case to confirm the DST-aware offset logic holds outside the July date used for most of recon.
- The detail-field extraction algorithm (first-occurrence label→value pairing) and `applyDetailFields`'s field-mapping/aliasing — tested via a synthetic HTML fixture built from the exact real markup captured live from `PS141682` (including the duplicate hidden-widget mirror row that a naive extractor could wrongly overwrite the real value with), run through `cheerio` (already a worker dependency) as a DOM stand-in. Output matched the real data exactly (Contract Administrator, phone, NAICS codes, dates, description).
- `connectBrowserbaseSession()` fails cleanly with `BROWSERBASE_API_KEY not configured` and makes no network call when the key is absent — confirmed locally.
- All touched files pass `node --check` and the project's `tsc --noEmit`.

All of the above was later confirmed live in production (§6) — including the one thing this environment couldn't test: an actual Browserbase session reaching Metro. It was not blocked. Two real implementation bugs were found and fixed along the way (§6.2–6.3), neither related to Metro's bot protection.

---

## 5. Live Validation Record (2026-07-06, via Railway + Browserbase)

Full deployment validation was run against the production Railway worker (which has real `BROWSERBASE_API_KEY`/`BROWSERBASE_PROJECT_ID`), using the seeded `opportunity_sources` row (`id=6922adcd-1b63-40b1-8f11-fb80265f8947`), toggled `scan_enabled`/`refresh_enabled` on/off around each attempt.

### 6.1 Attempt 1 — Browserbase session establishes fine; download retrieval fails

Result: `found=0, errors=1`. Log: `LA Metro scrape failed: ENOENT: no such file or directory, open '/tmp/playwright-artifacts-.../...'`.

Root cause: `download.path()` + `fs.readFileSync()` only work when Playwright launches the browser locally — the file lives on Browserbase's remote machine, not the worker, so the reported path doesn't exist locally. This confirms Browserbase itself was never the problem; only this specific download-retrieval code path was.

Fix: switched to `download.createReadStream()`.

### 6.2 Attempt 2 — createReadStream() returns zero bytes

Result: `found=0, errors=1`. Log: `LA Metro scrape failed: The PDF file is empty, i.e. its size is zero bytes.`

Root cause (confirmed via Browserbase's own docs): Browserbase does not sync downloaded files to its cloud storage by default — a session must explicitly opt in via a CDP call (`Browser.setDownloadBehavior` with `downloadPath: "downloads"`, `eventsEnabled: true`), and files must then be retrieved via Browserbase's own `GET /v1/sessions/{id}/downloads` endpoint (returns a zip), not via Playwright's `Download` object at all. `planetbids_documents.js` never hit this because it downloads via a direct authenticated HTTP fetch with a captured bearer token, not a browser-triggered file download — this was genuinely new territory for the codebase.

Fix: added the CDP opt-in call to `connectBrowserbaseSession()`, and a new `fetchBrowserbaseDownloadZip()` helper in `lib/browserbase.js` that polls the downloads endpoint and unzips the result with `yauzl` (already a dependency, same library `archive_extraction.js` uses).

### 6.3 Attempt 3 — download works; a different, unrelated bug appears next

Result: `found=75` (full enumeration succeeded — the PDF fix worked), but every row's detail extraction failed with the same Playwright strict-mode error:
```
getByRole('button', { name: 'Search' }) resolved to 2 elements:
1) <a ... aria-label="Collapse Search" role="button">  (a "Collapse Search" toggle)
2) <button ...>Search</button>                          (the real Search button)
```
Root cause: Playwright's default accessible-name matching is substring-based, and the page has a second `role="button"` element ("Collapse Search") whose name also contains "Search". Unrelated to Browserbase or Metro's bot protection — a plain locator-specificity bug.

Fix: added `exact: true` to the Search button locator, and preemptively to the two other `getByRole` locators in the file (Download-into-PDF button, Solicitation Number textbox), since this page had already shown a pattern of near-duplicate accessible names.

An important side effect: this run's per-row error-tolerance path (a failed detail extraction still persists a listing-only candidate) meant 75 candidates were already created in the database despite every row technically "failing," which is exactly why attempt 4 below reports `refreshed` rather than `new`.

### 6.4 Attempt 4 — full success

Result: `found=75, errors=0, new=0, refreshed=75, unchanged=0`. Every row got full detail extraction (Contract Administrator populated on 100% of the 75 rows; NAICS codes present on the ~27% of rows where the portal actually provides one; all three solicitation types — IFB, RFP, RFQ — present, confirming no filtering). `refreshed` rather than `new` is correctly explained by 6.3's partial candidates already existing.

### 6.5 Attempt 5 — idempotency check

Queued a second scan back-to-back with no code changes. Result: `found=75, errors=0, refreshed=75`. Verified directly in Supabase: candidate count stayed at exactly 75 (was 75 before, 75 after), with 75 distinct `source_url` and `portal_bid_id` values — **no duplicates created.**

### 6.6 Outcome

Both the full-detail scan and the idempotency re-scan passed cleanly. The source is left enabled in production (`scan_enabled=true`, `refresh_enabled=true`) per the validation criteria. The driver is production-ready for metadata ingestion. Document acquisition remains explicitly out of scope (Oracle iSupplier vendor registration requires manual agency approval).

## 6. Final Recommendation

**LA Metro is live and production-ready for metadata ingestion.** Section 6 records the full validation: two clean scans in a row through the real Railway + Browserbase transport, 75 solicitations discovered with complete detail data, zero errors, zero duplicates on re-scan. The source is enabled (`scan_enabled=true`, `refresh_enabled=true`) and will pick up on the normal nightly refresh cadence going forward.

What remains explicitly out of scope, unchanged from the original plan: document acquisition (Oracle iSupplier vendor registration requires manual agency approval), Oracle SSO, and any work on the 25-row on-screen pagination cap (settled separately — no bypass exists; the PDF export is the only path to full enumeration, and that path is now proven end-to-end).
