# BidBox Engineering Handoff — LA Metro (LACMTA) Recon and Blocker

**Date:** 2026-07-06
**Branch:** `phase1-opportunity-intelligence`
**Scope:** Agency expansion reconnaissance only — LA County Metropolitan Transportation Authority (Metro), `business.metro.net`
**Status:** Reconnaissance complete. Driver implemented on the same Browserbase transport `planetbids.js` already uses. All logic that can be validated without a live browser session (PDF-export row parsing, Pacific date parsing, detail-field extraction/mapping) has been validated locally against fixtures built from real captured data. **Live end-to-end validation against the actual portal has not been completed** and requires a Railway/Browserbase deploy — see §5.

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

What has **not** been validated, and cannot be from this environment:

- An actual Browserbase session connecting to Metro and getting past whatever bot-protection triggered the original block. This is the one open question that matters — everything else in the driver is either pure logic (validated above) or a mechanical repetition of already-proven Playwright interaction patterns (the search→click→extract→back loop, confirmed live via manual browser recon in this session, just not yet run through this exact code path).
- The `Download into PDF` capture (`page.waitForEvent('download')`) against the real portal — the download mechanics themselves weren't in question (standard Playwright), but haven't been exercised end-to-end here.
- Real-world timing/reliability of the per-item search/click/back loop across the full ~70-item list (rate limiting, ADF session behavior under sustained use).

## 5. Recommendation

**Metro is not blocked. It is untested on the transport that matters, and ready for deployment-based validation.** Do not repeat the manual interactive recon (§1 is fully answered) or attempt further local validation (no credentials here, and no reason to risk further WAF interaction from this sandbox). Next step: enable `scan_enabled` on the seeded (currently disabled) source and run one manual scan through the Railway worker, or otherwise trigger `lacmta_scan` in an environment where `BROWSERBASE_API_KEY`/`BROWSERBASE_PROJECT_ID` are configured, and confirm candidates are created correctly end-to-end — the same validation checklist DPW used (`docs/handoff/2026-07-01-lacounty-dpw-agency-expansion.md` §6 gives the general shape). Only flip `scan_enabled`/`refresh_enabled` to `true` in the migration after that passes.
