# Source-Health Failure Investigation — 2026-07-15

**Status:** Investigation only. No code, data, tasks, scans, commits, pushes, deployments, publications, or migrations were changed.
**Author:** Automated investigation (read-only production evidence + code trace).
**Scope:** 22 PlanetBids "Failed" sources, 2 "Stale" sources (California eProcure, Elsinore Valley), source-health status logic, and actual data impact.

---

## 1. Executive Summary

The Source Health dashboard is **materially overstating severity**. The underlying data pipeline is largely healthy.

- **The "22-source PlanetBids outage" is not a single outage.** It is two different things wearing the same error string:
  - **2 sources (City of Long Beach `portal/15810`, City of Los Angeles `portal/23749`) are genuinely broken** — their PlanetBids portal IDs are **persistently invalid**. Loading them (worker *and* a fresh browser, right now) returns *"This is not a valid PlanetBids agency portal."* These have **0 candidates** and have failed every recent run. This is a **source-configuration problem**, not a driver or portal outage.
  - **20 sources hit a transient blank-render failure** during the 2026-07-15 ~07:0X UTC (00:0X PT) nightly wave. Their portals are healthy (verified live: City of Anaheim shows **"Found 1025 bids"** right now), they hold existing candidates (many 40–60 open records), and **18 of the 20 were successfully refreshed <24h earlier** by the 2026-07-14 ~17:0X run. The next successful scan self-heals them.
- **Root cause of the shared error string:** the driver emits *"Listing data was observed, but no usable bid detail targets were found"* whenever `apiResponsesObserved > 0` **even if zero bids were actually detected** (`found_bids=n/a`, `tr_count=0`, `role_row_count=0`). It is a **false-positive "observed" signal** keyed on network activity, not on content. A blank/unhydrated SPA shell that still fired background XHRs trips it.
- **The source-health model conflates scan *quality* with *freshness*, and is latest-run-only + sticky.** A source that refreshed all its data at 17:0X and then hit one transient blank render at 00:0X is shown as **"Failed"** with **zero data loss**. `last_refresh_status = 'partial'` is bucketed into the same **"Stale"** state as genuine age-based staleness.
- **California eProcure is healthy, not stale.** Its last run refreshed **270/274 rows (98.5%)** — 5 new, 254 refreshed — and failed only 4 detail rows. It is shown "Stale" purely because `partial → warning`.
- **Elsinore Valley is healthy, not stale.** Its last run refreshed **59/60 rows**; a single dead detail target (bid `135122`, a PlanetBids error page) demoted the whole source to "Stale."

**Confirmed data loss: none from the 20 transient sources.** The only genuine gaps are the **2 invalid-portal sources** (which we have never had data for) and a small window of potentially-missed *new* postings that self-heals on the next scan.

---

## 2. Timeline (UTC)

| Time | Event |
|---|---|
| 2026-07-14 09:34–09:55 | Three PlanetBids commits land (`b4c2dab`, `3442453`, `11865c0`) — all **detail-navigation / row-click** hardening (downstream of row detection). |
| 2026-07-14 15:57 | `f134a3d` "Fix opportunity filter presentation…" (current HEAD). |
| 2026-07-14 ~17:00–17:16 | Evening scan wave: **PlanetBids sources succeed** (e.g., Anaheim 60, OC Sanitation 60, Chaffey 52, Val Verde 42 refreshed). Cal eProcure 288 found / 0 errors. |
| 2026-07-14 17:32 | Railway deployment `fd83d2de` goes live (current production). |
| 2026-07-15 07:01–07:24 | **Nightly cron wave.** 20 PlanetBids sources return blank/unhydrated listing pages → 0 rows → source status `failed`. 2 invalid-portal sources return `/2001` again. Cal eProcure: 270/274 (4 errors → partial). Elsinore: 59/60 (1 error → partial). Riverside-area PlanetBids controls (Redlands, Riverside, IEUA, Jurupa Valley), scanned 07:22–07:24, **succeed**. |
| 2026-07-15 ~15:00–16:00 | Dashboard observed: 57 healthy / 2 stale / 22 failed. Investigation performed (~9h after wave). |

---

## 3. Deployment & Commit Correlation

- **Deployed production commit** ≈ current HEAD `f134a3d` (committed 07-14 15:57, deployed as `fd83d2de` at 07-14 17:32). Railway service `bidbox`, project `supportive-truth`, env `production`, region `sfo`, **4 replicas**.
- The three 07-14 PlanetBids commits are **all ancestors of HEAD** (deployed), but **none touch the row-detection path or the error branch** that produced these failures:
  - `b4c2dab` — adds `waitForPlanetBidsDetailNavigation` (detail-page URL wait). Post-row-click only.
  - `3442453` — adds `openPlanetBidsRowWithRetry` (row-click retry). Post-row-detection only.
  - `11865c0` — adds a **bounded reload before failing** on empty listings. This actually makes the driver *more* tolerant.
- **Conclusion:** the failure wave is **not attributable to a code regression in the deploy.** The deploy predates the wave by ~13.5h, and the same code succeeded for these exact sources at 17:0X and for the control sources at 07:22–07:24. `bidbox-worker/drivers/planetbids.js` row-detection logic (`createBiddingRowsLocator`, `extractBidDetailUrlsFromPage`, `collectPlanetBidsApiDetailUrls`) was last meaningfully changed well before this window.

---

## 4. Source-Health Status Logic (exact rules)

**Computation is client-side**, in [`src/hooks/useAdminCoverage.ts`](../../src/hooks/useAdminCoverage.ts) `classifyHealth()` (lines 117–133). No SQL view / RPC — it reads columns off `opportunity_sources`:

```
lastActivityAt = max(last_scanned_at, last_refresh_completed_at)
if !scan_enabled                              -> disabled
if last_refresh_status === 'failed'           -> failed        (checked FIRST, sticky)
if !lastActivityAt                            -> never
interval = scan_interval_hours || 24
if age(lastActivityAt) > interval * 2         -> warning ("Stale")   [STALE_MULTIPLIER=2]
if last_refresh_status === 'partial'          -> warning ("Stale")
otherwise                                     -> healthy
```

**What sets `last_refresh_status`** — the worker, in [`bidbox-worker/index.js`](../../bidbox-worker/index.js) lines 858–872:

```
sourceStatus = errors > 0 && (new+refreshed+unchanged) > 0 ? 'partial'
             : errors > 0                                   ? 'failed'
             : 'complete'
```

Answers to the specific questions:

1. **What updates `last activity`** — `last_scanned_at` and `last_refresh_completed_at`, both stamped at the **end of every run**, success or failure (index.js 866–867). Even a fully-failed run updates them.
2. **What counts as a completed scan** — the driver returning without throwing. The `agent_tasks.status` is `complete` even when the *source* status is `failed` (confirmed: all 22 failed sources have `agent_tasks.status = 'complete'`).
3. **Does partial success count as successful activity** — Yes for freshness (`last_refresh_completed_at` is stamped), **No for status** (it is labeled `partial` → **warning/Stale**).
4. **Can one failed detail target make a source stale/failed** — **Yes.** `errors > 0` with ≥1 persisted candidate → `partial` → **Stale**. This is exactly Elsinore (1/60) and Cal eProcure (4/274).
5. **`2 × scan interval` threshold** — `scan_interval_hours (default 24) × STALE_MULTIPLIER(2)` = 48h of no activity → warning. (Not the cause of any current Stale; both Stale sources are `partial`, not aged.)
6. **Status basis** — the **latest run only**, via the source's `last_refresh_*` columns. Not "latest successful," not aggregated. A newer failed/partial run overwrites an older success.
7. **Do old errors persist after a later success** — `last_refresh_error` is overwritten each run (set to `null` at start, repopulated at end). So the displayed error is always the latest run's — but because status is latest-run-only, a transient blip hides a prior success.
8. **Does the dashboard conflate quality with freshness** — **Yes.** `partial` (mostly-successful) shares the "Stale" bucket with genuine age-staleness, and a single transient run flips a fresh source to "Failed."

---

## 5. Complete 22-Source PlanetBids Matrix

All rows share `found_bids=n/a`, `api_detail_links=0`, `dom_detail_links=0`, `tr_count=0`, `role_row_count=0`. `cand` = candidates in DB (total / future-due / refreshed-in-last-24h). Source `agent_tasks.status` for every row = `complete`; source `last_refresh_status` = `failed`. All triggered by `trigger_reason=nightly_cron` at 2026-07-15 ~07:0X UTC.

| # | Source | api/tr/role | found_bids | detail links (api/dom) | cand tot/future/r24h | Prior success (found@when) | Likely cause | True failure? |
|---:|---|---|---|---|---|---|---|---|
| 1 | City of Long Beach | 9/0/0 | n/a | 0/0 | 0/0/0 | none in last 5 | Invalid/stale portal ID (persistent) | Yes (config) |
| 2 | Port of Los Angeles | 6/0/0 | n/a | 0/0 | 1/1/1 | 1 @ 07-14T17:10 | Transient blank render | No (transient) |
| 3 | San Diego Unified School District | 6/0/0 | n/a | 0/0 | 21/8/0 | 9 @ 07-13T10:40 | Transient blank render | No (transient) |
| 4 | Santa Clarita Valley Water Agency | 6/0/0 | n/a | 0/0 | 2/0/1 | 1 @ 07-14T17:12 | Transient blank render | No (transient) |
| 5 | City of Los Angeles | 9/0/0 | n/a | 0/0 | 0/0/0 | none in last 5 | Invalid/stale portal ID (persistent) | Yes (config) |
| 6 | City of Newport Beach | 6/0/0 | n/a | 0/0 | 4/3/3 | 3 @ 07-14T16:59 | Transient blank render | No (transient) |
| 7 | City of Westlake Village | 6/0/0 | n/a | 0/0 | 34/0/0 | 34 @ 07-14T07:05 | Transient blank render | No (transient) |
| 8 | Orange County Sanitation District | 6/0/0 | n/a | 0/0 | 60/0/60 | 60 @ 07-14T17:13 | Transient blank render | No (transient) |
| 9 | City of Palm Springs | 6/0/0 | n/a | 0/0 | 3/3/3 | 3 @ 07-14T16:53 | Transient blank render | No (transient) |
| 10 | City of Carlsbad | 6/0/0 | n/a | 0/0 | 5/3/3 | 3 @ 07-14T16:30 | Transient blank render | No (transient) |
| 11 | Orange County Fire Authority | 6/0/0 | n/a | 0/0 | 2/1/2 | 2 @ 07-14T17:09 | Transient blank render | No (transient) |
| 12 | Val Verde Unified School District | 6/0/0 | n/a | 0/0 | 42/0/42 | 42 @ 07-14T17:16 | Transient blank render | No (transient) |
| 13 | City of Anaheim | 16/0/0 | n/a | 0/0 | 60/0/60 | 60 @ 07-14T16:49 | Transient blank render (portal live now: 1025 bids) | No (transient) |
| 14 | City of Diamond Bar | 6/0/0 | n/a | 0/0 | 62/2/2 | 2 @ 07-14T16:52 | Transient blank render | No (transient) |
| 15 | City of La Canada Flintridge | 6/0/0 | n/a | 0/0 | 1/1/1 | 1 @ 07-14T16:52 | Transient blank render | No (transient) |
| 16 | City of Gardena - GTrans | 6/0/0 | n/a | 0/0 | 60/0/60 | 60 @ 07-14T16:56 | Transient blank render | No (transient) |
| 17 | Los Angeles World Airports | 6/0/0 | n/a | 0/0 | 6/5/5 | 5 @ 07-14T17:08 | Transient blank render | No (transient) |
| 18 | City of Glendale | 6/0/0 | n/a | 0/0 | 8/7/5 | 5 @ 07-14T17:04 | Transient blank render | No (transient) |
| 19 | Santa Clarita Community College District | 6/0/0 | n/a | 0/0 | 23/0/23 | 23 @ 07-14T17:14 | Transient blank render | No (transient) |
| 20 | Burbank-Glendale-Pasadena Airport Authority | 6/0/0 | n/a | 0/0 | 61/1/1 | 1 @ 07-14T16:45 | Transient blank render | No (transient) |
| 21 | City of Burbank | 6/0/0 | n/a | 0/0 | 3/3/3 | 3 @ 07-14T16:31 | Transient blank render | No (transient) |
| 22 | Chaffey College | 6/0/0 | n/a | 0/0 | 52/0/52 | 52 @ 07-14T16:49 | Transient blank render | No (transient) |

**Aggregate:** 2 genuinely-broken (invalid portal) · 20 transient · **18/20 transient sources refreshed <24h earlier** · 12 sources still expose future-due open opportunities to users · only 2 (SD USD, Westlake Village) hold data not refreshed within 24h.

---

## 6. Healthy-Source Comparison

Four PlanetBids control sources (Riverside area), same driver, same nightly wave:

| Control | Status | Last run (found/errors @ UTC) | cand tot/fut/r24 |
|---|---|---|---|
| City of Redlands | complete | 4/0 @ 07-15T07:24 | 10/5/6 |
| City of Riverside | complete | 3/0 @ 07-15T07:23 | 11/8/5 |
| Inland Empire Utilities Agency | complete | 5/0 @ 07-15T07:22 | 5/5/5 |
| City of Jurupa Valley | complete | 1/0 @ 07-15T07:22 | 2/1/1 |

**First divergence point:** at **row detection**. Controls rendered the listing table (`tr_count`/rows > 0, `found > 0`); the failed 20 rendered a **blank body** (`tr_count=0`, `role_row_count=0`, blank `body_preview`) while background API calls still fired (`api_responses=6`). Same driver, same code path, same wave — the difference is whether the SPA listing table hydrated. The controls were scanned **07:22–07:24**, ~15–20 min *after* the failed cluster (**07:01–07:18**), consistent with a **transient condition early in the burst** (Browserbase session hydration stalls and/or PlanetBids throttling under concurrent load from 4 replicas) that had cleared by 07:22.

---

## 7. Root Cause of the Shared PlanetBids Error

**Error origin:** [`bidbox-worker/drivers/planetbids.js`](../../bidbox-worker/drivers/planetbids.js) lines 661–676.

**Preconditions to reach it** (all must hold):
1. `rowCount === 0` — the `biddingRows()` locator found no rows.
2. Not an explicit-empty portal — `noResultsText` false **and** `foundBidsCount !== 0` (line 611/637). A **blank body** satisfies this because there is no "no results" text and no parseable found-count.
3. After a bounded reload (added by `11865c0`), still 0 rows and **0 DOM + 0 API detail URLs**.
4. **The "observed" wording is chosen by:** `foundBidsCount !== null || apiResponsesObserved > 0` (line 662). With `found_bids=n/a` (`foundBidsCount === null`), the message fires **solely because `apiResponsesObserved > 0`.**

**So "Listing data was observed" is a false positive.** It reports on *network activity*, not detected bids. An unhydrated SPA shell that issued 6 background XHRs and rendered no table produces this exact message.

Two concrete sub-signatures in the raw telemetry:
- **Blank-render (20 sources):** `final_url` stays on `…/bo-search`, `api_responses=6` (Anaheim 16), `tr_count=0`, empty `body_preview`. Page shell loaded, table never hydrated.
- **Invalid portal (2 sources):** `final_url=https://vendors.planetbids.com/2001`, `body_preview = "This is not a valid PlanetBids agency portal…"`. **Reproduced live** for Long Beach `15810` and LA `23749` in a fresh browser — persistent, not transient.

**Answers to Task-5 sub-questions:**
- Does the driver distinguish closed/archived/informational/empty/pagination/placeholder/no-link/JS-click rows? Partially. It has a clean-empty exit (`noResultsText || foundBidsCount === 0`) and a DOM+API detail-URL fallback, but **a blank/unhydrated page bypasses the clean-empty exit** and lands in the error branch.
- Can it fire when a portal legitimately has no open bids? **Yes in principle**, but that is **not** what happened here — prior runs found 40–60 bids and the portals render bids live now.
- Is the recent click-target hardening rejecting legitimate rows? **No** — the hardening is entirely downstream of row detection; these failures never reach it (`rowCount === 0`).
- Did target IDs/URLs change format? **No** for the 20; **effectively yes** for the 2 invalid-portal sources (their portal IDs no longer resolve).
- Does one validation rule explain all 22? **No** — 20 are transient render, 2 are invalid config.

**Representative raw telemetry** (secrets-free):

- **City of Anaheim:** `api_responses=16; tr_count=0; role_row_count=0; found_bids=n/a; api_detail_links=0; dom_detail_links=0; Body preview: <blank>` — portal live now shows "Found 1025 bids."
- **City of Los Angeles:** `final_url=https://vendors.planetbids.com/2001; api_responses=9; …; Body preview: This is not a valid PlanetBids agency portal…`
- **City of Long Beach:** identical `/2001` signature, `api_responses=9`.
- **Port of Los Angeles:** `final_url=…/portal/42217/bo/bo-search; api_responses=6; tr_count=0; …; Body preview: <blank>`.
- **City of Carlsbad** (smaller agency): `api_responses=6; tr_count=0; …; Body preview: <blank>`; prior success 3 @ 07-14T16:30.
- **Healthy control (City of Riverside):** rendered table, `found=3`, `errors=0` @ 07-15T07:23.

---

## 8. California eProcure Analysis

- Family `caleprocure`, shown **Stale**. Driver: [`bidbox-worker/drivers/caleprocure.js`](../../bidbox-worker/drivers/caleprocure.js) line 2020 emits `Cal eProcure detail navigation failed for {failed}/{attempted} attempted row(s)`.
- **Last run (2026-07-15 07:42 UTC):** `found=270, new=5, refreshed=254, unchanged=11, errors=4` → `partial`. **270/274 = 98.5% success.**
- Candidates: **361 total, 273 future-due, 294 refreshed in last 24h.** Data is fresh and abundant.
- The 4 failed rows are detail-navigation failures (timeout/malformed/closed rows). New + refreshed candidates **were persisted** (5 new, 254 refreshed). The scan task `status = complete`.
- **Why "Stale":** solely because `last_refresh_status = 'partial'` → `classifyHealth` line 131 maps `partial → warning`. **This is a classification defect, not a real staleness.** (Note: the 07-14 07:32 run *did* have `errors=274`/`refreshed=0` — a real bad day — but it fully recovered at 17:34 with 0 errors. The current state is not that.)
- **Verdict: healthy/degraded, not stale.** 4 rows warrant a bounded retry, not a source-level demotion.

---

## 9. Elsinore Valley Analysis

- Family `planetbids`, shown **Stale**. Error: `portal_error_page: target_bid_id=135122; url=https://vendors.planetbids.com/portal/32069/bo/bo-detail/135122; render_wait_ms=27`. Emitted from planetbids.js line 219 / 1180–1185 (`waitForDetailReadiness` → `terminal_error` → `portal_error_page`).
- **Last run (2026-07-15 07:18 UTC):** `found=59, refreshed=59, errors=1, candidates_discovered=60` → `partial`. **59/60 rows succeeded.**
- Candidates: **60 total, 59 refreshed in last 24h.** Source is essentially fully refreshed.
- **Only one target failed** — bid `135122`. `render_wait_ms=27` (near-instant) indicates the detail page returned a **PlanetBids error page**, i.e., the bid is **removed / closed / redirecting** — a dead target, not a source problem.
- **Why "Stale":** the single dead target makes `errors=1` → `partial` → warning. **Same classification defect as Cal eProcure.**
- **Verdict: healthy.** Bid `135122` should be **quarantined/marked terminal** (the driver already has a quarantine path via `recovery_candidates`), not left to demote the source.

---

## 10. Data-Impact Assessment

**Confirmed facts:**
- **No candidates were deleted.** Existing opportunities remain visible to users.
- **18 of 20 transient sources were refreshed <24h earlier** (2026-07-14 ~17:0X). Their titles/due-dates are current.
- **Cal eProcure** refreshed 259 candidates (5 new + 254) on its "stale" run; **Elsinore** refreshed 59. Both effectively current.
- **2 invalid-portal sources (Long Beach, LA)** have **0 candidates** — we hold no data for them and have not for ≥2 days.
- **12 transient sources still expose future-due open opportunities** (e.g., Glendale 7, SD USD 8, LAWA 5).

**Inference:**
- **Missed *new* postings:** any solicitation newly posted between the 07-14 17:0X success and the next successful scan would be missed **temporarily** — a few-hour window that self-heals. PlanetBids "new" counts are typically 0 per run, so expected missed volume is **near zero**.
- **Mild staleness:** only **SD USD (21 cand)** and **Westlake Village (34 cand)** hold data not refreshed within 24h; still available, just not re-verified this cycle.
- **Nightly refresh was *partially* interrupted** for PlanetBids at 07:0X, but the family scanned successfully at 17:0X the prior evening and controls succeeded within the same wave. Document prefetch / intelligence were not implicated (result telemetry shows `opportunity_intelligence_queued=0`, `document_acquisition_supported=true`; no acquisition errors).

**Classification of the incident:** primarily a **dashboard/status problem**, secondarily a **transient partial-ingestion blip that self-heals**, plus **2 stale source configs**. **Not** a broad acquisition outage. **Not** a data-loss event.

---

## 11. Dashboard-Severity Assessment

The dashboard's "22 Failed / 2 Stale" **overstates severity by roughly an order of magnitude**:
- **20 of 22 "Failed"** are transient and already carry fresh data; **~18** are effectively healthy.
- **Both "Stale"** sources are ≥98% successful and fully fresh.
- The single most misleading behavior: **status = latest run only + `failed` sticky**, so a source that succeeded hours ago and holds current data reads as a hard failure after one transient blip.
- The second: **`partial` (mostly-success) is rendered identically to genuine age-staleness ("Stale")**, hiding the difference between "1 bad row of 60" and "no scan in 48h."

Genuinely actionable from the dashboard: **2 sources** (Long Beach, LA) — invalid portal IDs.

---

## 12. Immediate Recommendation (do NOT execute without approval)

**Priority order:**
1. **No emergency action for the 20 transient PlanetBids sources.** Their data is fresh (<24h) and the next scheduled scan will clear the status. *Optional:* a **safe, targeted retry of only those 20** to immediately clear the dashboard — no data risk.
2. **Fix the 2 invalid portal IDs** (City of Long Beach `15810`, City of Los Angeles `23749`). Re-verify their current PlanetBids portal IDs (both currently redirect to `/2001`). This is a **data-source config correction**, not a scan retry.
3. **Cal eProcure & Elsinore:** no source-level action. Optionally retry the 4 Cal eProcure rows and quarantine Elsinore bid `135122`. Neither should hold "Stale."
4. **Do not pause PlanetBids scans** — the family is healthy; pausing would stop the self-heal.

---

## 13. Proposed Code Changes (smallest viable; do NOT implement here)

**A. Stop the false-positive "observed" failure on unhydrated pages** — `bidbox-worker/drivers/planetbids.js` ~line 662.
- **Change:** require *evidence of actual bids* before treating a 0-row page as a hard failure. Only emit the "Listing data was observed" error when `foundBidsCount > 0` (a real found-count) **or** `apiDetailUrls.size > 0`. When `apiResponsesObserved > 0` but `foundBidsCount` is `n/a` **and** the body is blank/unhydrated, classify as a **retryable transient** (`retryable_failures++`) rather than a terminal `errors++`, or return the clean no-op if the page genuinely shows nothing.
- **Optional hardening:** before declaring 0 rows, add an explicit wait for either a rendered row **or** a definitive "no results" indicator (bounded), to absorb hydration lag.
- **Risk:** false-negative — a truly-empty portal could be retried unnecessarily (cost: one extra reload, already bounded). Low.

**B. Distinguish transient from terminal at the source level** — `bidbox-worker/index.js` ~line 858.
- **Change:** when a run produces **0 candidates but only retryable/transient errors** (no persisted rows *and* no evidence of real content), set `last_refresh_status = 'transient'`/leave prior success intact rather than `'failed'`, so a flaky render does not overwrite a recent success. Preserve `'failed'` for genuinely terminal cases (invalid portal, auth failure).
- **Risk:** must not mask real outages — gate strictly on the retryable-error signal.

**C. Separate quality from freshness in the dashboard** — `src/hooks/useAdminCoverage.ts` `classifyHealth` (see §14 model).

**Regression tests:** see §14.

---

## 14. Proposed Tests (do NOT implement here)

Driver unit tests (`bidbox-worker/test/planetbids-scan.test.js`):
1. **Unhydrated page** — `rowCount=0`, `apiResponsesObserved>0`, `found_bids=n/a`, blank body → **not** a terminal `failed`; classified retryable/no-op.
2. **Genuinely empty portal** — `found_bids=0` or "no results" text → clean return, `status=complete`, `errors=0`.
3. **Real bids present** — `found_bids>0`, rows render → candidates discovered, `errors=0`.
4. **Invalid portal** — `final_url` = `/2001` / "not a valid PlanetBids agency portal" → distinct terminal error code (e.g. `invalid_portal`), not the generic "no usable bid detail targets."

Health-model tests (new, around `classifyHealth`):
5. `partial` with recent `last_refresh_completed_at` → **Degraded**, not Stale.
6. `failed` on latest run but a successful run within interval → not a hard "Failed" (or a distinct "Transient/Degraded").
7. Age > 2×interval with no recent activity → **Stale** (true staleness preserved).

Proposed status model (§Task-10 model correction):

| State | Meaning |
|---|---|
| Healthy | latest run complete, within interval |
| Degraded | latest run `partial` (some rows failed) **or** transient 0-row blip, but data refreshed within interval |
| Stale | no completed activity within 2×interval |
| Failed | latest run terminally failed (invalid portal / auth / driver error) with no recent success |
| No open listings | portal rendered, explicitly zero open solicitations |
| Disabled | scan disabled |

This splits today's overloaded `failed`/`warning` into quality (`Degraded`, `No open listings`) vs. freshness (`Stale`) vs. terminal (`Failed`).

---

## 15. Controlled Validation Plan (after any fix)

Smallest validation, non-persistent, minimal Browserbase:
1. **Re-run target-discovery only** (no writes) for **2 transient sources** (e.g., City of Anaheim, Port of Los Angeles) and **1 control** (City of Riverside), using the existing `railway run` read-only playbook. Expect the transient sources to now render rows and classify non-terminal.
2. **Invalid-portal check** for Long Beach / LA: confirm corrected portal IDs render bids before re-enabling (a plain browser load of the corrected URL suffices — no Browserbase).
3. **Health-model unit tests** (§14) run in CI — no production dependency.
4. After deploy, watch **one** nightly wave and confirm transient blips no longer flip sources to "Failed."

Do **not** launch a full scan wave or enqueue production tasks for validation.

---

## 16. Risks & Unknowns

- **Exact transient trigger not definitively isolated** (Browserbase hydration stall vs. PlanetBids throttling under 4-replica burst). Evidence favors a load/timing effect early in the wave (failed cluster 07:01–07:18, controls succeeded 07:22–07:24), but no Browserbase session logs were pulled. Pulling per-session Browserbase logs for 1–2 failed tasks would confirm.
- **Invalid portal IDs (Long Beach, LA):** confirmed non-resolving today; whether PlanetBids reassigned/retired the IDs vs. targeted blocking is unconfirmed. Requires manual portal-ID re-verification.
- **`found_bids=n/a` universally** means the found-count element never rendered — consistent with non-hydration but also consistent with a PlanetBids markup change to the count element; the live Anaheim render (which *did* show "Found 1025 bids") argues for non-hydration during the wave, not a markup change.
- **Candidate "future-due" counts** depend on `bid_due_at` population; sources showing `future=0` may still have open bids with null/parsed-past due dates.
- Evidence is a **point-in-time** read (~9h post-wave). A subsequent scan may already have self-healed some of the 20 by the time this is read.

---

### Appendix — Evidence provenance
- Read-only production queries via `railway run` against Supabase (service-role, SELECT only) over `opportunity_sources`, `agent_tasks`, `opportunity_candidates`. No writes, no task mutation, no enqueue.
- Live public-portal checks via the in-app browser (no Browserbase session): Anaheim (`14424`) renders 1025 bids; Long Beach (`15810`) and LA (`23749`) return "not a valid PlanetBids agency portal."
- Code trace: `src/hooks/useAdminCoverage.ts`, `bidbox-worker/index.js`, `bidbox-worker/drivers/planetbids.js`, `bidbox-worker/drivers/caleprocure.js`; git history and Railway deployment list.
