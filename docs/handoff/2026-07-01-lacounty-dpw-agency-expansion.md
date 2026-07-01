# BidBox Engineering Handoff — LA County DPW Agency Expansion

**Date:** 2026-07-01  
**Branch:** `phase1-opportunity-intelligence`  
**Head commit:** `8b39158`  
**Scope:** Agency expansion only — LA County Department of Public Works  
**Status:** Live reconnaissance completed 2026-07-01. No driver code written. No source configured. **See Section 0 for verified findings — it supersedes the assumptions in Sections 2–8 wherever they conflict.**

---

## 0. LIVE RECONNAISSANCE FINDINGS — VERIFIED (2026-07-01)

*This section records what was directly observed by fetching the live portal on 2026-07-01. Everything here is a **verified fact** unless explicitly labeled inference/hypothesis. Where it contradicts the original assumption-based sections below, this section wins.*

### 0.1 Authoritative entry point — CONFIRMED (RAMPLA not needed)

- **Native listing URL:** `https://dpw.lacounty.gov/contracts/Opportunities.aspx` ("Business Opportunities").
- It is a **single unified listing covering all divisions and all opportunity types** — building, infrastructure/construction, professional services, purchasing, sundry services — in one table. There is **no** need to scrape multiple per-division pages. Current live total: **21 rows**.
- The page is **fully server-rendered HTML**. All 21 rows (name, ID, description snippet, open date, close date, and the exact detail-page href) are present in the initial GET response. No JavaScript execution required to read the listing.
- **RAMPLA is ruled out as the source of truth.** `www.rampla.org` is a **Salesforce Experience Cloud SPA** (`server: sfdcedge`, 301 → `/s/`), i.e. JS-rendered and harder to scrape. The native DPW portal is authoritative, complete, and simpler. RAMPLA offers no advantage and should be ignored for the DPW driver.

### 0.2 Listing structure, filters, pagination — CONFIRMED

- Tech stack: **Microsoft-IIS/10.0, ASP.NET 4.0.30319, WebForms** (`__VIEWSTATE`, `__doPostBack`, single server `<form>`). Client-side **DataTables** handles pagination/search over rows already present in the HTML.
- **No JSON/XHR/API endpoint exists.** Explicitly checked for `.ashx/.asmx/.json/.svc` — none. Data acquisition = parse the server-rendered HTML table. There is no shortcut API to prefer over scraping.
- **Two filter dropdowns** drive the listing via WebForms postback:
  - `main_ddlProjectType` (Type): `All = CONS,AEDBID,AEDRFP,ASDRFP,RFB` · `AEDBID = Building Projects` · `CONS = Infrastructure Projects` · `AEDRFP = Professional Services` · `RFB = Purchasing Opportunities` · `ASDRFP = Sundry Services`.
  - `main_ddlPhase` (Status): `CURRENTLY ADVERTISED = Open` · `UPCOMING = Upcoming` · `PENDING AWARD = Closed` · `AWARDED = Awarded` · `STATUS = All`.
- **Filtering requires a postback** (POST with `__VIEWSTATE` + the ddl values), not a GET query param. However, the **default GET returns the current open/advertised set directly** (the 21 rows observed), which is sufficient for the primary use case (surfacing open bids). Retrieving `AWARDED`/`PENDING AWARD` (bid results) would require simulating the postback — deferrable.

### 0.3 Project types → detail templates — CONFIRMED

There are **five project types**, each routed to one of **four detail-page templates**. The listing row carries the **exact relative href**, so the driver must **follow the href, not reconstruct URLs from the ID prefix**:

| Type code | Listing label | Detail template (relative href) | Verified example |
|---|---|---|---|
| `AEDBID` | Building Projects | `aed_bid/ProjectDetail.aspx?project_id=` | BRC0000681 ✔ |
| `CONS` | Infrastructure Projects | `cons/ProjectDetailAdv.aspx?project_id=` | RDC0015913 ✔ |
| `ASDRFP` | Sundry Services | `asd_rfp/ProjectDetail.aspx?project_id=` | BRC0000209 ✔ |
| `RFB` | Purchasing | `rfb/ProjectDetail.aspx?project_id=` | RFB-IS-26201059 ✔ (200, not rendered) |
| `AEDRFP` | Professional Services | `aed_rfp/ProjectDetail.aspx?project_id=` (**inferred** by symmetry — verify) | none observed live |

- Note the two detail templates: `ProjectDetail.aspx` (aed_bid / asd_rfp / rfb / aed_rfp) vs `ProjectDetailAdv.aspx` (cons only). They expose **different field sets** (see 0.4).

### 0.4 Identifiers and metadata — CONFIRMED

- **`project_id` is the stable primary key** and is **not** limited to the `BRC` prefix. Prefixes observed live: `BRC`, `RDC`, `RMD`, `RMDJOC`, `TDS`, `WRDM`, `RFB-IS`. **IDs can contain hyphens** (`RFB-IS-26201059`) — the driver must treat `project_id` as an opaque string, not `^[A-Z]{3}\d+$`.
- **Prefix does not determine the detail path** — e.g. `BRC` appears under both `aed_bid` and `asd_rfp`. Only the listing href is authoritative for routing.
- **`project_id` ≠ Spec No.** The AEDBID page for `project_id=BRC0000681` shows `Spec No: 7918` as a separate agency-facing number. Both may be worth storing.
- **Field vocabularies differ per template** (three confirmed):
  - **AEDBID (`aed_bid`):** Spec No · Project Name · Description · Open Date · Proposers Conference(s) *(date, mandatory/non-mandatory flag, address)* · Closing Date *(date + time)* · Contact (Name/Phone/Email) · Estimate ($) · Bid Package From Cashier (Price / Price w/Postage) · Category (Prime/Sub/Supplier/Other) · Documents.
  - **CONS (`cons` / ProjectDetailAdv):** Project ID · Federal No · Project Name · Project Limit *(often Google Maps URLs)* · Scope · Advertise Date · **Bid Opening Date** · Cities/Communities · Contact · Category · **Addenda (separate section)** · Documents table with **Document / Notes / Pages / Size** columns.
  - **ASDRFP (`asd_rfp`):** Project ID · Project Name · RFP Issue Date · **Proposal Due Date** *(can be a non-date string like "Open Continuously")* · Proposers Conference Date *(or "N/A")* · Contact · Estimate · Category · Documents *(addenda listed inline, e.g. "Addendum A")*.
- **Implication:** normalization to OML columns needs **per-template field mapping** and **tolerant date parsing** (must handle "Open Continuously", "N/A", `M/D/YYYY`, and `MM/DD/YYYY HH:MM AM/PM`). The "close/due" field is named differently per template (Closing Date / Bid Opening Date / Proposal Due Date).

### 0.5 Documents — GATED behind SSO (biggest constraint)

- On every template, the project-specific document links (Plans, Project Manual, Special Provisions, Bid Proposal, RFSQ, Addendum A, etc.) **do not point to PDFs**. They point to `../OpportunitiesNewRegister.aspx?project_type=<TYPE>&project_id=<ID>`, which **302-redirects to LA County SSO**: `https://app.pw.lacounty.gov/adm/uamsso/home/SignIn`. **Downloading bid documents requires an authenticated LA County vendor/SSO session.**
- Some rows are explicitly marked `* Only available for registered users`.
- **Document *metadata* is public even though the files are gated** — the CONS template lists each document's title, notes, page count, and file size (e.g. "Special Provisions … 601 pages … 70.82 Mb"; "Plans … 38 pages … 21.74 Mb") directly in the page HTML. Portal intelligence can use this without ever authenticating.
- Only **generic reference PDFs** (Standard Plans, BMP/SWPPP manuals, Bid Bond form, etc.) are directly downloadable (e.g. `/general/forms/download/3449.pdf`). These are **boilerplate, not project bid packages** — not useful for project intelligence.
- **Bid submission is electronic-only via Bid Express** (`www.bidexpress.com`); paper bids are not accepted. **Open question / lead:** Bid Express often hosts the actual plan room — it may be an alternative, possibly less-gated, document source than the DPW SSO. Not yet investigated.
- **Plan-holder lists are public** (no login): `.../PlanHolders.aspx?plan_type=PRIME|SUB|SUPPLY|PLANROOM&project_type=<TYPE>&project_id=<ID>` — usable competitive intelligence.

### 0.6 Anti-bot / access behavior — CONFIRMED (with caveat)

- The site sits behind **Imperva/Incapsula** WAF (`X-CDN: Imperva`, `visid_incap_*` / `incap_ses_*` cookies, `X-Iinfo` header).
- **Plain `curl` with a realistic desktop User-Agent passed cleanly** — HTTP 200 on ~12 requests including a **rapid-fire burst of 4 detail pages across all templates back-to-back**, no CAPTCHA, no JS challenge, sub-3s responses. No cookie/session priming was required for read access.
- **Caveat / risk:** Imperva is in low-friction mode *now* and can escalate to JS/CAPTCHA challenges under sustained load or reputation changes. A production scan should use a **realistic browser fingerprint, polite rate limiting, and a Browserbase/real-browser fallback** if challenged. HTTP-first is viable for the read path today; do not assume it is permanent.

### 0.7 Architectural takeaways for a reusable "agency-direct" pattern

1. **Listing-href-driven crawl.** The reusable pattern is: fetch the listing, parse each row into `{ detail_href, name, id, open_date, close_date, description }`, then fetch each `detail_href`. Do **not** template-construct detail URLs from IDs. This generalizes to any agency-direct portal that renders a listing with per-row links.
2. **Template-dispatched field extraction.** Detail parsing should dispatch on the detail path/template and use a **label→value map** per template, storing raw label/value pairs in `crawl_data` and normalizing to OML columns via a tolerant mapper. This isolates per-agency/per-template quirks from the pipeline.
3. **Two-tier document model.** Separate (a) **public document metadata** (always scrapeable) from (b) **gated file acquisition** (needs auth). BidBox can ship portal intelligence from (a) immediately; (b) is a distinct, decision-gated workstream. This tier split will recur for other agency-direct portals.
4. **HTTP-first, browser-fallback.** Server-rendered + no API + light WAF means a plain authenticated `fetch` (undici/got) likely suffices for the scan path; reserve Browserbase for WAF escalation and for the eventual authenticated document flow. This is cheaper than routing every request through a headless browser.

---

## 1. Objective

### What We Are Trying to Do

BidBox currently ingests opportunities from two portal types: **PlanetBids** (76 configured agencies) and **Caltrans** (one source). Both have working scan drivers, document acquisition drivers, and are wired into the full pipeline.

The next expansion workstream adds a third portal type: **LA County Department of Public Works** — a custom-built agency portal not hosted on any third-party procurement platform. This is the first "agency-direct" source in BidBox.

The immediate goal is to build a scan driver that:
1. Discovers open/active bids on the LA County DPW portal.
2. Extracts structured metadata per project (title, bid number, bid due date, estimate, agency division, scope).
3. Creates `opportunity_candidates` rows in Supabase.
4. Feeds those candidates into the existing portal intelligence → document prefetch → project intelligence pipeline.

### Why LA County DPW Is Strategically Important

LA County Department of Public Works is one of the largest public works agencies in California. It oversees roads, bridges, flood control, sewer systems, parks, and facilities across unincorporated LA County — a geographic footprint larger than most US cities. Contract volume is substantial. Construction bid sizes tend to be large. Bid dates and scopes are well-structured because the agency has formal procurement procedures.

From an estimator's perspective, LA County DPW bids are high-priority. Missing one is costly. Having BidBox surface them automatically — with portal summaries, bid items, and project intelligence — is direct product value for any GC operating in Southern California.

The OML architecture doc (`docs/initiatives/oml-opportunity-metadata-layer.md`) explicitly notes that a manual walkthrough of "PlanetBids, Caltrans, LA County DPW, LACDA, and RAMPLA" was conducted during OML design. LA County DPW was confirmed to expose enough metadata at the portal detail page level to support OML-grade intelligence without requiring document analysis.

### How It Fits the Source Acquisition Strategy

The agent architecture roadmap (`docs/agent-architecture-task-list.md`, section 6.4, E3) defines the expansion priority order:

```
E3 — New Driver Per Portal Type (PLANNED)
├── Cal eProcure (Caltrans/state)
├── Bonfire
├── OpenGov
├── Periscope/BidSync or DemandStar
└── Agency-direct drivers for high-value custom portals:
    └── LA County ← this workstream
        LA County MTA (LACMTA)
        LADWP
```

LA County DPW is the lead target for the agency-direct driver pattern. Whatever driver architecture we establish for LA County DPW will serve as the template for LACMTA, LADWP, and other high-value agencies that operate their own procurement systems.

---

## 2. Current Understanding of the Portal

### How We Got There

The navigation path traced manually was:

```
RAMPLA (rampla.org)
  → LA County Solicitations listing
    → LA County Department of Public Works project detail
      → dpw.lacounty.gov
```

RAMPLA (`rampla.org`) is a procurement aggregator for Los Angeles region agencies. It surfaces active solicitations from multiple LA County departments in a unified listing. Following a DPW solicitation from RAMPLA leads to the actual project detail page on the DPW's own domain.

### Portal Domain and Stack

- **Domain:** `dpw.lacounty.gov`
- **Technology:** Microsoft ASP.NET — confirmed by `.aspx` file extension in the detail page path.
- **Hosting:** LA County government infrastructure. Not a third-party SaaS platform.
- **Platform type:** Agency-direct / custom-built. No PlanetBids, Bonfire, OpenGov, BidSync, or DemandStar branding observed.

This is significant: unlike PlanetBids where all 76 agencies share one driver, this portal is specific to LA County DPW. A driver for it will not generalize to other agencies unless they happen to use the same LA County government platform.

### Project Detail Page

**Confirmed URL pattern:**
```
https://dpw.lacounty.gov/contracts/aed_bid/ProjectDetail.aspx?project_id=BRC0000681
```

**URL structure breakdown:**
- Base: `https://dpw.lacounty.gov`
- Path: `/contracts/aed_bid/ProjectDetail.aspx`
- Query parameter: `project_id=BRC0000681`

**Project ID format:** Alphanumeric with a prefix. The observed example is `BRC0000681`. The `BRC` prefix likely denotes a division or contract category (possibly "Bridge," "Building, Roads & Construction," or similar internal LA County code). The numeric portion (`0000681`) is zero-padded, suggesting a sequential integer ID.

**ID stability:** The `project_id` query parameter appears to be the primary stable identifier for each project. This is a good sign — it means detail page URLs are bookmarkable and deterministic rather than session-dependent.

**What the `/contracts/aed_bid/` path suggests:** "AED" likely refers to the Architectural Engineering Division or a similar internal department grouping. There may be other path prefixes for other divisions (e.g., `/contracts/road_bid/`, `/contracts/flood_bid/`) — this is unconfirmed.

### Metadata Available (Observed)

From the manual walkthrough, the OML doc confirms that project detail pages expose sufficient metadata for OML-grade intelligence. Expected fields based on what was observed and what the portal type implies:

| Field | Availability |
|---|---|
| Project title | Present |
| Project/contract number | Present (the `project_id` value) |
| Bid due date | Present |
| Agency division | Present (LA County DPW) |
| Estimated value / engineer's estimate | Likely present (standard for public works) |
| Project location / county | Present (all are LA County) |
| Scope / description | Likely present |
| License requirements | Unknown |
| Pre-bid / job walk info | Unknown |
| Addenda | Unknown |
| Bid documents / attachments | Unknown — see section 5 |

Fields marked "Unknown" were not confirmed during the walkthrough documented in this session.

### Document Access

**Unknown.** Whether documents are publicly accessible without login, require agency vendor registration, or require a specific plan-holder registration was not confirmed. This is the highest-priority unknown for implementation.

### Authentication

**Appears not required for the project detail page itself.** The URL `https://dpw.lacounty.gov/contracts/aed_bid/ProjectDetail.aspx?project_id=BRC0000681` is publicly accessible — metadata is visible without login. Document downloads may have different requirements. Unconfirmed.

### Listing Page

**Unknown.** We navigated to individual project detail pages via RAMPLA. The native listing page on `dpw.lacounty.gov` that shows all active bids has not been directly examined. Two approaches to listing discovery are possible:
1. Scrape RAMPLA's LA County DPW listing as the entry point.
2. Find and scrape the native DPW listing page directly on `dpw.lacounty.gov`.

Both paths are viable but neither has been confirmed or mapped.

---

## 3. Previous Investigation

*This section reads as field notes from what was explored.*

### What Was Confirmed

- **RAMPLA exists and aggregates LA County DPW solicitations.** The system already recognizes `rampla.org` as a portal type in `src/lib/platformDetection.ts` (type `'ramp'`) and in `supabase/functions/crawl-project/index.ts`. The pattern `/rampla\.org/i` was added to platform detection at some point in the project's history, suggesting RAMPLA was examined before as a potential data source.

- **LA County DPW was manually walked through during OML design.** The OML initiative doc (`docs/initiatives/oml-opportunity-metadata-layer.md`) lists LA County DPW explicitly as one of the portals examined: *"Manual walkthroughs of PlanetBids, Caltrans, LA County DPW, LACDA, and RAMPLA confirmed that the information visible on a portal detail page — title, agency, bid due date, estimated value, county, scope text — is sufficient for a human estimating coordinator to decide whether to spend an hour pursuing a project."* This means someone on the team has seen the portal detail page and confirmed it contains OML-grade metadata.

- **The portal is custom/agency-direct.** LA County DPW is explicitly listed in the E3 roadmap entry as an "agency-direct driver for high-value custom portals" — not a known SaaS platform. The `.aspx` URL confirms ASP.NET stack.

- **The example project URL is stable and real:**
  ```
  https://dpw.lacounty.gov/contracts/aed_bid/ProjectDetail.aspx?project_id=BRC0000681
  ```

- **RAMPLA is the navigation bridge.** The procurement flow RAMPLA → LA County Solicitations → LA County DPW was traced manually in this session. RAMPLA appears to aggregate multiple LA County department solicitations and link to their native portals.

### What Was Ruled Out

- **LA County DPW is not on PlanetBids.** Confirmed — no PlanetBids portal ID exists for LA County DPW in any migration or source ledger entry.
- **LA County DPW is not Caltrans.** Different agency, different portal, different data model.
- **The existing RAMPLA platform detection pattern does not have a worker driver.** `grep -r "rampla" bidbox-worker/` returns no results. RAMPLA is recognized in the frontend/edge function platform detection layer but has never been implemented as a scan driver.

### What Was Not Confirmed

- The native DPW listing URL (the page on dpw.lacounty.gov that lists all active bids).
- Whether pagination exists and how it works.
- Whether documents require authentication.
- Whether RAMPLA's listing is complete (i.e., does it show all active DPW bids or only a subset?).
- What other path prefixes exist beyond `/contracts/aed_bid/` (e.g., whether there are separate sections for roads, bridges, flood control).
- The full set of metadata fields on the project detail page.
- Whether an API or structured data endpoint exists behind the ASP.NET UI.

### Hypotheses Not Yet Tested

1. **RAMPLA may be the easier entry point than dpw.lacounty.gov directly.** RAMPLA aggregates LA County solicitations into a structured listing. If RAMPLA provides structured HTML with project IDs, titles, dates, and links to dpw.lacounty.gov, it may be a cleaner scrape target than finding the native DPW listing page.

2. **The `BRC` prefix in `BRC0000681` likely denotes a contract category or division.** LA County DPW manages multiple engineering programs. There may be separate listing pages per division (Bridge, Road, Flood Control, Buildings, etc.) rather than a single unified listing.

3. **ASP.NET portals sometimes expose ViewState-dependent pagination.** If the DPW listing uses ASP.NET WebForms with `__VIEWSTATE` POST parameters, pagination may require simulating form submissions rather than simple GET requests with page number parameters. Playwright/Browserbase would handle this; a simple `fetch` loop would not.

4. **Documents are likely publicly accessible without login** for most LA County DPW bids, since this is a large public agency subject to California public records requirements. However, some sensitive attachments (NDA-controlled drawings, hazmat reports) may require registration. Unconfirmed.

---

## 4. Proposed Driver Architecture

*Based only on what is confirmed. Architecture may change significantly after reconnaissance completes.*

### Pattern: Follows Caltrans, Not PlanetBids

The Caltrans driver (`bidbox-worker/drivers/caltrans.js` for scan, `bidbox-worker/drivers/caltrans_documents.js` for document acquisition) is the closest existing analog. Both Caltrans and LA County DPW are:
- Custom portals (not PlanetBids)
- Accessed via URL-based project IDs
- Scraped with Playwright/Browserbase
- Expected to have structured metadata on detail pages

The PlanetBids driver uses PlanetBids's internal JSON API. LA County DPW almost certainly has no equivalent public API. Scraping will be required.

### Expected File Structure

```
bidbox-worker/drivers/
  lacounty_dpw.js          ← scan driver: listing → candidates
  lacounty_dpw_documents.js ← document driver: detail page → PDFs
```

### Worker Task Types (New)

Two new task types will need to be added to the worker routing table in `bidbox-worker/index.js`:

```javascript
// Current known types:
// 'planetbids_scan' | 'caltrans_scan' | 'bid_item_scan' | 'portal_intelligence'
// 'document_prefetch' | 'project_analysis' | 'document_processing' | 'project_intelligence'

// New types to add:
'lacounty_dpw_scan'        ← scan driver
```

`document_prefetch` already routes by `candidate.portal_type` (`planetbids` → planetbids_documents, `caltrans` → caltrans_documents). A new `portal_type = 'lacounty_dpw'` branch would be added there.

### Likely Crawler Entry Point

Two candidates — final choice depends on reconnaissance:

**Option A — Scrape RAMPLA's LA County DPW listing:**
```
https://www.rampla.org/
  → filter/navigate to "Los Angeles County" or "Department of Public Works"
  → extract project links pointing to dpw.lacounty.gov
  → follow each link to extract detail metadata
```

**Option B — Scrape dpw.lacounty.gov listing directly:**
```
https://dpw.lacounty.gov/contracts/aed_bid/ (or similar listing path)
  → extract project rows (title, project_id, bid date)
  → follow each to ProjectDetail.aspx?project_id=XXX
  → extract full metadata
```

Option B is preferable if the native listing exists and is stable, because it avoids depending on a third-party aggregator (RAMPLA) that could change structure or drop projects. Option A may be necessary if no single native listing covers all DPW divisions.

### Project Detail Extraction

For each project, navigate to:
```
https://dpw.lacounty.gov/contracts/aed_bid/ProjectDetail.aspx?project_id={id}
```

Extract via DOM scraping (Playwright):
- Project title
- Project ID / contract number (from URL or page)
- Bid due date
- Engineer's estimate
- Project location
- Scope / description
- Division / department
- Pre-bid / job walk details (if present)
- Document links (if present on the page)

Store all raw fields in `crawl_data` JSONB. Normalize to OML columns (`raw_title`, `agency`, `bid_due_at`, `estimated_value`, `county`, `project_address`) via the existing `persistScannedCandidate()` worker function.

### Document Acquisition

**Architecture unknown — depends on reconnaissance.** If documents are linked directly on the detail page as public PDFs:

```javascript
// lacounty_dpw_documents.js pattern
// Navigate to detail page
// Find document links (likely in a "Bid Documents" or "Attachments" section)
// Download each file
// Upload to opportunity-documents bucket
// Write to opportunity_documents table
```

If documents require plan holder registration or login, the driver would need to handle that flow before downloading — similar to how the PlanetBids driver handles prospective bidder registration.

### Bid Items

**Unlikely to be available as structured data** on the detail page. LA County DPW is not PlanetBids; there is no bid items tab. Bid items would only become available after document acquisition (from the bid schedule PDF), through the existing F3 document processing pipeline. No portal-native bid item extraction is expected.

### Expected Worker Task Flow (After Implementation)

```
lacounty_dpw_scan task
  → lacounty_dpw.js driver runs
  → navigates to listing page
  → extracts project IDs and metadata
  → persistScannedCandidate() for each
    → portal_intelligence task auto-queued
    → document_prefetch task auto-queued
```

```
document_prefetch task (portal_type = 'lacounty_dpw')
  → lacounty_dpw_documents.js driver runs
  → navigates to ProjectDetail.aspx
  → downloads PDFs
  → uploads to opportunity-documents storage
```

---

## 5. Unknowns Remaining

*Updated 2026-07-01 after live recon. `[x]` = resolved (see Section 0), `[ ]` = still open. Most structural blockers are now resolved; the remaining open items are dominated by the authenticated document-acquisition flow.*

### Portal Structure
- [x] **Native listing URL.** `https://dpw.lacounty.gov/contracts/Opportunities.aspx` — a single unified page across all divisions/types (0.1).
- [x] **Path prefix coverage.** One listing covers all types; detail pages route to 4 templates (`aed_bid`, `cons`, `asd_rfp`, `rfb`, plus inferred `aed_rfp`) by type, not by division path (0.3).
- [x] **Pagination.** Server-rendered rows + client-side DataTables; the default GET returns the full open set in one response. Filtering (to change status/type) is a WebForms **postback**, not a GET param (0.2).
- [x] **Sort and filter options.** `main_ddlProjectType` (5 type codes) and `main_ddlPhase` (Open/Upcoming/Closed/Awarded/All) — values enumerated in 0.2.
- [x] **Listing data density.** Rows include name, ID, description snippet, open date, close date, and the exact detail href (0.1).

### Project IDs and URL Stability
- [~] **ID prefix meaning.** Prefixes are diverse (`BRC`, `RDC`, `RMD`, `RMDJOC`, `TDS`, `WRDM`, `RFB-IS`) and **do not** determine the detail path; exact semantics of each prefix not decoded, but no longer needed for routing (0.4).
- [ ] **ID sequence gaps.** Not investigated (irrelevant to the href-driven crawl — we never enumerate IDs).
- [x] **ID universality.** `project_id` is the stable key and can contain hyphens; `Spec No` is a separate agency number on AEDBID pages (0.4).

### Metadata Fields
- [x] **Full field inventory.** Three template vocabularies documented (AEDBID / CONS / ASDRFP) in 0.4. `rfb` and `aed_rfp` field sets still need a rendered pass.
- [x] **Field format.** Flat pages (no tabs/accordions); dates are human-readable strings in mixed formats incl. non-dates ("Open Continuously", "N/A"); estimate is a formatted `$` string — tolerant parsing required (0.4).

### Document Access
- [x] **Are bid documents publicly accessible?** No — project-specific docs require LA County SSO login (0.5).
- [x] **Document link structure.** Links point to `OpportunitiesNewRegister.aspx?project_type=&project_id=` → 302 to `app.pw.lacounty.gov/adm/uamsso` SSO (0.5).
- [x] **Document URL pattern.** The register/redirect URL is deterministic from `project_type`+`project_id`; the actual file URL is behind auth and not yet observed.
- [ ] **Registration gate — full flow.** Is SSO vendor registration free / self-service? Account-wide or per-project? What is required to create it? **This is the top implementation blocker for document acquisition** (0.5).
- [ ] **Bid Express as alt document source.** Bid Express (bidexpress.com) is the mandated bid-submission channel and often hosts the plan room — investigate whether documents are obtainable there, possibly with less friction than DPW SSO (0.5).
- [x] **Addenda.** Handling differs per template: CONS has a dedicated "Addenda" section; ASDRFP lists addenda inline in the Documents list (0.4/0.5).

### Anti-Bot and Rate Limiting
- [x] **Anti-bot protections.** Imperva/Incapsula WAF present but passes plain requests (with realistic UA) at 200, no CAPTCHA/JS challenge across a rapid-fire burst (0.6).
- [ ] **Rate limiting ceiling.** Behavior under sustained/high-volume load not tested; Imperva may escalate — needs a load-aware test before production cadence is finalized (0.6).
- [x] **Session requirements.** No cookie/session priming needed for read access; SSO session only needed for document downloads (0.5/0.6).

### RAMPLA as Entry Point
- [x] **RAMPLA — all four questions.** Resolved by ruling RAMPLA out: it is a Salesforce Experience Cloud SPA and offers no advantage over the complete, server-rendered native listing. Do not use it for the DPW driver (0.1).

### Other
- [~] **Bid results.** `AWARDED` / `PENDING AWARD` phases exist and are reachable via postback; award amounts/winner content not yet inspected. Deferrable, potentially valuable later (0.2).
- [x] **Amendment / addendum tracking.** Reflected on the detail page (see Addenda above).
- [x] **Contact information.** Each project lists a contact person (Name/Phone/Email) — available for the portal summary (0.4).

---

## 6. Recommended Next Investigation Session

**Goal: Complete reconnaissance. Do not write driver code until every item in section 5 is answered.**

### Step 1 — Map the Native Listing Page (15 minutes)

Navigate to `dpw.lacounty.gov` and find the contracts/solicitations section without going through RAMPLA.

```
Try these paths:
  https://dpw.lacounty.gov/contracts/
  https://dpw.lacounty.gov/contracts/aed_bid/
  https://dpw.lacounty.gov/bids/
  https://dpw.lacounty.gov/solicitations/
```

Goals:
- Find the page that lists active open bids.
- Identify whether there is one unified listing or multiple per division.
- Record the exact URL of each listing page found.
- Note whether the page loads with JavaScript or is server-rendered HTML.

### Step 2 — Inspect the Listing Page Structure (20 minutes)

On the listing page(s) found in Step 1:

- Open browser DevTools → Network tab.
- Reload the page. Look for XHR/Fetch requests to any JSON or XML endpoint. If one exists, that is the API — record the URL and response format.
- If no API: inspect the HTML DOM. Is the project list a `<table>`, `<ul>`, or `<div>` structure?
- Record: column headers, number of rows visible, whether dates and estimates are in the list or only on detail pages.
- Scroll to the bottom. Is there pagination? Record the pagination mechanism (next/prev links? dropdown? ViewState form?).
- Try loading page 2 if pagination exists. Record whether it is a GET parameter or requires POST.

### Step 3 — Inspect a Project Detail Page (20 minutes)

Navigate to the confirmed example:
```
https://dpw.lacounty.gov/contracts/aed_bid/ProjectDetail.aspx?project_id=BRC0000681
```

- Record every visible field and its label.
- Check whether any field is inside a tab, accordion, or expandable section.
- Look for: engineer's estimate, bid due date, pre-bid/job walk, license type, project location, working days, liquidated damages, scope.
- Look for a "Documents" or "Bid Package" section. Are there file links? Click one — does it download directly or prompt login?
- Open DevTools Network tab. Reload the page. Look for API calls (JSON/XML). ASP.NET pages sometimes call `.aspx/MethodName` endpoints via `__doPostBack` or ScriptManager.
- Check the page source (Ctrl+U) for any hidden data attributes containing project metadata.

### Step 4 — Test Document Download Without Login (10 minutes)

On the detail page from Step 3:

- Without logging in to anything, attempt to click a document link.
- Record what happens: direct PDF download, login redirect, registration wall, or error.
- If a login redirect occurs: note the URL of the login page and what information is required.
- If a registration wall: note whether it is a plan-holder registration, vendor registration, or a simple email-entry form.

### Step 5 — Examine RAMPLA as an Entry Point (15 minutes)

Navigate to `rampla.org` and find the LA County DPW solicitations listing.

- Record the URL of the RAMPLA page that shows DPW solicitations.
- Note the HTML structure of the listing (table? card grid? list?).
- Confirm whether RAMPLA entries link directly to `dpw.lacounty.gov` or to RAMPLA intermediate pages.
- Compare the number of active DPW projects on RAMPLA vs. the native DPW listing (if found in Step 1). If counts differ, RAMPLA may not be complete.

### Step 6 — Check ID Prefix Coverage (10 minutes)

From the listing page(s), check whether all project IDs use the `BRC` prefix or if other prefixes appear. Record all distinct prefixes observed. If multiple prefixes exist for different divisions, check whether they all use the same `/contracts/aed_bid/ProjectDetail.aspx` path or different paths.

### Step 7 — Test Anti-Bot Behavior (5 minutes)

In a new incognito window (no cookies), load:
1. The listing page.
2. Two or three detail pages in rapid succession.

Observe: do any CAPTCHAs appear? Are any requests blocked? Does the page respond normally?

### Step 8 — Document Findings

After completing Steps 1–7, update this document with confirmed answers to every item in section 5 before any driver code is written.

---

## 7. Future Integration Plan

*Grounded in what BidBox's existing architecture requires. This is a planning skeleton — not a spec.*

### `opportunity_sources` Table

One new row needs to be inserted. Schema of `opportunity_sources`:

```sql
id                  uuid (auto)
name                text          -- "LA County Department of Public Works"
portal_type         text          -- 'lacounty_dpw'  ← new portal type
listing_url         text          -- listing page URL (TBD from reconnaissance)
scan_enabled        boolean       -- true
scan_interval_hours integer       -- 24 (default)
refresh_enabled     boolean       -- true (added in OML)
refresh_cadence_hours integer     -- 24
```

The `portal_type` string `'lacounty_dpw'` will need to be added as a recognized value in:
- `supabase/functions/refresh-opportunities/index.ts` — `resolveTaskType()` function currently handles only `'planetbids'` and `'caltrans'`.
- `bidbox-worker/index.js` — task type routing.

### `refresh-opportunities` Edge Function

**File:** `supabase/functions/refresh-opportunities/index.ts`

The `resolveTaskType()` function must be extended:

```typescript
// Current:
function resolveTaskType(portalType: string): TaskType | null {
  if (portalType === "planetbids") return "planetbids_scan";
  if (portalType === "caltrans") return "caltrans_scan";
  return null;
}

// After:
function resolveTaskType(portalType: string): TaskType | null {
  if (portalType === "planetbids") return "planetbids_scan";
  if (portalType === "caltrans") return "caltrans_scan";
  if (portalType === "lacounty_dpw") return "lacounty_dpw_scan";  // new
  return null;
}
```

The `TaskType` union and the `.in("task_type", [...])` active-task check must also include `"lacounty_dpw_scan"`.

### Worker Task Router

**File:** `bidbox-worker/index.js`

The `task_type` routing block:

```javascript
// Current routing:
if (task.task_type === 'planetbids_scan') { ... }
else if (task.task_type === 'caltrans_scan') { ... }
else if (task.task_type === 'bid_item_scan') { ... }
// ...

// New branch to add:
else if (task.task_type === 'lacounty_dpw_scan') {
  // call lacounty_dpw.js driver
}
```

The `document_prefetch` handler already routes by `candidate.portal_type`:

```javascript
if (candidate.portal_type === 'planetbids') { ... }
else if (candidate.portal_type === 'caltrans') { ... }
// Add:
else if (candidate.portal_type === 'lacounty_dpw') {
  // call lacounty_dpw_documents.js driver
}
```

The claimed task type list in the worker poll query must also include `'lacounty_dpw_scan'`.

### Scan Driver

**New file:** `bidbox-worker/drivers/lacounty_dpw.js`

Responsibilities:
- Accept `{ source_id, source_name, listing_url, portal_type }` from task payload.
- Navigate to listing page with Playwright/Browserbase.
- Paginate through all active bids.
- For each project: extract metadata and call `persistScannedCandidate()`.
- Return `{ candidates_found, candidates_new, candidates_updated }` result shape (matches existing scan driver conventions).

### Document Acquisition Driver

**New file:** `bidbox-worker/drivers/lacounty_dpw_documents.js`

Responsibilities:
- Accept candidate with `source_url` pointing to `ProjectDetail.aspx?project_id=XXX`.
- Navigate to detail page.
- Find document links.
- Download each document.
- Upload to `opportunity-documents` Supabase Storage bucket.
- Write records to `opportunity_documents` table.

Architecture details depend entirely on what reconnaissance reveals about document access and URL structure.

### Platform Detection

**File:** `src/lib/platformDetection.ts` and `supabase/functions/crawl-project/index.ts`

A `'lacounty_dpw'` portal type should be added to the `PortalType` union and `PORTAL_PATTERNS` array:

```typescript
{
  type: 'lacounty_dpw',
  patterns: [
    /dpw\.lacounty\.gov/i,
    /lacounty\.gov.*contracts/i,
  ],
}
```

This enables platform detection for any `source_url` on the DPW domain.

### Portal Intelligence

No changes needed. `portal_intelligence.js` is portal-agnostic — it takes `candidate.crawl_data` and OML columns and generates a summary. As long as `crawl_data` is populated correctly by the scan driver, portal intelligence will work.

### Project Intelligence

No changes needed. `project_intelligence.js` (F4) operates on acquired PDF documents. As long as the document acquisition driver uploads correctly to `opportunity-documents` and writes `opportunity_documents` rows, F4 will work.

### Bid Items

No portal-native bid item extraction is expected. If bid items are present in the bid schedule PDF, the existing `bid_items.js` driver (F3, document processing) may be able to extract them post-acquisition. No driver changes needed.

---

## 8. Open Questions

Every question here must be answered before a single line of driver code is written.

### Architecture-Deciding Questions

1. **Is there a native DPW listing page?** If yes, does it list all active solicitations across all divisions in one place, or must we scrape multiple division-specific pages?

2. **Is RAMPLA a reliable and complete source for DPW solicitations?** If RAMPLA aggregates all DPW bids and provides structured links to `dpw.lacounty.gov`, it may be the better entry point — but only if it is reliably complete. A RAMPLA-sourced driver would also potentially enable scraping of other LA County departments from the same driver.

3. **Do documents require authentication?** This determines whether the document acquisition driver needs a login flow or can download directly.

4. **Is there a hidden JSON API?** ASP.NET portals sometimes have AJAX endpoints (`PageMethods`, `WebServices`, `ScriptManager`) that expose structured data. If one exists, it would be far more reliable than DOM scraping.

### Implementation-Blocking Questions

5. **What is the exact listing URL?** Cannot implement the scan driver without it.

6. **What is the pagination mechanism?** GET param vs. ViewState POST changes the implementation significantly.

7. **Do all DPW bids use the `/contracts/aed_bid/` path?** If other paths exist, the driver needs to handle them or multiple sources need to be configured.

8. **What `project_id` prefixes exist beyond `BRC`?** The driver needs to handle all valid formats.

9. **What fields are present on the detail page?** Needed to write the metadata extraction logic.

10. **Is the page server-rendered or JavaScript-rendered?** Determines whether `fetch` + HTML parsing is sufficient or whether Playwright is required for the detail page (it is almost certainly required for the listing page).

### Operational Questions

11. **Does the portal have rate limiting or bot detection?** Determines whether Browserbase session management needs delays or rotation.

12. **How frequently does LA County DPW post new solicitations?** Determines whether 24-hour scan cadence is appropriate or should be adjusted.

13. **What is RAMPLA's relationship to LA County DPW?** Is RAMPLA an official channel, a third-party aggregator, or a government-run aggregator? Its reliability as a scan entry point depends on this.

14. **Should RAMPLA be a separate `opportunity_source` row with its own driver, or should the LA County DPW driver go directly to `dpw.lacounty.gov`?** This is an architectural decision that depends on whether RAMPLA covers DPW completely and whether we want to eventually use RAMPLA to discover other LA County department solicitations.

---

*End of handoff report. Next action: complete reconnaissance per section 6 before writing any code.*
