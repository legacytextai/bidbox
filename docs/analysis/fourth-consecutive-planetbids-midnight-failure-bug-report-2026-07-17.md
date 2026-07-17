# Fourth Consecutive PlanetBids Midnight Failure — Bug Report

**Filed:** 2026-07-17
**Scope:** Investigation only. No code, config, data, task, deployment, migration, quarantine, or destructive action was performed. Read-only queries against production `opportunity_sources` and `agent_tasks` were the only side effects.
**Prior reports:** `docs/analysis/source-health-failure-investigation-2026-07-15.md`, `docs/analysis/repeated-planetbids-nightly-failures-bug-report-2026-07-16.md` (left unmodified).

---

## Bug Description

For the fourth consecutive midnight nightly scan (2026-07-14 → 2026-07-17), the PlanetBids ingestion family has produced a large group of source-level failures. The failure-count trend is 22 → 16 → 13. On 2026-07-17 the failed sources report a *new* error string — `planetbids_listing_hydration_timeout` — which confirms that commit `f5441d1` (the fourth attempted fix) is deployed and executing in production. Despite the new bounded 15 s DOM-authoritative wait plus one bounded reload, 13 PlanetBids sources still fail to reach any definitive listing state on every attempt. The prior fix therefore relabeled the failure mode but did not eliminate the underlying production ingestion failure.

## Current Behavior

- 13 PlanetBids sources failed the 2026-07-17 07:00 UTC nightly wave. All 13 exhausted both attempts (`attempts=2`) with `wait_ms` between 15 026 – 15 301 ms per attempt, i.e. the full bounded wait was consumed on *both* attempts.
- 12 of 13 failed sessions show `listing_endpoint_observed=false` and `body=blank`. The SPA never fired `/papi/bids` at all — bootstrap stops after `/papi/t` and `/papi/server-time` (clock/beacon observed=true, `api_responses=6` — the fixed boot handshake set).
- 1 of 13 (City of Eastvale) shows `listing_endpoint_observed=true`, `api_responses=15`, `body=598 chars`, but still `tr_count=0` / `role_row_count=0`. The listing endpoint fired and the app painted *something* but no bidding rows landed in the DOM within 15 s × 2.
- Failed scans are interleaved with successful scans in the same minutes on the same worker. No time-window clustering, no replica-wide outage signature.
- California eProcure is `partial` (285/286 rows succeeded), not `failed`. The Coverage dashboard renders it as **Stale** because `useAdminCoverage.classifyHealth` treats `last_refresh_status='partial'` as warning regardless of the ratio.
- City of Los Angeles and City of Long Beach are disabled with `official_portal_migrated_unsupported` — correctly excluded from the failure count.
- Existing candidates on the 13 failed sources remain visible but the newest per-source candidate is 3–17 days old; new opportunities posted between the last successful scan and the next successful scan are silently invisible on those portals.

## Expected Behavior

- Every enabled PlanetBids source should each night reach one of {rows rendered, explicit empty, invalid portal, disabled/migrated}. A `planetbids_listing_hydration_timeout` outcome should be rare and transient, not a repeating 13-source class.
- The reload/recovery attempt should not simply repeat the same failure signature; it should either recover the session or downgrade to a distinguishable terminal state so operators can act.
- `partial` Cal eProcure runs at ≥99 % row success should not be surfaced as **Stale**; either the health classifier or the driver's success threshold needs to distinguish nuisance-partial from meaningful degradation.
- Fixes must be validated against a *real* midnight wave before being called complete. Local browser probes and unit tests are insufficient.

## Steps to Reproduce

1. Wait for the scheduled 07:00 UTC (midnight PT) PlanetBids nightly wave.
2. Query `opportunity_sources` for `portal_type='planetbids' AND last_refresh_status='failed'`.
3. Observe ~13 rows with `last_refresh_error` starting `planetbids_listing_hydration_timeout: listings never rendered…`.
4. Cross-reference `agent_tasks` (`task_type='planetbids_scan'`, `created_at > '2026-07-17 07:00'`); note that failed and successful scans interleave every minute on the same worker.
5. Load the same PlanetBids portal URL manually in a browser — it renders correctly, which is *not* proof the nightly worker path is healthy.

## Environment

- Worker: Railway, `bidbox-worker` (branch `phase1-opportunity-intelligence`).
- Deployed commit: **`f5441d1` — Fix PlanetBids listing readiness race**. Confirmed active because production error strings contain telemetry fields (`clock_or_beacon_observed`, `listing_endpoint_observed`, `api_responses`, `attempts=2`, `polls`) that only exist in that commit.
- Runtime: Node 20 slim + Playwright Chromium + Browserbase managed sessions.
- Listing wait: `PLANETBIDS_LISTING_WAIT_MS` default 15 000 ms (env override not detected in error output; all 13 failures land at ~15 000–15 300 ms per attempt, confirming the deployed value). Poll interval 250 ms → ~50–52 polls per attempt (matches telemetry).
- Bounded reload: one recovery attempt, confirmed by `attempts=2` on every failed row.
- Sources: 74 enabled PlanetBids sources; 74 completed a scan in the last 25 h; 13 of those are in `failed` status. 2 additional PlanetBids sources are disabled (LA / Long Beach migrated portals).
- Concurrency: nightly wave produced 74 `planetbids_scan` tasks 07:00–07:37 UTC, running concurrently on a small pool with per-scan durations ranging 5 s to 338 s.

## Additional Context

### Four-night incident timeline

| Night (07:00 UTC) | Healthy | Stale | Failed | Never | Disabled | Signature error |
|---|---|---|---|---|---|---|
| 2026-07-14 | ~57 | 2 | 22 | 0 | 0 | *Listing data was observed, but no usable bid detail targets were found* |
| 2026-07-15 | 57 | 2 | 22 | 0 | 0 | same |
| 2026-07-16 | 64 | 1 | 16 | 0 | 0 | same |
| 2026-07-17 | 65 | 1 | 13 | 0 | 2 | **`planetbids_listing_hydration_timeout` (new wording, same volume-class)** |

Trend: raw failure count is declining slightly but has plateaued around 15 ± 5 for four consecutive nights — this is a persistent class, not a self-healing transient.

### Current 13 failed sources (2026-07-17 wave)

Every row below is from the same nightly wave, same worker, same commit. `api=6` is the PlanetBids boot handshake without `/papi/bids`. `api=15` is boot + listing endpoint fired.

| # | Source | Portal ID | wait_ms (att 2) | polls | api_responses | listing_endpoint | body | Browserbase session |
|---|---|---|---|---|---|---|---|---|
| 1 | City of Eastvale | 43976 | 15 226 | 52 | **15** | **true** | 598 chars | 7fe7b646-c4f8-4656-acb0-ff5f6901ba3b |
| 2 | Brea Olinda USD | 56096 | 15 281 | 50 | 6 | false | blank | 17d554f4-0b50-4986-98ae-8e80f6616829 |
| 3 | City of Gardena – GTrans | 39470 | 15 026 | 50 | 6 | false | blank | a6deab52-a90e-42af-b64e-19f0946c7acd |
| 4 | Elsinore Valley MWD | 32069 | 15 267 | 51 | 6 | false | blank | 6e55517e-8d7e-4709-9aff-441c0b4e76f8 |
| 5 | Val Verde USD | 70300 | 15 301 | 51 | 6 | false | blank | 55165056-f3b4-4e26-81ed-78a2fdcb724d |
| 6 | Newport-Mesa USD | 46422 | 15 231 | 51 | 6 | false | blank | 256aac80-9417-4a69-a674-bc76f45c6cff |
| 7 | City of La Cañada Flintridge | 62508 | 15 091 | 50 | 6 | false | blank | 0249bf9c-b6c2-485e-a856-e298891da828 |
| 8 | City of Culver City | 39483 | 15 234 | 50 | 6 | false | blank | 30b66822-dd83-40e2-ab8a-68bbb3391fde |
| 9 | City of Westlake Village | 59523 | 15 (from task 908a…) | 52 | 6 | false | blank | (session in task result) |
| 10 | Omnitrans | 18046 | 15 030 | 51 | 6 | false | blank | (session in task result) |
| 11 | City of Murrieta | 17992 | 15 208 | 52 | 6 | false | blank | ead682ce-a70f-4f95-b33f-46833f9c829b |
| 12 | City of Glendale | 39503 | 15 154 | 50 | 6 | false | blank | 0abd8f86-ba35-4a53-ba6f-f2c8d0c662b1 |
| 13 | City of Huntington Beach | 15340 | 15 133 | 52 | 6 | false | blank | f5cb12ee-2fda-4c6c-aae8-182246b252d6 |

Two distinct failure signatures inside the 13:

- **Type A (12 sources): pre-listing bootstrap stall.** SPA boots, hits `/papi/t` + `/papi/server-time` (+ a couple more boot calls totalling 6 responses), then never issues `/papi/bids`. Body stays blank across 50–52 polls × 2 attempts.
- **Type B (1 source, Eastvale): post-listing render stall.** SPA reaches the listing endpoint (`api=15`, `listing_endpoint_observed=true`), paints ~598 chars into `<body>`, but no `<tr>` bidding rows, no `[role=row]`, no `no-results` text. Data returned; the row list did not render.

The two types have different root causes and must be diagnosed separately.

### Source rotation across four nights (nights each source has been in the `failed` bucket)

- Failed **all 4 nights**: City of Westlake Village.
- Failed **3 nights**: Anaheim, Gardena-GTrans, Glendale, La Cañada Flintridge, Long Beach (now disabled), Los Angeles (now disabled), Newport Beach, Elsinore Valley MWD, Newport-Mesa USD, Omnitrans, Val Verde USD.
- Failed **2 nights**: Brea Olinda USD, Burbank-Glendale-Pasadena Airport, Chaffey College, Burbank, Carlsbad, Culver City, Diamond Bar, Eastvale, Huntington Beach, Huntington Park, Jurupa Valley, Murrieta, National City, Palm Springs, Wildomar, Downey USD, LACCD, LACOE, LAWA, Moreno Valley USD, OCFA, OC Sanitation, Port of Long Beach, Port of Los Angeles, San Diego USD, Santa Clarita CCD, Santa Clarita Valley Water.
- Failed **1 night**: 36 sources.

Interpretation: rotation is *not* random. A stable core (~1 chronic + 11 frequent) fails repeatedly and is joined by a rotating ring of 2–10 more per night. Chronic and frequent sources are the highest-signal cohort for locator/portal-variant analysis (Type A vs Type B).

### Deployment and commit verification

- `git log --oneline` on `bidbox-worker` local checkout shows `f5441d1` as the latest driver commit and is preceded by `11865c0`, `3442453`, `b4c2dab`, `d0412d6` — the full attempt sequence.
- Production error strings contain field names that were only introduced by `f5441d1` (`clock_or_beacon_observed`, `listing_endpoint_observed`, `api_responses`, `body=blank|N chars`). Therefore `f5441d1` **is** the running Railway image. This is direct evidence, not inference.
- `attempts=2` on every failed row proves the bounded reload/recovery from `11865c0` is running.
- The Railway environment did not override `PLANETBIDS_LISTING_WAIT_MS`: every attempt spent ≥15 000 ms in `waitForPlanetBidsListingState` (evidence: `wait_ms` distribution 15 026–15 301). If the env var were set to a shorter value, the observed wait would be shorter.

### Per-attempt hydration telemetry (aggregate)

- Total wall time per failed scan ≈ 30–52 s (2 × 15 s wait + navigation + reload).
- `polls` per attempt is ~50 (i.e. 250 ms cadence × 15 s), so the poll loop is not exiting early.
- `api_responses` distribution across 12/13 failures is a tight `6`, matching the fixed set of boot/beacon requests without `/papi/bids`.
- `no_results_text=false`, `api_detail_links=0`, `dom_detail_links=0`, `found_bids=n/a` uniformly — no partial signal was ever within reach.

### Failed vs. successful sessions in the same wave

Successful scans in the exact same minute windows (07:10–07:34 UTC) completed in 5–35 s with no error. This rules out:

- Railway replica-wide outage (successes and failures share the pool).
- Browserbase regional outage (adjacent sessions in the same second succeed).
- Concurrency saturation *as a primary cause* (parallel successful scans co-exist with the 13 failures).

What it does *not* rule out: per-session Browserbase page state, per-portal SPA behaviour, or auth/session-token race on the very first SPA request after the beacon.

### `/papi/bids` network analysis

- Type A (12 sources): `/papi/bids` **never fires**. The SPA halts between beacon responses and its first listing fetch. Candidate causes:
  - PlanetBids OAuth refresh (`/papi/oauth/refresh/` per test coverage) failing silently, blocking the listing request behind an unresolved auth promise.
  - CORS / cookie context missing under Browserbase (no persistent session storage between the beacon and the guarded listing call).
  - A JS runtime error thrown between boot and list dispatch — we do not currently capture `page.on('pageerror')` or `console` output, so we cannot confirm.
- Type B (1 source, Eastvale): `/papi/bids` fires and returns a response (we did not persist status code or size — that instrumentation is missing). Body paints 598 chars but no rows. Candidates:
  - `/papi/bids` returned 200 with `{ bids: [] }` and the driver's row locator fails to match the SPA's "no results" component variant on that portal.
  - `/papi/bids` returned 200 with rows but the SPA needs a Search-button click / query hydration to paint them.
  - Row template on Eastvale is virtualised or shadow-rooted; current locator (`<tr>` + `[role=row]`) does not see it.

### DOM and locator analysis

We do not currently capture a DOM snapshot on hydration timeout. The signals we do have (`tr_count=0`, `role_row_count=0`, `no_results_text=false`, `dom_detail_links=0`) prove the current locators found nothing — they do not prove nothing rendered. Without a saved outerHTML sample, we cannot rule out portal-specific markup variants (virtualised grid, iframe, shadow root, tabbed "Prospective / Awarded" view requiring a click).

### Browser console and page-error analysis

**Missing.** The driver does not currently attach `page.on('pageerror')` or `page.on('console')` listeners for the readiness wait, so we have no evidence of JS runtime errors, `Failed to fetch` messages, or CSP/CORS violations on the failed sessions. This is the highest-leverage instrumentation gap.

### Railway replica correlation

Cannot be confirmed from the current telemetry — worker replica ID is not embedded in the error string or `agent_tasks.result`. Interleaved successes in the same second strongly suggest replica identity is *not* the discriminator, but we cannot prove this without adding a `replica_id` field.

### Browserbase session correlation

Every failed session has a unique Browserbase session ID (table above). No two failures share a session. All 13 sessions succeeded at page load (final URL is the expected `bo-search` route). Regional attribution is not currently emitted.

### Recovery-path verification

- The recovery attempt runs: `attempts=2` on every row.
- It reuses the same `page` object (the reload path in `waitForPlanetBidsListingState` calls `page.reload()`, not a fresh Browserbase context). If the page state is poisoned (dead JS runtime, orphaned service worker, expired auth token), the reload inherits it.
- The signature of the second attempt matches the first (same `wait_ms`, same `api_responses`, same `body=blank`) — additional evidence that reload does not clear the underlying failure.

### Candidate freshness and missed-opportunity risk

- 15 currently-failing enabled PlanetBids sources hold a combined 230 existing candidates; newest per-source ranges 2026-07-01 → 2026-07-14. Sources like Huntington Beach, La Cañada, Eastvale, Newport-Mesa have not received a fresh candidate in >10 days.
- Because the scan times out before observing any listing, we **cannot bound** the count of missed opportunities — the driver never learned what should have been present. Any bid posted on those portals since the last successful refresh is invisible to BidBox.
- Aggregate view: 74/74 enabled PlanetBids sources have a `last_refresh_completed_at` within 25 h, but 13 of those "completions" are `failed` status with zero listing observation.

### California eProcure true outcome

- Status: `partial`, not `failed`. Result: **285/286 attempted rows succeeded** on 2026-07-17 07:37 UTC.
- Root cause of the "Stale" dashboard label: `src/hooks/useAdminCoverage.ts` `classifyHealth` maps any `last_refresh_status='partial'` → `warning` (stale) regardless of ratio. A 1-of-286 nuisance failure and a 200-of-286 real degradation are visually indistinguishable.
- Cal eProcure ingestion is operationally healthy this wave.

### Assessment of every previous attempted fix

| # | Commit | Intended fix | Why it did not eliminate the incident |
|---|---|---|---|
| 1 | `b4c2dab` | Wait for detail-page DOM after row click | Current failures occur *before* row click — no rows to click. Fix is still valuable for a different failure mode. |
| 2 | `3442453` | Retry a missed row click once | Same — never reached in the current failure path. |
| 3 | `11865c0` | One bounded listing reload before failing | Reload runs (`attempts=2`), but reuses the poisoned page and reproduces the same signature. |
| 4 | `f5441d1` | Replace `/papi/t` + `/papi/server-time` race with DOM-authoritative 15 s wait, distinct `hydration_timeout` error | Correctly eliminated the premature "listing ready after 1.5 s" false-positive and improved instrumentation. The remaining 13 failures are a *different* upstream failure (SPA never reaches `/papi/bids` at all, or reaches it but does not paint rows), which the readiness fix cannot address. Fix relabels — does not repair. |

Common failure pattern across all four attempts: each fix was declared complete against local unit tests and manual portal loads, not against a subsequent midnight production wave.

### Ranked hypotheses with confidence

Two root causes; the incident is a mix.

**Type A — 12/13 sources: SPA bootstrap stalls before `/papi/bids`.**
- H1 (55 %). Browserbase page context loses/blocks a cookie or storage item that PlanetBids' auth/bootstrap sequence needs before it will dispatch the listing fetch. Consistent with: identical `api_responses=6` (boot only), same failure across otherwise unrelated portals, no console instrumentation to see the underlying reject/throw.
- H2 (25 %). Uncaught JS runtime error in the SPA bootstrap on Chromium (e.g. TypeError in a beacon response handler) that halts the promise chain. Consistent with: blank body, no listing call, no recovery on reload (error is deterministic per page load).
- H3 (10 %). Rate-limit / silent 4xx from `/papi/oauth/refresh/` (only ~6 total boot responses observed — refresh may be *missing* from that count because it never returned).
- H4 (10 %). Portal-specific route requires a user interaction (Search click) that the driver never performs; `/papi/bids` is gated behind that click on some agency skins.

**Type B — 1/13 (Eastvale): listing fetched, rows never painted.**
- H5 (60 %). Row locator (`<tr>` + `[role=row]`) does not match the actual rendered structure for Eastvale's portal variant (virtualised list, alternate table skin, or `<div>`-based grid). Body has 598 chars — something rendered — but not what the locator scans for.
- H6 (25 %). `/papi/bids` returned `[]` and the "no results" text is a portal-specific string not in our `no_results_text` matcher.
- H7 (15 %). Rows render inside an iframe / shadow root not traversed by the locator.

None of the above can be **confirmed** without the missing evidence below. Do not treat these as diagnoses yet.

### Exact evidence still missing

Every downstream fix should be blocked until we capture, per failed session:

1. `page.on('pageerror')` — SPA runtime errors during bootstrap.
2. `page.on('console')` — warnings, network failures logged by the SPA.
3. Full `page.content()` outerHTML snapshot on timeout (uploaded to a debug bucket keyed by task id).
4. `page.screenshot()` on timeout, same key.
5. `/papi/bids` request/response pair when fired: status, byte length, `bids[].length` (never persisted).
6. `/papi/oauth/refresh/` presence, status, response body category.
7. Cookie jar + `localStorage` snapshot at timeout.
8. Railway replica id and Browserbase region on every task result.
9. A recorded HAR for the first-failed session per night.
10. Body preview (first 500 chars) rather than only a length classification.

### Recommended immediate operational action

- **Do not** deploy another speculative fix. The prior four cycles have all failed the "validated against a real midnight wave" bar.
- **Add read-only instrumentation** (items 1–10 above) behind a `PLANETBIDS_DEBUG_HYDRATION=true` env flag on a single Railway replica. Let one nightly wave run and capture. This is additive, non-breaking, and low risk — but per the investigation constraints of this task it is *out of scope for this document* and left as a follow-up recommendation only.
- Manually spot-check the 15 chronic sources by scheduling a *single* controlled probe *only after* the instrumentation is in place — never before.
- Split Cal eProcure dashboard health: distinguish `partial with ≥99 % success` from `partial <99 %` in `useAdminCoverage.classifyHealth`. Do not change here; recommend for a targeted follow-up.

### Proposed future fix scope

Two parallel workstreams once evidence is captured:

- **Type A workstream.** Determine why `/papi/bids` never fires. Likely fixes: force a fresh Browserbase context per session with explicit cookie priming; catch and surface SPA `pageerror`; retry with a warmed-up page after a delay if bootstrap stalls detected.
- **Type B workstream.** Audit row locator against Eastvale's actual DOM. Likely fix: add tolerant locators for div-based grids, tabbed portals, and shadow-root traversal; parse `/papi/bids` response directly as a fallback ingestion path when DOM render fails.

Do not conflate the two.

### Required observability before another code change

Ship the 10 evidence items above first. Then, and only then, propose a fix. Every subsequent fix PR must include:

- The specific evidence item(s) it relies on, cited by task id.
- A pre-registered success criterion measured against the next midnight wave (e.g. "0 hydration timeouts across a full nightly wave for two consecutive nights").
- No "manual portal load worked" claims.

### Controlled validation plan (for whichever fix comes next)

1. Deploy the fix to a single Railway replica with a feature flag.
2. Route only 10 sources — the 12 Type-A chronic/frequent set minus 2 controls — through the flagged replica for one nightly wave.
3. Compare pass/fail signatures against the control group.
4. Only after two consecutive successful waves, roll out to all replicas.

### Definition of done for the eventual fix

- Two consecutive midnight waves with zero PlanetBids `hydration_timeout` errors.
- No source in the current chronic-13 cohort in `last_refresh_status='failed'` after either wave.
- `agent_tasks.result` contains replica id and Browserbase region on every completed scan.
- Cal eProcure `partial` with ≥99 % row success does not surface as **Stale** on the Coverage dashboard.
- A written post-mortem citing exactly which evidence item(s) confirmed the root cause.

---

## Completion response

1. **Deployed commit during the most recent midnight scan:** `f5441d1` (Fix PlanetBids listing readiness race).
2. **Was `f5441d1` truly active:** Yes — production error strings contain telemetry fields introduced by that commit; no earlier commit could have produced them.
3. **`/papi/bids` in failed sessions:** For 12 of 13 sources it never fires (`listing_endpoint_observed=false`, `api_responses=6`). For 1 of 13 (Eastvale) it fires (`listing_endpoint_observed=true`, `api_responses=15`).
4. **Valid listing records returned:** Unknown — response body, status, and length are not persisted. For Eastvale, *something* returned (body grew to 598 chars); the payload contents are unrecoverable from current telemetry.
5. **Why DOM did/did not render:** For 12 sources, the SPA halts before dispatching the listing fetch — no data to render. For Eastvale, data likely returned but the row locator matched nothing; possible virtualised grid, alternate skin, or empty `bids[]`. Confirmation requires DOM snapshot + `pageerror` capture (currently missing).
6. **Did the current row locator detect the real rendered structure:** For 12 sources, irrelevant (nothing rendered). For Eastvale, the locator saw zero `<tr>` and zero `[role=row]` against a 598-char body — high probability the locator misses that portal's variant.
7. **Did the 15 s wait + recovery actually run:** Yes. `wait_ms` 15 026–15 301 ms per attempt × `attempts=2` on every failed row.
8. **Correlation to Railway replicas:** Cannot confirm — replica id not emitted. Interleaved same-second successes strongly suggest replica is not the discriminator.
9. **Correlation to Browserbase sessions/regions:** Every failed row has a unique session id (no session reuse). Region not emitted. No cross-session pattern observable.
10. **Concurrency causal, amplifying, or unrelated:** Unrelated as a primary cause (parallel successful scans co-exist with the 13 failures in the same seconds). Cannot rule out as a minor amplifier.
11. **Confirmed root cause:** Not confirmed. Two ranked hypothesis clusters — Type A (SPA bootstrap stall before `/papi/bids`, ~92 % of failures, top hypothesis H1 at 55 %) and Type B (Eastvale-only, listing fetched but not painted, top hypothesis H5 at 60 %). See "Ranked hypotheses with confidence".
12. **Sources with stale / potentially missed data:** 13 currently failing, plus 2 disabled/migrated. Combined 230 candidates last refreshed 2026-07-01 → 2026-07-14; newly-posted bids on those portals since the last successful refresh are silently invisible. Exact missed count is unknowable from current telemetry.
13. **California eProcure actual result:** `partial` — 285 of 286 attempted rows succeeded (99.65 %). Rendered as "Stale" by the dashboard because `classifyHealth` treats any `partial` status as warning regardless of ratio.
14. **Immediate operational recommendation:** Ship the 10 observability items behind a debug flag before *any* further code fix. Do not attempt a fifth speculative repair. Fix the Cal eProcure dashboard mapping separately (`partial` ≥99 % should render healthy).
15. **Exact report path:** `docs/analysis/fourth-consecutive-planetbids-midnight-failure-bug-report-2026-07-17.md`.
16. **Evidence to capture on the next midnight run:** `pageerror` events, `console` messages, full outerHTML snapshot, screenshot, `/papi/bids` and `/papi/oauth/refresh/` request/response pairs (status + size + record count), cookie + `localStorage` snapshot, Railway replica id, Browserbase region, per-session HAR for one representative failed session, first-500-chars body preview.
17. **Confirmation:** No code was modified. No database records were modified. No source configurations were changed. No scans, tasks, deployments, publications, pushes, merges, migrations, quarantines, or destructive actions were performed. Only read-only SQL queries against `opportunity_sources` and `agent_tasks` were executed, and this single new report file was created.
