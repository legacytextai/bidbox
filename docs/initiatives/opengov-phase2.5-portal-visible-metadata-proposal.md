# OpenGov Phase 2.5 — Portal-Visible Metadata Enrichment (ACCEPTED / COMPLETE)

**Date:** 2026-07-08
**Status:** ✅ **Accepted, implemented, deployed, production-validated.** Commits `00626de` (implementation) + `465d5e9` (HTML-strip parser fix). Validation tasks `8f9a004b…` + `b1aa79ff…`. Full acceptance record: `docs/handoff/2026-07-08-opengov-phase1-validation.md` (Phase 2.5 section). This document is retained as the design/rationale of record.
**Scope:** OpenGov driver only. Not Cal eProcure / PlanetBids / Caltrans / LA County. Not document acquisition (Phase 3). Not full Opportunity Intelligence. Not UI redesign. Not global scan behavior.
**Builds on:** `bidbox-worker/drivers/opengov.js` (Phase 1 discovery + Phase 2 API detail enrichment, both live & validated — `docs/handoff/2026-07-08-opengov-phase1-validation.md`).

---

## 1. Summary of the observed gap

Manual QA found that BidBox shows `Estimated Value: N/A`, `Solicitation No: N/A`, `Job Walk/Pre-Bid: N/A`, and **"No native bid items available"** for OpenGov projects whose portal pages clearly expose that information — e.g. *Force Main Assessment Civil Work* (West County Wastewater, project `275299`) shows an **engineer's estimate of $1,361,000**, a **mandatory pre-bid conference**, a rendered **Schedule of Bid** line-item table, scope of work, and 3 addenda. Phase 2 captured contacts/timeline/pre-bid/document-manifest from the API, but not this richer body content.

## 2. What Phase 2 currently captures (confirmed by code inspection)

`fetchProjectDetails()` calls `GET /api/v1/project/:id` per candidate and merges into `crawl_data`: primary + procurement `contact`, `pre_bid` (text/location/date), `timeline` (`timelineConfig`), `documents` manifest (attachments), `addenda` manifest, and `flags`. It does **not** download bytes. `estimated_value`, bid items, solicitation number, scope, and full addenda fields are **not** captured.

**Two Phase 2 defects this proposal also corrects:**
- **Addenda shape mismatch.** Phase 2 runs `addendums` through the *attachment* manifest shape (`{id, sharedId, name, title, filename, fileExtension, type}`). Real `addendums[]` are `{number, title, titleDisplay, description, releasedAt, status, type, isNotice, diff}` — so Phase 2 stored `number/description/releasedAt/status/diff` as null and `filename` as null. 2.5 extracts the correct shape.
- **`portal_bid_id`.** Currently the cleaned `financialId` (e.g. `26-IFB-029` lives in body text, not `financialId`); 2.5 can promote the true solicitation number when present.

## 3. Findings from live API investigation (the decisive result)

**Everything estimator-facing is already inside the `GET /api/v1/project/:id` payload Phase 2 already fetches.** The portal "tabs" are SPA views over that one payload — the sub-tab endpoints I probed (`/document`, `/sections`, `/questions`, `/followers`, …) all return `404`. So Phase 2.5 is **deeper extraction of a payload we already have — no new API calls, no DOM scraping, no `?section=` fetches.** (The rendered DOM is actually *worse*: the Schedule of Bid renders as `<div>`s, `document.querySelectorAll('table').length === 0`.)

Exact field paths, verified live on project `275299`:

| Data | Field path in `project/:id` | Shape |
|---|---|---|
| **Native bid items** | **`priceTables[].priceItems[]`** | **Structured.** `{lineItem, description, quantity, unitToMeasure, unitPrice, total, orderById, isHeaderRow, taxable}`. Table self-describes columns via `headerLineItem/Description/Quantity/UnitToMeasure/UnitPrice/Total` + `columnOrder`. Verified sample: `{lineItem:1, description:"Mobilization and demobilization…", quantity:1, unitToMeasure:"LS"}` (2 tables × 4 items = 8). `specifyUnitPrice:false` → unit price is bidder-supplied (blank in solicitation; we capture the **schedule**, not prices). |
| **Engineer's estimate** | `criteria[]` (title "Notice") `.description` (also echoed in `upfrontQuestions[].inputData.value`) | Free text — `$1,361,000` sits in the Notice body; needs a bounded currency regex. |
| **Document sections** | `projectSections[]` (+ `projectSubsections[]`) | Structure: 9 sections (Notice to Bidders, Instruction to Bidders, **Schedule of Bid**, **Scope of Work**, Contract Award, Terms & Conditions, Vendor Questionnaire, Attachments), each `{title, shortName, orderById, section_type, subsection_type}`. Body prose is embedded in the same payload (`criteria`/`priceTables`/questionnaire nodes). |
| **Addenda** | `addendums[]` | Full: `{number, title, titleDisplay, description, releasedAt, status, type, isNotice, diff}`. `diff` is the "See What Changed" payload. 3 on this project. |
| **Pre-bid / job walk** | `preProposalText/Location/Date` (already in Phase 2) | Present. |
| **Scope of work** | Scope section body within the payload | Extractable as text (bounded). |
| **Vendor questionnaire** | `upfrontQuestions[] / questionnaires[] / questionLogics[]` | The bidder-facing form (not the public Q&A thread). |

**Not in the detail payload (require separate, unidentified endpoints):**
- **Public Q&A thread** (the "Bid Bond" / "Mandatory PreBid Meeting" questions+agency answers). Absent from `project/:id`; `upfrontQuestions`/`questionnaires` are the *vendor questionnaire*, a different thing. My direct endpoint probes 404'd.
- **Planholder / follower list.** `followers` is empty (`0`) in the detail even though `showPlanholders:true` and the portal lists real planholders (Bay Area Builders Exchange, Con-Quest, …). Served by a separate gated endpoint.

## 4. Recommended Phase 2.5 scope

Because the high-value data is free (already-fetched payload), the recommendation is to **extract it inline in the existing Phase 2 detail step** — same `fetchProjectDetails` call, more parsing, near-zero added runtime. Q&A and planholders (separate endpoints + privacy) are deferred.

### 4.1 Accepted (implement in 2.5)
1. **Native bid items — first-class.** Extract `priceTables[].priceItems[]` → structured bid-items with `{line_item, description, quantity, unit_of_measure, unit_price, total, source_section:"Schedule of Bid", price_table_title}`. Populate whatever powers the BidBox **Bid Items** card (see §5/§7). Cap at a sane max (e.g. 500 items across tables) with a truncation flag.
2. **Engineer's estimate → `estimated_value`.** Bounded currency regex over `criteria[].description` (title ~"Notice") + questionnaire echo; store both the parsed number (typed `estimated_value`) and the raw matched string + source in `crawl_data`. Conservative: only promote when a single unambiguous "$X … estimate" match is found; otherwise leave null + store candidates for review.
3. **Solicitation number → `portal_bid_id`.** Promote the true project number (e.g. `26-IFB-029`) when parseable from `criteria`/Notice; fall back to current behavior.
4. **Addenda (corrected).** `addendums[]` → `{number, title, description(excerpt, capped), released_at, status, has_changes:Boolean(diff)}` + `addenda_count`. Fixes the Phase 2 shape bug.
5. **Section index + scope excerpt.** Capture `projectSections[]` titles/order (cheap map) and a **capped Scope of Work excerpt** (e.g. first ~1,500 chars) for the lightweight summary. Skip Terms & Conditions body by default.
6. **Bond / pre-bid-mandatory signals** where cheaply parseable from Notice/Instruction text (bid bond %, performance/payment bond, mandatory pre-bid Y/N) — best-effort, stored as flags, never fabricated.
7. **Regenerate `portal_summary`** from API detail + the new visible metadata (estimator-facing one-paragraph, same as other portals).

### 4.2 Explicitly deferred (not in 2.5)
- **Public Q&A thread** — separate endpoint (unidentified), lower priority. Propose a small follow-up spike if wanted.
- **Planholder/follower list** — separate gated endpoint **and** a privacy decision (contains vendor contact info). Recommend: **do not ingest contact info**; if pursued later, count-only or names-only, per product/privacy policy. Investigate separately.
- **Liquidated damages / license requirements / contract duration** — only if they appear as reliably-parseable fields; otherwise leave for full Opportunity Intelligence (F4) over downloaded docs. Do not brittle-parse.
- **County** — genuinely absent on OpenGov (confirmed Phase 2). Stays null.

## 5. Data-model / `crawl_data` shape proposal

No schema migration required for the metadata. Add under `crawl_data`:

```jsonc
crawl_data.opengov_visible_metadata = {
  estimated_value: 1361000,               // parsed; also promoted to typed column when confident
  estimated_value_raw: "$1,361,000",
  estimated_value_source: "criteria:Notice",
  solicitation_number: "26-IFB-029",
  bond_requirements: { bid_bond: null, performance_bond: null, payment_bond: null },
  pre_bid_mandatory: true,
  sections: [{ title, short_name, order, section_type }],   // index only
  scope_excerpt: "…capped ~1500 chars…",
  bid_items: [                             // also feeds the Bid Items card (see §7)
    { line_item:1, description:"Mobilization…", quantity:1, unit_of_measure:"LS",
      unit_price:null, total:null, price_table_title:"…", source_section:"Schedule of Bid" }
  ],
  bid_items_truncated: false,
  addenda: [{ number, title, description_excerpt, released_at, status, has_changes }],
  extraction_method: "opengov_v2_5_visible_metadata",
  extracted_at: "…"
}
```

**Bid items** should additionally flow into whatever existing structure powers the Bid Items card. §7 open question: confirm whether that is `opportunity_bid_items` rows (as PlanetBids uses) or a `crawl_data` field the UI reads. If it's `opportunity_bid_items`, 2.5 writes those rows directly (metadata only, `source='opengov_price_table'`), reusing the existing card with zero UI change.

## 6. Worker / runtime impact

Near-zero. Phase 2 already fetches the full 683 KB `project/:id` payload for every candidate; 2.5 adds **pure in-process parsing** of fields already in memory — no new HTTP calls, no DOM, no browser navigation. Bounded by: cap bid items (~500), cap scope excerpt (~1,500 chars), cap addenda description excerpts, skip Terms & Conditions body. Estimated added time per project: **single-digit milliseconds.** No change to scan concurrency or the 6-replica queue behavior.

## 7. Open questions

1. **Bid Items data path — RESOLVED (repo-verified).** The Bid Items card renders from the **`opportunity_bid_items`** table (read via `useOpportunityDossier` / `opportunityView` / `OpportunityOverviewTab`). `bidbox-worker/drivers/bid_items.js` already exposes a reusable normalize-and-insert helper keyed by `extraction_method` (`portal_tab` / `document_table` / `document_ai` / `manual` / `import`; delete+reinsert per method). OpenGov `priceItems` map **directly** onto the schema:
   `item_number←lineItem, description←description, unit_of_measure←unitToMeasure, quantity←quantity, unit_price←unitPrice, section_name←price table title/"Schedule of Bid", source_portal←'opengov', extraction_method←'portal_tab' (portal-native table)`.
   → 2.5 reuses that helper to write `opportunity_bid_items` rows; **the Bid Items card lights up with zero UI change.** This is the cleanest possible path and confirms the whole approach.
2. **`estimated_value` promotion confidence:** acceptable false-positive rate for auto-promoting a parsed estimate to the typed column vs. keeping it review-only?
3. **`portal_summary` regeneration:** regenerate inline in the driver, or leave to the existing `portal_intelligence` task (which already runs per candidate and could read the new `crawl_data`)? Leaning: let `portal_intelligence` consume it — no driver change to summary generation.

## 8. Failure handling

Per-field, non-fatal: any parse failure (estimate regex, price table, addenda) is caught and that field is left null with a recorded note — never drops a candidate, never fails the scan (same discipline as Phase 2's per-project isolation). If `priceTables` is absent/misshaped, bid items are simply empty (correct for projects with no schedule). Enrichment is env-gated (`OPENGOV_VISIBLE_METADATA`, default on) so it can be disabled without redeploy.

## 9. Validation plan (post-approval)

Re-scan (refresh) and verify on 4 known projects spanning shapes:
1. **Force Main Assessment Civil Work / West County Wastewater (`275299`)** — **must** show `estimated_value ≈ 1,361,000`, **8 bid items** extracted (Mobilization / Launch / Plug Valve / Receive / Potholing), 3 addenda with `has_changes`, and BidBox **no longer showing "No native bid items available."** (Primary acceptance case.)
2. **Fence Repair and Installation / Pasadena (`268037`)** — as-needed services IFB: sections + summary; confirm graceful handling if no price table.
3. **A San Mateo County project (`277456`)** — different agency/template; note it says "DO NOT submit bids in OpenGov," so confirm we still extract estimate/scope where present.
4. **One SFO design-build trade package** (e.g. `281144`) — confirm the no-document / minimal-schedule case degrades cleanly.

Acceptance per project: correct bid-item count & columns; estimate parsed or honestly null; addenda corrected; no regression to Phase 1/2 fields; no scan errors; other drivers unaffected.

## 10. Implementation task list (on approval)

1. Add `extractVisibleMetadata(projectDetail)` to `opengov.js`: `priceTables[].priceItems[]`→bid-items mapper, estimate/solicitation parser (`criteria[].description`), addenda-shape fix, section index + capped scope excerpt, bond/pre-bid signals.
2. Merge into `buildCandidate` under `crawl_data.opengov_visible_metadata`; promote `estimated_value` (confident) + `portal_bid_id` (when parsed).
3. Write bid items to **`opportunity_bid_items`** via the existing `bid_items.js` insert helper (`source_portal='opengov'`, `extraction_method='portal_tab'`, metadata only) — wire into `runScan`/`persistScannedCandidate` follow-on the same way PlanetBids bid items are persisted. **No UI change.**
4. Env gate `OPENGOV_VISIBLE_METADATA` (default on); caps as in §6.
5. Local logic tests (fixtures from `275299`, `268037`); `node --check`.
6. Commit, push, Railway auto-deploy; controlled re-scan; §9 validation; report.

## 11. Risks & open questions

- **Estimate parsing false positives** (dollar amounts in body text that aren't the engineer's estimate) → conservative single-match rule + raw string + review path.
- **Price-table variability** across agencies/templates (alt-bid schedules, multiple tables, header rows) → map defensively using the table's own `header*`/`columnOrder`; store `price_table_title` + `source_section` for traceability; `isHeaderRow` items skipped.
- **Bid Items card contract unknown** (Open Q#1) — must confirm before writing rows.
- **Q&A / planholders** deliberately out — flag if product wants a follow-up spike (Q&A) and a privacy decision (planholders) before any ingestion.
- **`priceItems` blank prices are correct** (bidder-supplied) — set expectation that OpenGov bid items are quantity/UOM schedules, not priced.

---

### Bottom line
Phase 2.5 is unusually cheap and high-value: the engineer's estimate and a **fully structured Schedule-of-Bid line-item table** are already sitting in the payload Phase 2 fetches (`criteria[].description` and `priceTables[].priceItems[]`), so native bid items and estimated value become first-class with parsing only — no new requests, no DOM, no downloads. Q&A and planholders are the only genuinely separate concerns and are deferred. **Recommend approving §4.1 as scoped; I'll resolve Open Question #1 first, then implement.**
