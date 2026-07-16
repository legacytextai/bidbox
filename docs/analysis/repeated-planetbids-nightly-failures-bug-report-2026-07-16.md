# Repeated PlanetBids Nightly Scan Failures — Bug Report (2026-07-16)

**Investigation only** — as originally written. Nothing was changed during the investigation itself.

> **Status update:** this report has since been acted on. Defect 1 (the listing-readiness race) was fixed in commit `f5441d1`. Defect 2 (the two invalid portal IDs) was resolved on 2026-07-16 — see the **Resolution Note** appended at the end, which records the production source-configuration changes made. The investigation body below is preserved unchanged.

## Bug Description

The BidBox Source Health dashboard is repeatedly showing a large group of PlanetBids sources as failed after nightly scans.

Current dashboard snapshot (verified against production, counts match exactly):

- Healthy: 64
- Stale: 1
- Failed: 16
- Never scanned: 0
- Disabled: 0

The failed sources show the recurring error:

`Listing data was observed, but no usable bid detail targets were found.`

The failures occurred in the 2026-07-16 ~07:00–07:27 UTC nightly wave, roughly five to six hours before the screenshot, and represent another repeated nightly-wave failure after similar incidents on 2026-07-14 and 2026-07-15.

Failed sources: City of Huntington Park, Downey Unified School District, City of Anaheim, Omnitrans, Los Angeles County Office of Education, City of Newport Beach, City of Wildomar, City of Westlake Village, Moreno Valley Unified School District, City of National City, Newport-Mesa Unified School District, City of Jurupa Valley, Los Angeles Community College District, City of Los Angeles, City of Long Beach, Port of Long Beach.

California eProcure is shown as stale with `Cal eProcure detail navigation failed for 1/280 attempted row(s)`.

**A prior investigation (`docs/analysis/source-health-failure-investigation-2026-07-15.md`) concluded these were "transient blank-render/hydration failures" that would self-heal. That conclusion was incomplete and its recommendation was wrong.** This report supersedes it. The failure is **deterministic and reproducible in code**: a race in the driver's listing-readiness gate. It does not self-heal in any meaningful sense — it re-rolls the dice every wave, which is why failed-source membership rotates while the failure count stays roughly constant.

**Confirmed root cause:** `waitForResultsReady()` in `bidbox-worker/drivers/planetbids.js` treats **any** HTTP 2xx response from `api-external.prod.planetbids.com` as proof the listing is ready — **including `/papi/server-time`, a clock endpoint unrelated to bid data**. It then waits a fixed **1500 ms** and counts rows. It never waits for a bid row to exist. If the real bid-search payload has not rendered within ~1.5 s of an unrelated clock ping, the driver reads `rowCount = 0` and reports a hard failure.

## Current Behavior

- A group of PlanetBids sources flips to `Failed` after the nightly scan wave; the count is stable (22 → 16) but **membership rotates**: 11 of the current 16 are newly affected, 17 of the previous 22 recovered without intervention, 5 recur.
- Sources previously used as healthy controls now fail. **City of Jurupa Valley** — a control in the prior report — is now failed. **City of Anaheim** is failed again.
- The same generic error appears across unrelated agencies with identical telemetry: `tr_count=0; role_row_count=0; found_bids=n/a; api_detail_links=0; dom_detail_links=0`, `api_responses` 6–14, blank body preview.
- **Failing scans are ~5× faster than successful ones** (avg **12.9 s** vs **65.5 s**). They are not timing out or hanging — they are giving up prematurely.
- Production run logs show the readiness gate satisfied by `https://api-external.prod.planetbids.com/papi/server-time` — a clock call — followed ~3 s later by `0 Bidding row(s) found`.
- The bounded reload added in `11865c0` re-runs the **same** flawed wait on the **same** page/session, so it fails identically. It is not an effective retry.
- Because `apiResponsesObserved > 0` (server-time counts), the driver selects the misleading "Listing data was observed" wording and increments a **terminal** error rather than a retryable one.
- The latest failed run overwrites a prior successful source status (`last_refresh_status` is latest-run-only and `failed` is checked first and sticky).
- **All 16 failed sources now have zero candidates refreshed in the last 24 h** — a real escalation from the prior incident, where 18 of 20 were fresh. Data is now genuinely going stale.
- California eProcure is marked stale despite **279 of 280 rows succeeding (99.6%)**.
- Two sources (City of Los Angeles `portal/23749`, City of Long Beach `portal/15810`) fail with a different, **persistent** signature: redirect to `/2001`, *"This is not a valid PlanetBids agency portal."* These are invalid source configurations, not the race.

## Expected Behavior

- Nightly PlanetBids scans should wait for **actual rendered bid rows or a definitive empty-state signal**, not for an unrelated API ping plus a fixed sleep.
- Readiness should be keyed on the **bid-listing data response** (and/or a row selector), never on `/papi/server-time`.
- A temporary blank render should be retried with **bounded recovery on a fresh page/session** before the source is marked failed.
- Repeated transient failures should escalate rather than silently repeat nightly.
- The scan system should distinguish: valid portal with rendered listings · valid portal with explicitly zero open listings · temporarily unhydrated portal · rate-limited/throttled portal · invalid portal ID · partially successful scan · fully failed scan.
- One failed row out of hundreds should not mark an otherwise fresh source stale.
- Source health should communicate freshness, scan completeness, partial degradation, and terminal failure as distinct states.
- Previously successful sources should not appear hard-failed because of one transient rendering event.
- No fixes implemented until this report is reviewed and approved.

## Steps to Reproduce

1. Open the production Admin Coverage / Source Health dashboard.
2. Observe counts: Healthy 64, Stale 1, Failed 16. *(Verified: production query returns exactly `{"failed":16,"healthy":64,"warning(partial)":1}`.)*
3. Inspect the failed PlanetBids rows; confirm the recurring error string.
4. Query `opportunity_sources.last_refresh_status/_error` and the matching `agent_tasks` (`task_type='planetbids_scan'`, `payload->>source_id`).
5. Read `agent_run_logs.logs` for any failed task. Observe the sequence:
   ```
   07:01:59.159  Session: 6947f2c3-…              ← Browserbase session created in ~180 ms
   07:01:59.519  Loading listing: …/portal/72415/bo/bo-search
   07:02:02.122  PlanetBids API response observed: …/papi/t…
   07:02:05.260  0 Bidding row(s) found            ← ~3.1 s after the ping
   07:02:05.330  Listing produced no usable targets — reloading once before failing
   07:02:07.810  PlanetBids API response observed: …/papi/t…
   07:02:11.237  Listing data was observed, but no usable bid detail targets were found.
   ```
   For City of Long Beach and Los Angeles Community College District the gating response is literally `…/papi/server-time`.
6. Read `bidbox-worker/drivers/planetbids.js`:
   - `isPlanetBidsApiResponse` (146–148) — matches **any** 2xx from `api-external.prod.planetbids.com`.
   - `waitForResultsReady` (423–441) — awaits that response, `networkidle` (best-effort), then `waitForTimeout(apiResponse ? 1500 : 6000)`. **No wait on `createBiddingRowsLocator`.**
7. Load the same portals manually in a browser (no deadline) — they render normally.
8. Compare failed vs. successful run durations in the same wave: 12.9 s avg vs 65.5 s avg.

## Environment

- **Product:** BidBox · **Environment:** Production · **Screenshot date:** 2026-07-16
- **Route/surface:** Admin Coverage / Source Health
- **Worker hosting:** Railway — project `supportive-truth` (`1040e8f6-…`), service `bidbox` (`3715b766-…`), env `production`, region `sfo`
- **Worker topology:** **4/4 replicas running.** Poll loop claims **one task at a time** per replica (`claimNextTask`, `IDLE_POLL_INTERVAL_MS=30000`) → **max 4 concurrent scans**, confirmed empirically (max observed concurrency in the wave = **4**).
- **Current production deployment:** `413e1f6b-be34-4e0d-86dd-a96eef9670ea` — SUCCESS, deployed **2026-07-15 17:09:27 -07:00** (prior: `fd83d2de`, 2026-07-14 17:32).
- **Current branch (local):** `phase1-opportunity-intelligence` @ `da258d8`.
- **Browser automation:** Browserbase + Playwright (`chromium.connectOverCDP`).
- **Browserbase configuration (non-secret values):** `BROWSERBASE_GLOBAL_CONCURRENCY=1` (**per Node process — effective global ≈ 4 × 1 with 4 replicas**), `BROWSERBASE_429_COOLDOWN_MS=30000`, `BROWSERBASE_429_MAX_RETRIES=5`. API key present, not read.
- **PlanetBids login lock:** `PLANETBIDS_LOCK_MAX_WAIT_ATTEMPTS=3`, `PLANETBIDS_LOCK_RETRY_DELAY_MS=20000`. **Not applied to `planetbids_scan`** — only `document_prefetch` and `planetbids_candidate_recovery` (index.js 1409–1414, 1457–1462). Scans do not log in and need no lock.
- **Portal families:** PlanetBids, California eProcure.
- **Tables:** `opportunity_sources`, `agent_tasks`, `agent_run_logs`, `opportunity_candidates`.
- **Code:** `bidbox-worker/drivers/planetbids.js`, `bidbox-worker/index.js`, `bidbox-worker/lib/browserbase.js`, `bidbox-worker/drivers/caleprocure.js`, `src/hooks/useAdminCoverage.ts`.
- **Prior investigation:** `docs/analysis/source-health-failure-investigation-2026-07-15.md`.

## Additional Context

### Root-cause analysis

**Confirmed. Two independent defects, plus a reporting defect.**

**Defect 1 — the readiness gate waits on the wrong signal (causes 14 of 16 failures).**

`bidbox-worker/drivers/planetbids.js`:

```js
// 146–148
function isPlanetBidsApiResponse(res) {
  return res.url().includes('api-external.prod.planetbids.com') && res.status() >= 200 && res.status() < 300;
}

// 423–441
async function waitForResultsReady(page, sourceName, log, apiReady = null) {
  apiReady ??= page.waitForResponse(isPlanetBidsApiResponse, { timeout: 25000 }).catch(() => null);
  const domReady = waitForDocumentReady(page, 30000);
  const apiResponse = await apiReady;
  ...
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(apiResponse ? 1500 : 6000);   // ← fixed sleep, then count rows
  return Boolean(apiResponse);
}
```

The matcher accepts **any** 2xx from the PlanetBids API host. In production this resolves on **`/papi/server-time`** — a clock endpoint fired during SPA boot, before the bid-search request is even issued. `waitForResultsReady` then treats the listing as ready, sleeps **1500 ms**, and `createBiddingRowsLocator(page).count()` returns **0** because the bid table has not rendered.

Note the perverse inversion: when an API response *is* seen the driver waits **1.5 s**; when none is seen it waits **6 s**. The faster the (irrelevant) clock ping returns, the *shorter* the render budget.

This is a **race with a ~1.5 s budget**, and it explains every observation:

| Observation | Explained by |
|---|---|
| `api_responses=6–14` but `tr_count=0`, `role_row_count=0` | Responses counted (incl. server-time); rows not yet painted at check time |
| Blank `body_preview` | React has not painted when the diagnostic snapshot is taken |
| `found_bids=n/a` | The "Found N bids" element has not rendered either |
| Failures avg **12.9 s** vs successes **65.5 s** | Failures bail out early; they are not timeouts |
| **Rotating membership** (11 new, 17 recovered, 5 recurring) | A race — different sources lose it each night |
| Former healthy controls now failing (Jurupa Valley, Anaheim) | Race outcome, not agency configuration |
| Portals render fine when loaded manually | No 1.5 s deadline |
| The bounded reload fails identically | It re-runs the same wait on the same page/session |

Because `apiResponsesObserved > 0` (server-time again), the error branch (661–676) selects *"Listing data was observed…"* and does `errors++` — a **terminal** error. With 0 candidates persisted, `index.js:858` maps this to `last_refresh_status = 'failed'`.

**Defect 2 — two invalid portal IDs (causes 2 of 16 failures).**

City of Los Angeles (`portal/23749`) and City of Long Beach (`portal/15810`) persistently redirect to `https://vendors.planetbids.com/2001` — *"This is not a valid PlanetBids agency portal."* Reproduced live in a clean browser on both 2026-07-15 and 2026-07-16. Both have **0 candidates** and have failed **every** recent run (`0f/1e` × 5+), unlike the rotating group. This is a **source-configuration problem** and must be tracked separately.

**Defect 3 — health reporting conflates quality, freshness, and terminality.**

`src/hooks/useAdminCoverage.ts::classifyHealth` (117–133): `failed` is checked first and is sticky; `partial` is bucketed into the same `warning`/"Stale" state as genuine age-staleness; status derives from the **latest run only**.

**Ruled out by evidence:**

- **Concurrency burst / too many replicas** — max observed concurrency in the wave = **4**, exactly the designed ceiling (4 replicas × 1 task each). The 60 *successful* scans ran at the same concurrency.
- **Browserbase limits / 429s / session failures** — sessions created successfully in ~**180 ms** every time; no 429/503 cooldown lines in any run log; `BROWSERBASE_429_*` backoff never engaged.
- **PlanetBids throttling / bot detection** — the API returns **2xx**; portals render normally on manual load; no block pages (except the two genuinely-invalid portal IDs).
- **Worker CPU/memory exhaustion** — failures are 12.9 s fast-exits, not slow grinds; successes in the same window took 65 s without issue.
- **Deployment regression** — `413e1f6b` (2026-07-15 17:09) postdates the 07-14 incident; the defect predates all three waves. The 07-14 hardening commits are downstream of row detection and irrelevant here.
- **Shared PlanetBids login/session invalidation** — `planetbids_scan` performs **no login** and takes **no lock**.

### Incident timeline (UTC)

| Time | Event |
|---|---|
| 2026-07-14 ~07:0X | First observed wave — PlanetBids sources fail with this error. |
| 2026-07-14 17:32 | Deployment `fd83d2de`. |
| 2026-07-15 ~07:0X | Second wave — **22** sources failed. Investigated; wrongly attributed to transient hydration; "self-heal" recommended. |
| 2026-07-15 17:09 | Deployment `413e1f6b` (current). |
| 2026-07-16 07:00:12 → 07:27:28 | **Third wave.** 76 `planetbids_scan` runs: **60 OK, 16 failed.** Max concurrency 4. Failures avg 12.9 s, successes 65.5 s. |
| 2026-07-16 07:36:58 | Cal eProcure: found 279, new 17, refreshed 251, unchanged 11, **errors 1** → `partial` → "Stale". |
| 2026-07-16 ~13:30 | Investigation. Live check: Jurupa Valley "Found 180 bids" incl. an open **Bidding** item due 07/29/2026; Anaheim "Found 1025 bids"; LA/Long Beach `/2001`. |

### Current 16-source matrix

All rows: `tr_count=0`, `role_row_count=0`, `found_bids=n/a`, `api_detail_links=0`, `dom_detail_links=0`, `agent_tasks.status='complete'`, `last_refresh_status='failed'`, wave 2026-07-16 ~07:0X, `trigger_reason=nightly_cron`. `cand` = total / future-due / refreshed-in-24h. `runs` = last 5 (found/errors), newest first.

| # | Source | api | sig | cand t/f/r24 | runs (found/errors) | Cause | True failure? |
|---:|---|---:|---|---|---|---|---|
| 1 | City of Huntington Park | 6 | blank | 3/2/0 | 0f/1e 2f/0e 2f/0e 2f/2e 2f/0e | Readiness race | No — false failure |
| 2 | City of Long Beach | 9 | **INVALID /2001** | 0/0/0 | 0f/1e ×5 | Invalid portal ID | **Yes — config** |
| 3 | Los Angeles Community College District | 6 | blank | 5/5/0 | 0f/1e 3f/0e 5f/0e 0f/1e 5f/0e | Readiness race | No — false failure |
| 4 | Port of Long Beach | 6 | blank | 4/3/0 | 0f/1e 4f/0e 4f/0e 4f/4e 4f/0e | Readiness race | No — false failure |
| 5 | Downey Unified School District | 6 | blank | 30/0/0 | 0f/1e 30f/0e 30f/0e 30f/30e 30f/0e | Readiness race | No — false failure |
| 6 | City of Los Angeles | 9 | **INVALID /2001** | 0/0/0 | 0f/1e ×5 | Invalid portal ID | **Yes — config** |
| 7 | Los Angeles County Office of Education | 6 | blank | 56/0/0 | 0f/1e 56f/0e 56f/0e 56f/56e 56f/0e | Readiness race | No — false failure |
| 8 | City of Newport Beach | 6 | blank | 4/2/0 | 0f/1e 0f/1e 3f/0e 0f/1e 3f/3e | Readiness race | No — false failure |
| 9 | City of Wildomar | 6 | blank | 1/1/0 | 0f/1e 1f/0e 1f/0e 0f/1e 1f/0e | Readiness race | No — false failure |
| 10 | City of Westlake Village | 6 | blank | 34/0/0 | 0f/1e 0f/1e 0f/1e 34f/34e 34f/0e | Readiness race | No — false failure |
| 11 | Omnitrans | 6 | blank | 2/2/0 | 0f/1e 2f/0e 0f/1e 2f/2e 2f/0e | Readiness race | No — false failure |
| 12 | Moreno Valley Unified School District | 6 | blank | 3/1/0 | 0f/1e 1f/0e 0f/1e 1f/1e 1f/0e | Readiness race | No — false failure |
| 13 | City of National City | 6 | blank | 60/0/0 | 0f/1e 60f/0e 60f/0e 60f/60e 60f/0e | Readiness race | No — false failure |
| 14 | Newport-Mesa Unified School District | 14 | blank | 2/1/0 | 0f/1e 2f/0e 2f/0e 2f/2e 2f/0e | Readiness race | No — false failure |
| 15 | City of Anaheim | 6 | blank | 60/0/0 | 0f/1e 0f/1e 60f/0e 60f/60e 60f/0e | Readiness race | No — false failure |
| 16 | City of Jurupa Valley | 6 | blank | 2/1/0 | 0f/1e 1f/0e 1f/0e 1f/1e 1f/0e | Readiness race | No — false failure (portal has live open bid) |

**Totals:** 14 readiness-race false failures · 2 invalid-portal true failures · 266 candidates held across the 16 · 18 future-due open opportunities · **16/16 with zero candidates refreshed in 24 h**.

### Comparison with the prior incident (2026-07-15, 22 sources)

| | 2026-07-15 | 2026-07-16 |
|---|---|---|
| Failed | 22 | 16 |
| Invalid-portal (constant) | 2 (LA, Long Beach) | 2 (LA, Long Beach) |
| Race failures | 20 | 14 |
| Candidates refreshed <24 h | 18 of 20 fresh | **0 of 16 fresh** |
| Max concurrency | not measured | 4 (at ceiling, by design) |

- **Recurring (5):** City of Long Beach, City of Los Angeles, City of Newport Beach, City of Westlake Village, City of Anaheim.
- **Newly affected (11):** City of Huntington Park, Los Angeles Community College District, Port of Long Beach, Downey USD, LA County Office of Education, City of Wildomar, Omnitrans, Moreno Valley USD, City of National City, Newport-Mesa USD, **City of Jurupa Valley** *(a prior "healthy control")*.
- **Recovered without intervention (17):** Chaffey College, Gardena-GTrans, Val Verde USD, Diamond Bar, La Canada Flintridge, San Diego USD, Santa Clarita Valley Water, OC Sanitation, Palm Springs, OC Fire Authority, Glendale, Santa Clarita CC District, Burbank-Glendale-Pasadena Airport, Burbank, LAWA, Port of Los Angeles, Carlsbad.

**Interpretation:** the *set* churns while the *rate* holds (~20–27% of the family per wave). That is the signature of a race, not of agency-specific configuration or a portal change. **The prior report's "it self-heals" was an artifact of watching different sources recover while new ones broke.**

### Data-impact assessment

**Confirmed:**
- **16 sources have no candidate refreshed in the last 24 h** — a material regression from the prior wave.
- **2 sources (LA, Long Beach) have zero data at all** and have never succeeded recently — confirmed missing coverage.
- **266 candidates** are held across the 16 failed sources; **none were deleted**. **18 are future-due** and remain visible to users, but unrefreshed for >24 h (titles, due dates, addenda may be out of date).
- **Cal eProcure is healthy:** 279/280 rows (**99.6%**), 17 new + 251 refreshed persisted, 378 candidates with 279 refreshed in 24 h. Its "Stale" badge is purely `partial → warning`.
- **Live portals hold open work we are not ingesting:** Jurupa Valley shows an open **Bidding** item due **07/29/2026** (13 days out) while the source sits Failed.

**Inference:**
- **New solicitations posted on the 14 race-affected sources during the stale window are not being ingested** until a wave that happens to win the race. With ~20–27% of the family losing per wave and ~2–3 waves/day, most sources recover within a day, but coverage is **stochastic and unreliable**, and any given source can miss multiple consecutive waves (Westlake Village: 3 consecutive `0f/1e`).
- Exact missed-opportunity count is **not directly measurable** from stored telemetry (failed runs record `found=0`, so we cannot know what was on the page).
- **Classification:** this is **no longer primarily a dashboard problem**. It is a **real, recurring partial-ingestion reliability defect** (deterministic race) **plus** a dashboard that both overstates severity for individual sources *and* understates the systemic nature by presenting a rotating cast as unrelated one-offs.

### Ranked hypotheses

| # | Hypothesis | Confidence | Basis |
|---:|---|---|---|
| 1 | **Readiness gate keys on any PlanetBids API response (incl. `/papi/server-time`) + fixed 1.5 s sleep; never waits for rows** | **Confirmed — very high** | Code 146–148 / 423–441; run logs show `server-time` gating; 12.9 s vs 65.5 s durations; rotating membership; portals render manually |
| 2 | **Two invalid portal IDs (LA, Long Beach)** | **Confirmed — very high** | `/2001` reproduced live twice; 0 candidates; 5/5 consecutive failures |
| 3 | **Bounded reload is ineffective (same wait, same page/session)** | **Confirmed — high** | Code 621–648; logs show reload → identical failure ~4 s later |
| 4 | **Terminal-vs-retryable misclassification (`errors++` on a race)** | **Confirmed — high** | Code 661–676 + index.js:858 → `failed` |
| 5 | **Dashboard conflates quality/freshness/terminality** | **Confirmed — high** | `classifyHealth` 117–133; Cal eProcure 99.6% → "Stale" |
| 6 | Concurrency/load *amplifies* the race (raises render latency past 1.5 s) | **Plausible — medium** | Failures cluster in the burst; but max concurrency is only 4 and 60 scans succeeded at the same concurrency. Contributing, not causal. |
| 7 | Four replicas begin too many scans at once | **Rejected — low** | Max concurrency measured = 4, the designed ceiling |
| 8 | Browserbase concurrency limits / 429s / session instability | **Rejected — low** | Sessions created in ~180 ms; zero 429/503 lines; backoff never fired |
| 9 | PlanetBids throttling / bot detection | **Rejected — low** | API returns 2xx; portals render normally; no block pages |
| 10 | Worker CPU/memory exhaustion | **Rejected — low** | Failures are fast-exits, not slow grinds |
| 11 | Recent deployment regression | **Rejected — low** | Defect predates all three waves; recent commits are downstream of row detection |
| 12 | Portals legitimately have zero open listings | **Rejected — low** | Prior runs found 30–60; Anaheim 1025 bids, Jurupa Valley 180 bids live |

### Recommended immediate action

**Do not execute without approval. Nothing below was performed.**

1. **Do not rely on self-heal.** That was the prior report's error. The race re-rolls every wave.
2. **Highest-value, lowest-risk:** fix Defect 1 (readiness gate). It converts ~20–27% of the family per wave from false-failed to ingested. Everything else is secondary.
3. **Separately correct the 2 invalid portal IDs** (LA `23749`, Long Beach `15810`) — re-verify current PlanetBids portal IDs. This is config, not code.
4. **No source-level action for Cal eProcure** (99.6% success); optionally retry the single failed row.
5. **Do not pause PlanetBids scans** — 60/76 succeed per wave; pausing removes the only ingestion path.
6. **Optional stopgap only if a fix cannot ship quickly:** raise the post-API settle (`waitForTimeout`) materially or set `BROWSERBASE_GLOBAL_CONCURRENCY`/replica count lower to reduce render latency. This is a *mitigation of a race*, not a fix, and should not substitute for #2.

### Proposed fix plan (smallest correct change; not implemented)

**A. `bidbox-worker/drivers/planetbids.js` — fix the readiness signal (primary).**
- Narrow `isPlanetBidsApiResponse` (or add `isPlanetBidsListingResponse`) to match **only the bid-search/listing data endpoint**, explicitly excluding `/papi/server-time` and other boot pings.
- In `waitForResultsReady`, replace the fixed `waitForTimeout(1500)` with a **race on real outcomes**, bounded (~20–30 s):
  - a bidding row appears (`createBiddingRowsLocator(page).first().waitFor({state:'attached'})`), **or**
  - a definitive empty-state signal appears (`Found 0 bids` / "no results" text), **or**
  - timeout → classify **retryable**, not terminal.
- Remove the inverted budget (`apiResponse ? 1500 : 6000`).

**B. Make the reload a real retry.**
- On zero rows, retry on a **fresh page/context** (and ideally a fresh Browserbase session) rather than re-running the same wait on the same page.

**C. Terminal vs retryable classification.**
- Zero rows with no definitive empty-state → `retryable_failures++`, **not** `errors++`.
- `bidbox-worker/index.js:858` — a run with 0 candidates and only retryable errors must **not** overwrite a prior success with `failed`.
- Emit a distinct terminal code (e.g. `invalid_portal`) for the `/2001` signature so config problems are separable from races.

**D. `src/hooks/useAdminCoverage.ts::classifyHealth` — split the states.**

| State | Meaning |
|---|---|
| Healthy | latest run complete, within interval |
| Degraded | `partial` (some rows failed) or a retryable blip, data still fresh within interval |
| Stale | no completed activity within 2× interval |
| Failed | terminal failure (invalid portal / auth / driver error), no recent success |
| No open listings | portal rendered, explicitly zero open solicitations |
| Disabled | scan disabled |

**Risk:** (A) risks waiting longer on genuinely empty portals — bounded by the timeout; net scan time rises modestly. (C) risks masking a real outage — gate strictly on the retryable signal and alert on consecutive retryable failures.

### Proposed tests

Driver (`bidbox-worker/test/planetbids-scan.test.js`):
1. **`/papi/server-time` must not satisfy readiness** — a page emitting only `server-time` then rendering rows at T+4 s must still find rows. *(Directly reproduces this bug; fails today.)*
2. **Rows render late** — rows appear 3–5 s after the listing XHR → scan succeeds.
3. **Genuinely empty portal** — `Found 0 bids` / "no results" → clean `complete`, `errors=0`, no false failure.
4. **Never-hydrating page** — no rows, no empty-state → classified **retryable**, not terminal `failed`.
5. **Invalid portal** — `/2001` body → distinct terminal `invalid_portal` code.
6. **Reload uses a fresh page/context**, not the stale one.

Health model (`src/hooks/useAdminCoverage.ts`):
7. `partial` + fresh activity → **Degraded**, not Stale.
8. Retryable-only failed run with a success inside the interval → **not** hard Failed.
9. Age > 2× interval → **Stale** (true staleness preserved).

Aggregation (`bidbox-worker/index.js`):
10. 0 candidates + retryable-only errors → does not write `last_refresh_status='failed'`.

### Controlled validation plan

1. **Unit tests above** — no production dependency; test #1 must fail before the fix and pass after.
2. **Bounded live diagnostic (only if needed):** target-discovery only, **no writes, no queue insertion, no status mutation**, max **2 failed sources** (City of Anaheim, City of Jurupa Valley) + **1 control** (City of Culver City), via the existing read-only `railway run` playbook. Expect rows detected once readiness waits on the listing response.
3. **Post-deploy:** observe **one** nightly wave; success criterion — failed count for the race group drops to ~0 and membership stops rotating. The 2 invalid-portal sources should remain failed with a **distinct** `invalid_portal` code until their config is corrected.
4. **Regression watch:** confirm avg scan duration does not balloon (empty portals now wait to the bound).

### Risks and unresolved questions

- **Exact missed-opportunity count is unmeasurable** from stored telemetry — failed runs record `found=0` and never saw the page contents. We can bound it (≤ what appears on those portals) but not enumerate it.
- **Precise bid-listing endpoint path not yet pinned.** Logs show `/papi/server-time` and a truncated `/papi/t…`; the exact listing endpoint must be identified before narrowing the matcher, or the fix could over-narrow and never match. **This is the main open item for the fix.**
- **Why LA/Long Beach portal IDs became invalid** (retired vs. reassigned vs. targeted block) is unconfirmed — needs manual portal re-verification.
- **Contribution of concurrency to render latency is not isolated.** Hypothesis 6 is plausible but unquantified; the fix should make it moot rather than depend on it.
- **Prior-report correction:** the 2026-07-15 conclusion ("transient, self-heals") was wrong in mechanism and in recommendation. It correctly identified the false-positive *wording* and the dashboard defects, but attributed zero-rows to unexplained hydration flakiness instead of a driver race with a 1.5 s budget keyed on a clock endpoint. **Do not carry that report's "no action required" forward.**
- **Risk of taking no action (as of the original investigation):** the defect is deterministic and load-sensitive. Ingestion for the PlanetBids family remains stochastic (~20–27% of sources silently skipped per wave); all 16 currently-failed sources already exceed 24 h without refresh; open bids with near-term due dates (e.g. Jurupa Valley, due 07/29/2026) may be missed, surfaced late, or shown with stale terms. Severity grows as the family grows, and the rotating cast makes it easy to keep misreading as transient.

---

# RESOLUTION NOTE — 2026-07-16 (appended; investigation history above is unchanged)

This note records the resolution of **Defect 2 (the two invalid portal IDs)** only. Defect 1 (the readiness race) was fixed separately in commit `f5441d1`.

## Outcome: both cities migrated off PlanetBids. Neither is a portal-ID correction.

The working assumption in §Recommended immediate action — "re-verify current PlanetBids portal IDs" — was **wrong**. There are no correct PlanetBids IDs to find. Both agencies left the platform entirely.

| | City of Los Angeles | City of Long Beach |
|---|---|---|
| Previous invalid portal ID | `23749` | `15810` |
| Previous URL | `https://vendors.planetbids.com/portal/23749/bo/bo-search` | `https://vendors.planetbids.com/portal/15810/bo/bo-search` |
| Still on PlanetBids? | **No** | **No** |
| Official current platform | **RAMPLA** (Regional Alliance Marketplace for Procurement) | **Long Beach Buys** (BuySpeed) |
| Official current URL | `https://www.rampla.org/` | `https://longbeachbuys.buyspeed.com/bso/` |
| BidBox driver support | **None** (no RAMP driver) | **None** (no BuySpeed driver) |
| Source UUID | `a567762b-5016-414b-aaa0-3c0fe200ec68` | `fb94f9ce-cb61-418c-bad4-999d668e7421` |
| Resolution | Disabled, row preserved | Disabled, row preserved |

## Evidence (official link chains)

**City of Los Angeles** — official City page `https://lacity.gov/business/contract-city` lists exactly two vendor destinations: **RAMPLA** (`https://www.rampla.org/`, "Browse RAMPLA to find unique opportunities for your business to contract with the City of Los Angeles") and LAVSS (`https://lavss.lacity.org`, vendor self-service for payments — not solicitations). **PlanetBids is not mentioned anywhere.** `rampla.org` self-identifies as "An Official Website of the City of Los Angeles" and hosts the bid-opportunity search.

**City of Long Beach** — official City page `https://www.longbeach.gov/finance/business-info/purchasing-division/` states "View Contracting Opportunities On LONG BEACH BUYS". **Every** Bids/RFP and vendor-registration link on that page resolves to `https://longbeachbuys.buyspeed.com/bso/`. The portal self-identifies as "Long Beach Buys — Promoting transparency, equity, and efficiency in Long Beach's procurement systems" and references City of Long Beach SBE certification.

> **Trap worth recording:** the "ENTER LONG BEACH BUYS" anchor still carries `title="PlanetBids"` — vestigial markup from the pre-migration site. The tooltip says PlanetBids; the `href` goes to BuySpeed. Reading the tooltip instead of the href would produce a false "still on PlanetBids" conclusion.

> **Second trap:** a web search surfaces `pbsystem.planetbids.com/portal/15810/bo/bo-search` titled *"California - City of Long Beach"*. That is a stale cached index entry. Fetched live, `pbsystem.planetbids.com` redirects to `vendors.planetbids.com` and returns the same `/2001` "not a valid PlanetBids agency portal" interstitial. **Both portal IDs are retired on both PlanetBids hosts** (`vendors.` and `pbsystem.`), verified 2026-07-16.

## Production change applied

UUID-scoped `UPDATE` on exactly two rows (guarded on name + listing_url + portal_type; each update confirmed to match exactly one row; re-read and verified after write):

| Field | Before (both rows) | After (both rows) |
|---|---|---|
| `scan_enabled` | `true` | **`false`** |
| `refresh_enabled` | `true` | **`false`** |
| `last_refresh_error` | "Listing data was observed, but no usable bid detail targets were found…" | **`official_portal_migrated_unsupported: …`** (platform, official URL, evidence, verification date) |

Unchanged: `id`, `name`, `portal_type`, `listing_url`, `last_refresh_status`, and all candidate rows. Nothing was deleted or inserted.

`portal_type` and `listing_url` are deliberately **left at their historical PlanetBids values**. They are inaccurate as live configuration but accurate as history, and rewriting them to a RAMPLA/BuySpeed URL under `portal_type='planetbids'` would misconfigure the source for a driver that cannot read it.

## Validation

No scan was run for either source — running an incompatible driver against a migrated portal would prove nothing. Instead, classification was verified against `src/hooks/useAdminCoverage.ts::classifyHealth` (where `!scan_enabled` short-circuits to `disabled` before the `failed` check):

- **Before:** healthy 64 · stale 1 · **failed 16** · disabled 0
- **After:** healthy 64 · stale 1 · **failed 14** · **disabled 2**

Both cities now classify as **Disabled**, not Failed. The remaining 14 failures are the Defect 1 readiness-race group, unrelated to this change.

Safety checks: no duplicate `listing_url`, no duplicate source names, no other source represents either city, both city rows own **0 candidates**, and **0 candidates reference the retired portals**. Adjacent entities confirmed untouched and still enabled — Port of Los Angeles (`42217`), Port of Long Beach (`19236`), Long Beach Unified School District (`23758`), Los Angeles World Airports (`48397`).

## Explicit non-claim

**BidBox does not ingest City of Los Angeles or City of Long Beach solicitations, and did not before this change.** Disabling these sources stops false operational failures; it does not restore coverage. Both cities are now uncovered *and correctly reported as uncovered* rather than silently failing.

## Follow-ups

1. **RAMP/RAMPLA driver** for City of Los Angeles (`rampla.org`) — required to restore LA coverage. Likely also unlocks other RAMP regional partners.
2. **BuySpeed driver** for City of Long Beach (`longbeachbuys.buyspeed.com`) — required to restore Long Beach coverage. Likely reusable for other BuySpeed/Periscope agencies.
3. **Latent seed-replay risk:** `supabase/migrations/20260608184304_*.sql`, `20260608000001_*.sql` and related seeds insert these rows with `ON CONFLICT (listing_url) DO UPDATE` and `scan_enabled = true`. They are already applied and will not re-run, so production stays correct — but a **fresh-database replay would re-enable both broken sources**. Historical applied migrations were deliberately not edited. A future corrective migration should disable them at seed time.
4. **Audit the remaining PlanetBids roster for other silent migrations.** Two of 76 sources had retired portal IDs; the readiness-race fix will make any others visible as persistent `invalid_planetbids_portal` errors rather than generic noise.
