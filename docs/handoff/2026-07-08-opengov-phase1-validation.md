# OpenGov Phase 1 — Live Production Validation (PASSED)

**Date:** 2026-07-08
**Driver commit:** `44db5b7` (deployed to Railway as ancestor of `183803d`, service `bidbox`, 6 replicas / sfo)
**Environment:** production Supabase + Railway worker + Browserbase (real credentials)
**Outcome:** ✅ **PASSED** — 125 CA construction candidates discovered and inserted, 0 errors. Source **enabled**.

---

## Runbook results

| # | Task | Result |
|---|---|---|
| 1 | Migration applied | ✅ Applied live via service role (pure DML: `opportunity_sources` + `portal_drivers` upserts). Source `id=703886d3-1a13-4c1f-9f29-97936e49bd65`. |
| 2 | Source disabled before validation | ✅ Seeded `scan_enabled=false` / `refresh_enabled=false`. |
| 3 | Railway env vars present | ✅ `OPENGOV_EMAIL`, `OPENGOV_PASSWORD`, `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` all set on service `bidbox`. |
| 4 | Worker deployed with the driver | ✅ Deployed commit `183803d` includes `44db5b7` (opengov.js present, 7 `opengov_scan` refs in index.js). Railway auto-deployed from GitHub. |
| 5 | One controlled scan | ✅ Queued one `opengov_scan` task (`f7df4178`); ran `00:59:50 → 01:02:05` UTC (~2m15s). |
| 6 | Discovery validation | ✅ See below. |
| 7 | Dashboards | ✅ Source health `complete`; portal_type-driven Coverage/Health/Driver views show opengov (1 source, 125 opportunities). |
| 8 | No regressions | ✅ Other drivers' `document_prefetch` tasks kept completing normally before/during/after (00:57→01:03). |

## Task 6 — discovery validation (all criteria met)

- **Browserbase/session auth succeeded** — scan completed with `errors: 0`; no auth failure.
- **`POST /api/v1/auth/login` worked** in the page context (discovery returned data, which requires an authenticated session).
- **Category snapshot resolution succeeded** — NAICS/NIGP/UNSPSC sets resolved from structural rules.
- **All three taxonomy searches ran** — sample candidates carry categories from NIGP (`91200`, `91400`), consulting (`918xx`), and engineering (`925xx`) classes.
- **Deduped by stable OpenGov project id** — 125 unique candidates (`found:125, new:125, refreshed:0`).
- **Inserted into `opportunity_candidates`** — 125 rows, `portal_type='opengov'`.
- **Scale ≈ Tier-1 benchmark** — **125** vs ~128 expected (within portal-drift tolerance).
- **Task result:** `{ found:125, new:125, errors:0, phase:'opengov_discovery_v1', document_acquisition_supported:false }`.

### Candidate count: **125**

### 5 sample inserted candidates

1. **Facilities Condition Assessment (FCA) & Asset Management — Sacramento County Dept of Airports** · County of Sacramento · due 2026-09-08 · bid `2026-WW-03` · `/portal/saccounty/projects/281692` · desc 1746 chars · cats: Aviation/Buildings/Engineering Consulting.
2. **Design-Build Wayfinding Enhancement TP-1006 — Specialties (Digital Signs)** · San Francisco Airport (Construction) · due 2026-07-18 · bid `11962.66 TP - 1006` · `/portal/sfoconstruction/projects/281144` · desc 2233 · cats: Electronic Signs / Construction Services General (91200) / Trade (91400).
3. **Design-Build Wayfinding TP-1005 — Paint** · San Francisco Airport (Construction) · due 2026-07-18 · bid `11962.66 TP - 1005` · `/portal/sfoconstruction/projects/281140` · cats: Paint & Varnish / Construction General / Trade.
4. **Design-Build Wayfinding TP-1004 — Metals / Signage Metal Frames** · San Francisco Airport (Construction) · due 2026-07-18 · bid `11962.66 TP - 1004` · `/portal/sfoconstruction/projects/281128` · cats: Airport Signage / Construction General / Trade.
5. **RFP — Civil Engineering for Fern Drive Bridge Replacement** · County of Santa Cruz · due 2026-07-29 · bid `P40353` · `/portal/santacruzcounty/projects/279995` · desc 831 · cats: Bridges / Bridge Engineering / Civil Engineering.

Every sample has: title, agency, bid due date, source URL, OpenGov project id, cleaned portal bid id, department, description, category metadata (code+title), agency website/state, and full `crawl_data` with `extraction_method='opengov_v1_api_discovery'`, `document_acquisition_supported=false`.

## Observed data-quality notes (not defects)

- **Recall-over-precision, by design.** A minority of candidates are professional-services / specialty-trade adjacent (e.g. the airport FCA "Asset Management" consulting, or single-trade design-build packages like Paint/Metals) rather than heavy horizontal/vertical construction. These come from Tier-1 NIGP consulting/trade classes and are intentionally **not** filtered in the driver — the qualification engine decides relevance (per Phase 1 scope). No action needed; note for when qualification tuning is revisited.
- **`county` is null** on candidates — not present in the list payload; it is populated by Phase 2 detail enrichment (`serviceAreas`). `project_address` (agency city/state/zip) is populated as a partial locality signal in the meantime.
- **`financialId` formatting varies** by agency (`2026-WW-03`, `11962.66 TP - 1006`, `P40353`); trailing punctuation is cleaned. The stable dedup key is the integer OpenGov project id (in `crawl_data.opengov_project_id` and the `source_url`), not `financialId`.

## Post-validation state

- OpenGov source **ENABLED** (`scan_enabled=true`, `refresh_enabled=true`) — joins the nightly refresh cadence (24h).
- The 125 new candidates auto-queued `portal_intelligence` (lightweight summary) and `document_prefetch` (opengov no-op, Phase 3) per standard OML behavior; the no-op prefetch completes cleanly.

## Remaining future work (unchanged)

- **Phase 3 — Document Acquisition:** pre-signed S3 URLs in the detail payload (`attachments[].url`) → `opportunity-documents`; swap the `document_prefetch` no-op for the real acquirer. The Phase 2 document manifest (below) already tells it exactly what to fetch.

---

# OpenGov Phase 2 — Project Detail Enrichment (PASSED, 2026-07-08)

**Driver commit:** `57bc4fb` (auto-deployed to Railway; `SUCCESS`).
**Approach:** inline enrichment — after discovery, `GET /api/v1/project/:id` for every candidate in the same authenticated session (bounded concurrency `OPENGOV_DETAIL_CONCURRENCY=6`, per-project error isolation → degrade to list-only, never drop a candidate). Metadata only; **no document bytes** (Phase 3).

**Validation scan:** one controlled `opengov_scan` (`7bf9b2dd`) → `found:125, refreshed:125, new:0, errors:0` (all existing candidates updated in place with enriched `crawl_data`; dedup by project id held — no new/dupe rows).

**Enrichment coverage (all 125 candidates):**

| Field | Coverage |
|---|---|
| `detail_enriched` / `extraction_method=opengov_v2_api_detail` | 125 / 125 |
| primary contact (name, title, email, phone, locality) | 125 / 125 |
| procurement contact | 125 / 125 |
| timeline (milestone names + dates) | 125 / 125 |
| pre-bid / job-walk date | 54 / 125 (only projects that hold one) |
| document manifest (≥1 doc) | 113 / 125 — **730 documents catalogued** |

**Enriched sample highlights:**
- *Anaheim — Athletic Field Maintenance:* contact Steve Ballard (Parks Superintendent, phone/email), procurement Ariana Hernandez, **pre-bid 2026-07-17 with full job-walk site addresses** (La Palma Park / Delphi / Yorba), 4 documents.
- *Orange County Sanitation District — 3-60 Construction:* contact + procurement, pre-bid outreach event 2026-03-31 with registration details, document manifest.
- *County of Sacramento — Airport FCA:* contact William Wallace, Pre-Proposal Conference 2026-07-28, 5-document manifest.

**Data-quality notes / corrections:**
- **OpenGov detail has NO county/serviceArea field** (that was a Cal eProcure pattern; the Phase 1 note was wrong). `county` stays null; locality is carried via `agency` + contact/org city/state. This is a portal limitation, not a driver defect.
- Document manifest stores metadata only (`id`, `shared_id`, `filename`, `file_extension`, `type`) — the expiring pre-signed `url` is intentionally omitted (re-derived fresh in Phase 3).
- No regressions: other drivers' `document_prefetch` tasks kept completing throughout (01:16–01:18 UTC).

---

# OpenGov Phase 2.5 — Portal-Visible Metadata (ACCEPTED, 2026-07-08)

**Status:** ✅ Complete, deployed, production-validated, and **accepted**. OpenGov Phase 1 + Phase 2 + Phase 2.5 are all done.

## Accepted scope (§4.1 of the proposal)
Parsing-only over the `GET /api/v1/project/:id` payload Phase 2 already fetches — **no new API calls, no DOM scraping, no browser navigation, no document work.** Implemented:
- **Native bid items** from `priceTables[].priceItems[]` → persisted to `opportunity_bid_items` (`source_portal='opengov'`, `extraction_method='portal_tab'`) via the existing `bid_items.js` helper. **Bid Items card lights up with zero UI change.**
- **Engineer's estimate** parsed from `criteria[].description` → promoted to typed `estimated_value` when confident.
- **Solicitation / project number** → promoted to `portal_bid_id` when confidently parsed.
- **Corrected addenda** from `addendums[]` (`number, title, description excerpt, released_at, status, has_changes`) — fixed a Phase 2 shape bug.
- **Section index + capped scope excerpt** + bond/pre-bid/planholder flags, under `crawl_data.opengov_visible_metadata`.
- `portal_intelligence` regenerates `portal_summary` from the enriched data automatically (no summary-generator change).

## Final accepted commits
- `00626de` — OpenGov Phase 2.5 implementation.
- `465d5e9` — HTML-strip parser fix (estimate/solicitation): OpenGov `criteria` descriptions are HTML; `&rsquo;`/tags broke the first parse. Added `stripHtml()` before parsing; reordered solicitation patterns so the full `NN-IFB-NNN` wins and bare short numerics (e.g. `029`) are rejected.

## Validation tasks (accepted)
- `8f9a004b-b900-4318-bc61-8bd6e05ccfad` — first Phase 2.5 validation (bid items ✓; surfaced the two HTML parser bugs).
- `b1aa79ff-ce42-4068-8e1e-fd585ee38cec` — parser-fix re-validation on `465d5e9` (both bad fields corrected).

Both were single, controlled `opengov_scan` runs (priority 5, source-only), `found:125 / refreshed:125 / errors:0`.

## Force Main acceptance results (`275299`, West County Wastewater)
- `estimated_value = 1361000` ✓ (was null → fixed; `$1,361,000`)
- `portal_bid_id = 26-IFB-029` ✓ (was garbage `029` → fixed)
- `opportunity_bid_items` = **8 rows** (Mobilization LS, Site A Launch Assembly, Site B Plug Valve, Site D Receive Assembly, potholing 5a/5b) — Bid Items card no longer shows "No native bid items available."
- addenda = 3 (corrected shape, `has_changes` set) · sections = 9 · regression intact (contacts, procurement, timeline, pre-bid, 9-doc manifest, `portal_summary` regenerated).

## Pasadena & San Mateo validation notes
- **Pasadena Fence `268037`:** `estimated_value` honestly **null** (as-needed IFB, no engineer's estimate in the notice); solicitation parsed correctly → `2026-IFB-LM-0328`; **21 bid items**; 19 sections; regression intact.
- **San Mateo Paving `277456`:** `estimated_value` honestly **null**; solicitation honestly null (`portal_bid_id=E5074` from the `financialId` fallback); **0 bid items** — honestly none (project states "DO NOT submit bids in OpenGov"; no price table); 10 sections; regression intact.
- The honest-null cases confirm the parser extracts when present and cleanly returns null when absent — no false positives.

## Guardrails (both runs)
- **No document acquisition triggered.** `document_prefetch` tasks created = **0**; `opportunity_documents` rows for opengov = **0**; no storage uploads.
- Queue stayed clean (empty before and after each run); no global scan; no other portals (Cal eProcure / PlanetBids / Caltrans / LA County DPW) touched.

## Explicitly deferred (not implemented; require new scope)
- **Phase 3 — document acquisition** (pre-signed S3 `attachments[].url` → `opportunity-documents`). The Phase 2 manifest + Phase 2.5 counts already catalog what to fetch.
- **Q&A thread extraction** — served by a separate (unidentified) endpoint, not in the detail payload.
- **Followers / planholders extraction** — separate gated endpoint **and** a privacy decision (vendor contact info); do not ingest without product/privacy sign-off.

*OpenGov work is paused here. No further OpenGov scans or changes without a new explicit scope.*
