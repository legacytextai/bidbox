# PlanetBids Instrumented Production Wave — 2026-07-20

**Run type:** One controlled production diagnostic wave
**Trigger:** `manual_diagnostic_wave_2026_07_20`
**Production service:** `bidbox`
**Deployment:** `c1996952-ff2a-46a3-9db9-a70c07f222d0`
**Commit:** `1dfa9f59d4961d6671af3fbd37a2f5ed860be575`
**Instrumentation:** `planetbids_hydration_diagnostics_v1`
**Scope:** Evidence collection only; no functional fix was implemented.

## 1. Executive summary

The controlled wave enqueued all 74 enabled PlanetBids sources exactly once and excluded the two disabled migrated sources, City of Los Angeles and City of Long Beach. All 74 queue tasks reached the task-level `complete` state. At the source-result level, 62 refreshed successfully, none were partial, and 12 failed with `planetbids_listing_hydration_timeout`.

The instrumentation confirms one common failure class across all 12 failed sources: **Class A — app boot stops before `/papi/bids`**. In all 24 failed attempts, the PlanetBids SPA's anonymous bootstrap broke before the listing request. The OAuth refresh was either HTTP 401 (15 attempts) or failed in the browser after a CORS rejection (9 attempts). The remaining boot endpoints returned HTTP 202, after which the SPA emitted `Unexpected end of JSON input` and `Cannot read properties of undefined (reading 'data')`. The route stopped, `/papi/bids` never fired, and `<body>` stayed empty.

This is not a row-locator defect in these 12 sessions: there was no rendered listing DOM for the locator to inspect. Both attempts reused the same Browserbase session and Playwright page; the reload reproduced the same empty-body/bootstrap-error state. Same-minute controls on every replica reached `/papi/bids` with HTTP 200 parseable JSON and rendered 30–60 role rows. Failures therefore do not correlate with a Railway replica, a shared Browserbase session, scan start time, or portal size.

The immediate functional recommendation is to stop treating a reload of the same poisoned page as recovery. Detect the bootstrap-error signature early, discard the full Browserbase session/context, and retry once in a fresh session. The durable fix is a driver-owned API listing path based on the observed `/papi/bids` request contract, with structured JSON:API parsing and DOM navigation only as a secondary detail-extraction path. That removes listing discovery from the PlanetBids SPA's fragile anonymous-render pipeline.

## 2. Deployment verification

Preflight confirmed:

- Branch: `phase1-opportunity-intelligence`
- Local and deployed commit: `1dfa9f59d4961d6671af3fbd37a2f5ed860be575`
- Production deployment: `c1996952-ff2a-46a3-9db9-a70c07f222d0`
- Four Railway worker replicas were running and logging normal 30-second polling startup.
- No deployment was in progress.
- The deployed code contained `planetbids_hydration_diagnostics_v1`.
- No prior task used trigger `manual_diagnostic_wave_2026_07_20`.
- No pending/running `planetbids_scan`, `document_prefetch`, candidate recovery, or other Browserbase-competing task existed.
- One unrelated `qualification_rebuild` task was running; it does not use Browserbase.
- The next scheduled midnight wave was approximately 11.4 hours away.

## 3. Wave configuration

| Item | Count / value |
|---|---:|
| Enabled PlanetBids sources | 74 |
| Enqueued | 74 |
| Disabled and excluded | 2 |
| Excluded due to active/pending duplicate | 0 |
| Other portal families enqueued | 0 |
| Trigger | `manual_diagnostic_wave_2026_07_20` |
| First task created | 2026-07-20 19:39:47.466673 UTC |
| Last task completed | 2026-07-20 20:05:33.453 UTC |
| Wall-clock duration | 1,545.987 s (25m 45.987s) |
| Existing replicas | 4 |
| Maximum observed running tasks | 4 |

The existing `scan-opportunities` Edge Function was invoked once per source, preserving the normal payload, duplicate guard, queue, worker, Browserbase, and persistence path. The endpoint returned a batch-shaped success object rather than the initially expected top-level `task_id`; the client stopped after the first successful enqueue, then resumed using source-ID idempotency checks. Subsequent checks skipped every already-created source task. Final cardinality was exactly 74 tasks for 74 unique source IDs, with no duplicates.

Disabled exclusions were the **City of Los Angeles** source and **City of Long Beach** source. The separately configured Port of Los Angeles and Port of Long Beach sources were enabled and correctly included.

## 4. Queue and concurrency behavior

- Task execution: 74 `complete`, 0 task-level `failed`, 0 cancelled.
- Source results: 62 `complete`, 0 `partial`, 12 `failed`.
- The queue held at four running tasks whenever all replicas were between claim cycles; brief observations of two or three running tasks occurred only during the normal 30-second polling handoff.
- Peak observed concurrency was four. No concurrency, replica, Browserbase, timeout, or schedule setting was changed.
- Each task used a distinct Browserbase session ID: 74 tasks, 74 session IDs.
- No retry tasks or second wave were created.

Replica distribution:

| Railway replica | Tasks | Successful source results | Failed source results | Failure rate |
|---|---:|---:|---:|---:|
| `a6a6b392-3318-4a8f-93ec-7bd47ceed9af` | 23 | 19 | 4 | 17.4% |
| `bfa4c8ce-e1a6-40ec-9cfb-6ba70c16bb05` | 15 | 12 | 3 | 20.0% |
| `80427552-810b-4f6d-b81e-091c584919ac` | 19 | 16 | 3 | 15.8% |
| `6a9d44d5-8c1c-4f12-92fb-2eb127754ed2` | 17 | 15 | 2 | 11.8% |

Every replica handled both successes and failures. The modest rate spread is not evidence of a replica defect given the sample sizes and common error signature.

## 5. Aggregate results

| Metric | Result |
|---|---:|
| Task executions complete | 74 |
| Task executions failed | 0 |
| Source refresh complete | 62 |
| Source refresh partial | 0 |
| Source refresh failed | 12 |
| Hydration timeouts | 12 |
| Candidates found | 778 |
| New candidates inserted by normal ingestion | 4 |
| Existing candidates refreshed | 774 |
| Candidates discovered before extraction | 818 |
| Candidates fully extracted | 778 |
| Retryable source failures | 12 |
| Terminal failures | 0 |
| Context deaths | 0 |
| Quarantined candidates | 0 |
| Candidates queued for recovery | 0 |

The 40-record difference between `candidates_discovered` and `candidates_fully_extracted` occurred within successful source tasks and is not one of the 12 listing-bootstrap failures. The source results reported no extraction failures or quarantines; the counters reflect the driver's page/detail accounting rather than a task failure.

## 6. Complete failed-source matrix

All 12 failures had two attempts, no `/papi/bids`, no body text, no table/row/role-row DOM, no challenge/login/error banner, no page closure, and no browser disconnect. `401/401` means both OAuth refresh attempts returned HTTP 401; `CORS/CORS` means the browser rejected both refreshes as `net::ERR_FAILED` after the wildcard-origin/credentialed-request CORS error.

| Source | Task | Portal | Start UTC | Replica | Session | OAuth attempts | Last boot response | `/papi/bids` A1/A2 | Body A1/A2 | Result |
|---|---|---:|---|---|---|---|---|---|---|---|
| City of Burbank | `570d8cfa-3d4d-4584-9cea-5f03067bb9e3` | 14210 | 19:41:56 | `bfa4c8ce…` | `277969ed-ac90-4d80-94d5-3585082a0e4f` | CORS/CORS | server-time/version 202 | no/no | 0/0 | Class A |
| City of Chula Vista | `a07b6685-d76f-4f0f-a070-e707d97c0efa` | 15381 | 19:42:52 | `bfa4c8ce…` | `3592f76e-472d-4912-a44c-f0caab75bbc6` | CORS/CORS | version 202 | no/no | 0/0 | Class A |
| City of Eastvale | `726fc8d2-f8a1-401e-9f5c-13d3270ae691` | 43976 | 19:45:31 | `a6a6b392…` | `7cf9005a-21be-4164-95cb-f2b0e353d89f` | 401/401 | server-time/version 202 | no/no | 0/0 | Class A |
| City of Glendale | `9436fa61-65e6-4ba8-8582-630f2d3ad1a8` | 39503 | 19:45:37 | `80427552…` | `f69af73d-8003-44ba-b124-67fd941e176b` | 401/401 | t/version 202 | no/no | 0/0 | Class A |
| City of Newport Beach | `adc969f4-5b0d-42be-9121-72ebc034db02` | 22078 | 19:46:52 | `80427552…` | `2d28b40a-5803-4747-ac84-04e33f954883` | 401/CORS | version 202 | no/no | 0/0 | Class A |
| City of Pomona | `9394e433-f150-4b50-b26a-1d0cdc80bbe7` | 24662 | 19:48:32 | `6a9d44d5…` | `ee3154df-6afd-4e18-a0e1-ffdf57dc8c8e` | 401/401 | t/version 202 | no/no | 0/0 | Class A |
| City of Wildomar | `9a622a5b-ddaa-415c-9945-50b3de7cb357` | 66534 | 19:52:14 | `a6a6b392…` | `a53d2407-7d3a-4b57-acc9-71aceeeb91f8` | 401/401 | t/version 202 | no/no | 0/0 | Class A |
| Irvine Ranch Water District | `4877b38e-a68e-46ef-bab5-0e71640575f0` | 39499 | 19:54:06 | `a6a6b392…` | `fe1caef4-e7c9-4308-ad62-16016c7303ee` | 401/401 | version 202 | no/no | 0/0 | Class A |
| Long Beach Unified School District | `fadcd941-10bc-43a8-9ac4-4bb7f6a550ea` | 23758 | 19:54:23 | `6a9d44d5…` | `210a6eb8-142a-4dd9-9da4-2a70d4c4ad6a` | CORS/CORS | version 202 | no/no | 0/0 | Class A |
| Omnitrans | `4a184cce-7e45-473e-bf24-89efaa22e58a` | 18046 | 19:56:05 | `bfa4c8ce…` | `5e9f57e1-36e1-416b-8ff8-5f857ee7b595` | 401/401 | version 202 | no/no | 0/0 | Class A |
| Port of Long Beach | `fe794f1e-b757-4116-95de-d24a2155a23e` | 19236 | 20:00:26 | `a6a6b392…` | `e681c25e-37a1-404a-b9ea-c0a04d4551da` | 401/401 | version 202 | no/no | 0/0 | Class A |
| Port of Los Angeles | `9bd7734c-e381-4947-acdf-eec0a45a5a04` | 42217 | 20:00:27 | `80427552…` | `d057036d-5906-4592-88f5-4ae6a1f87680` | CORS/CORS | version 202 | no/no | 0/0 | Class A |

Attempt waits were tightly bounded at 15,025–15,299 ms. Each attempt recorded the same two page errors:

1. `SyntaxError: Unexpected end of JSON input`
2. `TypeError: Cannot read properties of undefined (reading 'data')`

Each attempt also logged token-refresh failure, cross-agency bootstrap/login failure, resource-load failure, and route `normalizeResponse` failure. Analytics/telemetry aborts were present but are incidental noise.

## 7. Successful-control matrix

Eight controls cover all four replicas and overlap the failure time window. Successful diagnostics intentionally retain a lighter payload, so absence of a stored console/network event on a control means it was not retained, not proof that the event never occurred.

| Control | Replica | Start UTC | Attempts | `/papi/bids` | API records | Render state | Rows / role rows | Page errors |
|---|---|---|---:|---|---:|---|---:|---:|
| Burbank-Glendale-Pasadena Airport Authority | `a6a6b392…` | 19:40:32 | 1 | 200 JSON | 30 | rows | 62 / 60 | 0 |
| City of Beverly Hills | `6a9d44d5…` | 19:40:50 | 2 | 200 JSON both | 30 each | fallback-success after timeout state | 62 / 60 | 0 |
| City of Carlsbad | `bfa4c8ce…` | 19:42:33 | 1 | 200 JSON | 30 | rows | 32 / 30 | 0 |
| City of Costa Mesa | `80427552…` | 19:44:50 | 2 | absent A1; 200 JSON A2 | 30 | A1 blank; A2 rows | 0 / 0; 32 / 30 | 0 |
| City of Norwalk | `6a9d44d5…` | 19:47:22 | 1 | 200 JSON | 30 | rows | 32 / 30 | 0 |
| City of Santa Ana | `bfa4c8ce…` | 19:50:55 | 1 | 200 JSON | 30 | rows | 62 / 60 | 0 |
| City of Temecula | `a6a6b392…` | 19:51:24 | 1 | 200 JSON | 30 | rows | 32 / 30 | 0 |
| City of Upland | `80427552…` | 19:51:44 | 1 | 200 JSON | 5 | rows | 32 / 30 | 0 |

All successful `/papi/bids` responses parsed as JSON:API objects, contained bid identifiers, and produced a populated body (4,047–8,245 characters in these controls). The lightweight shallow structure probe reported `records_have_titles=false` and `records_have_due_dates=false`; this means those fields were not present at the inspected top level, not that PlanetBids lacked them. Normal downstream extraction recovered the source rows.

The first reliable divergence is before rendering: successful controls receive `/papi/bids` HTTP 200 JSON; failed sources never issue that request after bootstrap exceptions.

## 8. Attempt-one versus attempt-two comparison

For every failed source:

- Attempt 1 and attempt 2 used the same Browserbase session and Playwright page.
- `/papi/bids` observations were `[false, false]`.
- Body-preview hashes were equal; both bodies were empty.
- DOM signatures differed only in nondeterministic shell/Stripe iframe HTML length, not meaningful application content.
- API chronology, console arrays, and failed-request arrays were not byte-identical because of timing and analytics noise, but the functional sequence was identical.
- The second attempt reproduced the same OAuth/bootstrap failures and page exceptions.
- Reload did not change page state or recover any failed source.

City of Costa Mesa is an informative successful control: attempt 1 was blank with no `/papi/bids`, while the same-page attempt 2 did reach `/papi/bids` and render rows. Reload can recover a benign delayed boot, but it did not recover the explicit auth/JSON/route-error signature seen in the 12 failures.

## 9. API chronology analysis

The common failed chronology was:

1. `POST /papi/oauth/refresh/` requested.
2. `POST /papi/t`, `GET /papi/server-time`, and `GET /papi/version` requested.
3. OAuth refresh returned 401 or was rejected by the browser as `net::ERR_FAILED` after a credentialed-request CORS error.
4. Boot endpoints returned HTTP 202.
5. At the `/papi/version`/normalization boundary the SPA threw JSON-parse and undefined-`data` exceptions.
6. The route stopped. No department/bid-type/listing sequence and no `/papi/bids` followed.

The final captured response was generally `/papi/version` 202; a few attempt-one captures ended on `/papi/t` or `/papi/server-time` 202 because responses were concurrent. There were no PlanetBids 4xx/5xx responses other than OAuth 401.

## 10. `/papi/bids` analysis

- Failed sources: 0/12 fired `/papi/bids` on attempt 1; 0/12 fired it on attempt 2.
- There is therefore no failed-source listing status, JSON parse result, response hash, record count, bid identifier, title, or due-date structure to analyze.
- Successful controls: `/papi/bids` returned HTTP 200, `application/vnd.api+json`, parsed successfully, and contained 5 or 30 inspected candidate records with bid identifiers.
- The evidence rules out Class B, C, D, and E for this failed cohort because the listing request was never reached.

## 11. JavaScript and console-error analysis

Across 12 sources × 2 attempts, the diagnostic payload retained 48 core page-error events: 24 JSON parse errors and 24 undefined-`data` TypeErrors. The exception order and timing show the JSON failure immediately preceding route normalization failure.

Console signatures repeated on each failed attempt:

- OAuth refresh CORS rejection or failed resource load
- `Token refresh failed`
- `Cross-agency bootstrap failed - user needs to login`
- `Error while processing route: portal.engine-bo.bo-search`
- `Cannot read properties of undefined (reading 'data')` in `normalizeResponse`

No challenge/CAPTCHA, login UI, or error banner rendered in the page.

## 12. Network-failure analysis

- OAuth refresh outcomes: 15 HTTP 401 responses; 9 CORS-blocked `net::ERR_FAILED` requests.
- The explicit CORS message states that wildcard `Access-Control-Allow-Origin: *` is invalid when the request credentials mode is `include`.
- Aborted Google Analytics, Clarity, LinkedIn, and tag-manager requests are nonfunctional telemetry noise and do not explain the route crash.
- No Browserbase session creation failure, CDP disconnect, target closure, page closure, or page disconnect occurred.
- No evidence supports rate-limit/concurrency failure as the primary cause: all four replicas produced successful adjacent sessions, and no Browserbase 429/503 was recorded in task results.

## 13. DOM and locator analysis

Every failed attempt reached `document.readyState=complete` and retained the static PlanetBids shell HTML (approximately 16.9–17.5 KiB), scripts, title, and one Stripe metrics iframe. However:

- Body text length: 0
- Application root present: false
- Tables: 0
- `<tr>` elements: 0
- Role rows: 0
- Alternate result/bid/opportunity rows: 0
- Shadow hosts: 0
- Loading indicators: 0
- Challenge text: false
- Login elements: false
- Error banners: 0
- Search button: absent
- API- or DOM-derived bid detail links: 0

The current row locator did not miss a rendered listing structure. The application route failed before any listing DOM existed.

## 14. Replica and Browserbase correlation

Failures occurred on all four Railway replicas, with successes on each replica before, between, and after failures. They used 12 unique Browserbase sessions and were spread from 19:41:56 through 20:00:27 UTC. No session handled more than one source. Existing candidate counts on failed sources ranged from 1 to 60, so portal/listing size does not explain the common pre-listing failure.

The last-seven-day task history is intermittent, not a fixed portal incompatibility. Every one of the 12 sources has at least four successful results since July 14. City of Burbank and City of Glendale each have three recent hydration timeouts; City of Chula Vista, Eastvale, Wildomar, Irvine Ranch Water District, and Omnitrans have two; the remaining five have one. This supports a session/bootstrap condition rather than invalid source configuration.

## 15. Evidence-based failure classifications

| Class | Count | Finding |
|---|---:|---|
| A — app boot stops before `/papi/bids` | 12 | Confirmed for every failed source |
| B — `/papi/bids` request fails | 0 | Request never fired |
| C — `/papi/bids` returns no usable records | 0 | No failed-source response exists |
| D — valid records but DOM does not render | 0 | Not observed in failed cohort |
| E — DOM renders but locator misses | 0 | Failed DOM was empty |
| F — page/session termination | 0 | No closure or disconnect |

## 16. Current data freshness and missed-opportunity risk

After the wave, current Source Health is:

| Healthy | Stale | Failed | Never scanned | Disabled |
|---:|---:|---:|---:|---:|
| 67 | 0 | 12 | 0 | 2 |

The controlled wave naturally moved the earlier partial/stale source back to healthy and changed the failed population based on actual scan outcomes; no status was edited manually.

The 12 failed sources currently have 144 stored candidates, 37 with future due dates. Candidate metadata on the failed sources was last refreshed between July 7 and July 20. Because none of the 12 sessions observed a listing response, the number of newly posted opportunities missed by this wave cannot be bounded. Existing candidates remain; the risk is failure to discover new or changed listings until a later successful refresh.

`last_refresh_completed_at` is updated on the failed path at the same time as `last_refresh_failed_at`, so it must not be interpreted as proof of a successful refresh. The authoritative indicators are `last_refresh_status='failed'`, the task error, and per-candidate metadata timestamps.

## 17. Confirmed root cause and ranked upstream hypotheses

**Confirmed functional root cause:** the PlanetBids anonymous SPA bootstrap fails before listing dispatch. OAuth refresh is unauthorized or CORS-blocked; a boot response is then parsed as JSON unsuccessfully; `normalizeResponse` dereferences missing `data`; the `bo-search` route aborts; `/papi/bids` never fires; no DOM renders.

The instrumentation does not capture the response body of `/papi/version` or Browserbase egress region/IP, so it cannot prove why some fresh sessions receive the broken bootstrap sequence while adjacent sessions succeed. Ranked upstream explanations:

1. **High confidence:** intermittent PlanetBids anonymous-auth/session bootstrap rejection. Direct evidence: OAuth 401/CORS in all 24 failed attempts, followed immediately by route exceptions; all sources also have recent successful runs.
2. **Medium confidence:** PlanetBids edge/API intermittently returns an empty or malformed 202 boot response to some fresh remote sessions, causing the JSON parse failure. Direct evidence confirms the 202→parse-error timing, but the boot response body was not retained.
3. **Low confidence:** source-specific portal skin or locator behavior. Intermittent history, blank bodies, and no `/papi/bids` contradict this as the cause of this cohort.
4. **Very low confidence:** Railway replica, Browserbase outage, concurrency, portal size, challenge page, or session termination. The wave supplies direct counterexamples for each.

## 18. Exact recommended functional fix

Implement a two-layer change in the PlanetBids worker:

1. **Early bootstrap-failure detection and truly fresh recovery.** During the initial navigation, treat OAuth refresh 401/CORS plus either bootstrap page exception as a definitive poisoned-bootstrap signal. Stop waiting the full 15 seconds, close the entire Browserbase session/context, create one new session/context/page, and navigate once. Do not reuse or reload the failed page. Preserve the one-recovery limit.
2. **Driver-owned API listing discovery.** Capture the exact successful `/papi/bids` request contract in tests/fixtures, including portal identifier, query parameters, required anonymous token/cookies, and JSON:API schema. Once a healthy bootstrap provides the request credentials, issue/parse the listing request in driver code and derive candidate/detail IDs from `data`. Use rendered DOM navigation only for fields that are not available authoritatively through the API. If the fresh bootstrap cannot establish valid anonymous credentials, return a specific `planetbids_bootstrap_auth_failed` retryable error rather than a generic hydration timeout.

The first layer is the smallest evidence-backed reliability fix. The second is the durable solution: listing discovery should not depend on whether the third-party Ember SPA paints a table.

Do not solve this by increasing timeouts, adding locator variants, increasing concurrency, or retrying the same page. The failed route has already crashed; more wait time cannot create `/papi/bids`.

## 19. Tests required for that fix

1. Unit fixture: OAuth refresh 401 + empty/malformed 202 version response produces early `planetbids_bootstrap_auth_failed` and never waits 15 seconds.
2. Unit fixture: credentialed OAuth CORS failure produces the same early classification.
3. Recovery test: first session bootstrap fails; first session is closed; second, distinct session reaches `/papi/bids`; exactly one recovery occurs.
4. Exhaustion test: both distinct sessions fail; no third session/task/retry is created.
5. API parser fixtures for JSON:API `data`, pagination/meta, empty results, malformed payload, 401/403/429/5xx, missing IDs, nested title/due-date attributes, and multi-page results.
6. API/DOM parity test against representative 5-, 30-, and 60-row portals.
7. Regression: an explicit empty portal is complete/empty, not failed.
8. Regression: existing candidate UUIDs are preserved and good fields are not overwritten with null.
9. Regression: normal source-health and task-result semantics remain unchanged except for the more specific bootstrap error.
10. Concurrency test: four workers cannot create more Browserbase sessions than existing limits permit.

## 20. Controlled validation required after that fix

1. Deploy the fix without changing replicas, concurrency, schedules, or timeouts.
2. Run one explicitly approved controlled wave containing the 12 failed sources plus at least eight same-replica controls; do not mix other portal families.
3. Require 12/12 current Class-A sources to reach `/papi/bids` or an authoritative explicit-empty state, with zero duplicate tasks/candidates and zero context deaths.
4. Compare API-derived candidate IDs/counts with rendered-page controls and manual authoritative portal checks.
5. Then require two consecutive normal midnight waves with zero `planetbids_listing_hydration_timeout` or `planetbids_bootstrap_auth_failed` outcomes before closing the incident.
6. Retain diagnostics during validation and verify no failure cluster by replica, session, or start time.

## 21. Evidence limitations

- Successful-task diagnostics are intentionally lightweight and do not retain full boot chronology, console events, or failed-request arrays. They confirm the successful `/papi/bids`/DOM state but cannot show whether a harmless OAuth warning also occurred.
- Non-listing boot response bodies and hashes were not retained. The 202 status and exception timing are known; the exact malformed/empty bytes are not.
- Browserbase region and egress IP were not captured.
- Screenshot persistence was unsupported; structural DOM snapshots were retained instead.
- `page_identity` serialized as `[object Object]`; same-page/session identity is still available through explicit comparison booleans.
- The successful shallow schema probe does not traverse nested JSON:API attributes, so title/due-date flags are not authoritative.
- This is one controlled wave. It confirms the failure mechanism, but validation of a fix still requires another approved controlled wave and two normal midnight waves.

## Appendix A — Failed-source candidate exposure

| Source | Stored candidates | Future due | Latest candidate metadata refresh |
|---|---:|---:|---|
| City of Chula Vista | 4 | 4 | 2026-07-20 07:20 UTC |
| Irvine Ranch Water District | 5 | 4 | 2026-07-18 07:15 UTC |
| City of Glendale | 13 | 10 | 2026-07-13 11:50 UTC |
| City of Wildomar | 3 | 3 | 2026-07-19 07:10 UTC |
| Omnitrans | 4 | 4 | 2026-07-20 07:13 UTC |
| Port of Los Angeles | 36 | 0 | 2026-07-20 07:04 UTC |
| City of Burbank | 3 | 3 | 2026-07-18 07:34 UTC |
| City of Eastvale | 1 | 1 | 2026-07-20 07:13 UTC |
| City of Newport Beach | 4 | 2 | 2026-07-14 16:59 UTC |
| City of Pomona | 7 | 3 | 2026-07-07 07:07 UTC |
| Long Beach Unified School District | 60 | 0 | 2026-07-20 07:19 UTC |
| Port of Long Beach | 4 | 3 | 2026-07-15 07:01 UTC |
| **Total** | **144** | **37** | — |

## Appendix B — Safety and stopping conditions

- Exactly one wave trigger was used.
- Exactly 74 unique enabled PlanetBids sources were queued once each.
- No disabled source and no non-PlanetBids source was queued.
- No failed source was retried after terminal completion.
- No second wave was queued.
- No code, environment variable, timeout, concurrency, replica, schedule, source configuration, migration, deployment, or frontend was changed.
- No source-health value was edited manually. Normal worker persistence produced 4 new candidates, refreshed 774 existing candidates, and updated source/task status as part of the authorized scan path.
- This report is intentionally uncommitted.

## Appendix C — Complete task, replica, and Browserbase session ledger

Replica labels: R1=`a6a6b392-3318-4a8f-93ec-7bd47ceed9af`; R2=`bfa4c8ce-e1a6-40ec-9cfb-6ba70c16bb05`; R3=`80427552-810b-4f6d-b81e-091c584919ac`; R4=`6a9d44d5-8c1c-4f12-92fb-2eb127754ed2`.

```text
Source | Task ID | Result | Replica | Browserbase session
Brea Olinda Unified School District | a95e5753-adbe-42fb-8814-f6a9a1ca57c9 | complete | R2 | 61dabb99-ae1d-47cf-9cb5-f2985f456571
Burbank-Glendale-Pasadena Airport Authority | eccaa952-0ef2-4294-b038-2e9c943d0d99 | complete | R1 | 11fab393-2607-4eaa-9378-5ff7a0cda948
Central Coast Water Authority | 0ddb1afc-ace5-4f8f-972a-672249ccda52 | complete | R4 | 70ff13b5-cb6a-49c2-89ac-4a03c63113da
Chaffey College | e0606c35-2ddf-49f2-9ea0-0e68bdc84fe5 | complete | R3 | 4a9b49b3-6e58-4295-80f5-9a4ec047d40f
City of Anaheim | cc25fbac-fdea-48eb-a5c8-f3374c02a7f6 | complete | R1 | 479de237-8b83-44e8-a0c1-af2b210d4d67
City of Beverly Hills | 5ed3083a-754b-4f37-9b54-d70221ee5d96 | complete | R4 | 67107465-87c9-4758-9e91-b3422f802197
City of Burbank | 570d8cfa-3d4d-4584-9cea-5f03067bb9e3 | failed | R2 | 277969ed-ac90-4d80-94d5-3585082a0e4f
City of Carlsbad | fdf1e38d-fb2f-4954-886b-d28b315c57ce | complete | R2 | 2f823767-fb80-4462-a425-b0bb2c6debfd
City of Chula Vista | a07b6685-d76f-4f0f-a070-e707d97c0efa | failed | R2 | 3592f76e-472d-4912-a44c-f0caab75bbc6
City of Corona | 5a374f2e-7ef2-46d3-94e2-eb3d7d18f89c | complete | R2 | 805e975d-c3d5-4191-8043-cf6e2a2372d8
City of Costa Mesa | 839767d1-f080-4c90-aa1f-c0e878c8d3b2 | complete | R3 | 099748ae-84b7-45b6-9af1-3120a097990c
City of Culver City | 059f0dc9-b526-4994-95ee-6b7cb52bd9e1 | complete | R2 | c8b49ca6-0bd1-48f3-90f8-1b1782aeed0c
City of Diamond Bar | 19ba4587-e661-485a-8589-280f184eeed3 | complete | R2 | 7b25f3a6-5fb1-47e7-b578-3997fa7ed319
City of Duarte | 57caa623-7d99-45b6-a8d2-753fc9ea4e04 | complete | R3 | efbfcdb7-2f91-4ba0-a011-9dacb75beed3
City of Eastvale | 726fc8d2-f8a1-401e-9f5c-13d3270ae691 | failed | R1 | 7cf9005a-21be-4164-95cb-f2b0e353d89f
City of Gardena - GTrans | f243b03d-ebd2-458c-931a-3d7f5d5edbbd | complete | R2 | a23c87d3-6908-4692-b93c-a03da1c51237
City of Glendale | 9436fa61-65e6-4ba8-8582-630f2d3ad1a8 | failed | R3 | f69af73d-8003-44ba-b124-67fd941e176b
City of Huntington Beach | 329a0da5-9fbf-4c00-a807-3ccc7929ccb5 | complete | R4 | e6b87d9f-642e-44c9-9632-4c92860614f0
City of Huntington Park | 7c77e501-0979-4bf0-b984-3766b3cde69c | complete | R1 | 203db762-150c-4c55-b9ec-efb3b66733cf
City of Indio | 86c1da5f-0438-4680-ab8c-0bd1d5d35bc6 | complete | R4 | e22eac35-c145-49a1-8cfc-b4c4a2aa7642
City of Inglewood | d938cc1b-d7df-4d86-b705-c10ac7438572 | complete | R3 | f0224082-7782-44d2-9ee8-1c83ec1bcc6c
City of Irvine | c3347827-f1fa-41b8-8852-eb5d6ae0deaa | complete | R1 | 070ea66f-9e3b-4dd2-bebd-34309000ce0d
City of Jurupa Valley | 8a2b8243-ed47-4a6b-a861-43ddb732a363 | complete | R4 | a5959238-7022-4064-ac31-b2668f87b735
City of La Canada Flintridge | 2d09db5b-7bec-4dec-a65c-987c7812366a | complete | R4 | 914a641c-c5d0-42bd-af8e-89fe2c3cb552
City of Moreno Valley | 2493c25e-5ec6-4df6-a621-c3f264ce6800 | complete | R1 | 7672264b-7d4f-49fd-88f9-2995aa91dbd0
City of Murrieta | d0e973c5-082c-4d2d-8156-def64ec4eb25 | complete | R4 | c107ba21-07f0-466f-bda4-89d905c14ff4
City of National City | f551e9a9-ad97-45d4-8b39-0ad2f7839436 | complete | R1 | a18cf13f-bd19-42d5-bac4-577bd88ef9bd
City of Newport Beach | adc969f4-5b0d-42be-9121-72ebc034db02 | failed | R3 | 2d28b40a-5803-4747-ac84-04e33f954883
City of Norwalk | 36d6d0b7-03bf-429e-b753-db1e0c1ff480 | complete | R4 | 654dc193-fe8f-4d55-9910-830d792590b1
City of Ontario | 0c7dd692-bae9-41bd-b760-1a46042443c1 | complete | R3 | c9e15113-8b6a-4468-991d-792a5e8b5ee2
City of Palm Springs | fee36973-b4ac-48f1-a16d-f186f69f597e | complete | R4 | c57f0b1b-2300-4e13-b753-0ec9e155584f
City of Palmdale | f9ffcc03-1207-4fd2-bbad-ddaf88ae7997 | complete | R3 | e42286e9-fba3-454e-9737-e62bb2985902
City of Pomona | 9394e433-f150-4b50-b26a-1d0cdc80bbe7 | failed | R4 | ee3154df-6afd-4e18-a0e1-ffdf57dc8c8e
City of Redlands | adda760c-fb85-4c4c-8909-db3cfee98b63 | complete | R4 | 93313f7b-f591-4c43-a317-2cbb1e16ea97
City of Riverside | 7808dd28-1554-42a7-96ba-46accb4774bd | complete | R3 | 1453f99f-e17c-4027-b955-ce16a64943c6
City of San Diego | 43a06181-a039-42ce-8d99-f837cd3f1550 | complete | R4 | 3ac4a910-924a-4a16-8ede-851748d5a238
City of Santa Ana | ff4c02e8-247d-4da9-a5ce-c6047b90d90c | complete | R2 | f9f8991a-ec39-4cea-a40d-87c178de39c7
City of Santa Fe Springs | ca2ef1ec-0581-4a71-878a-14c01df292c1 | complete | R1 | 05078aa3-d0cf-4421-9895-c4a4495a3685
City of Seal Beach | c3d90428-7c2b-40bf-a04f-b658fb5cacd6 | complete | R1 | 32faca9d-257c-44bb-afca-06f2e5ecec84
City of Temecula | 1c817fdf-fa95-4f76-b0fd-69b8429f04f8 | complete | R1 | f87099d5-dbf8-4b47-b8c4-b7d3ca048d9e
City of Torrance | f7568bc5-743f-4362-82a6-12dba6d4e836 | complete | R3 | 98b03baa-bff7-4916-8422-f19d2448dab5
City of Upland | 958bb171-ec9b-427e-b98b-696fd733a07a | complete | R3 | 3ca653a6-539d-4880-962b-fa0350f82f13
City of West Hollywood | 21a10f7b-32c8-41a4-a915-931b7c13a438 | complete | R3 | 6fed5e8c-19a1-4133-b04f-5205c668ff72
City of Westlake Village | 03e1f668-7bd9-4ec9-a31f-d8f51ce35bba | complete | R3 | 440145f4-a935-4b52-8510-4e1ff0a38995
City of Wildomar | 9a622a5b-ddaa-415c-9945-50b3de7cb357 | failed | R1 | a53d2407-7d3a-4b57-acc9-71aceeeb91f8
Downey Unified School District | ab92e942-cc8c-4cb8-84bb-3c6774e76383 | complete | R2 | 8f9e07f6-670f-475c-9e67-7d70f09199e9
Elsinore Valley Municipal Water District | 2ae9f95a-974d-4c84-90a2-4435f4e81de3 | complete | R1 | 6d839136-5aca-47a3-a11c-6afdcbe300c5
Imperial County Department of Public Works | b911c577-dadb-43fb-9048-51711afe5809 | complete | R1 | 6b20fcc0-7825-4801-9e26-ee8c063f85c6
Inland Empire Utilities Agency | 93ac5f9c-82db-4a07-ae74-d047903cddfa | complete | R1 | 3b419906-76c3-484e-87ce-9bb58d851375
Irvine Ranch Water District | 4877b38e-a68e-46ef-bab5-0e71640575f0 | failed | R1 | fe1caef4-e7c9-4308-ad62-16016c7303ee
Long Beach Unified School District | fadcd941-10bc-43a8-9ac4-4bb7f6a550ea | failed | R4 | 210a6eb8-142a-4dd9-9da4-2a70d4c4ad6a
Los Angeles Community College District | 2be99e91-1632-4d35-af24-cec15cdca3b4 | complete | R1 | aad084eb-5556-45ae-ae95-482afff7a4f0
Los Angeles County Office of Education | 3e53d9e6-98b9-4cfd-bd13-5720fc2ca019 | complete | R4 | 5b54e81c-73f5-4241-a0fa-c6a390fa47c7
Los Angeles World Airports | e4dfcc98-99bb-4fa4-bee5-dd9042537382 | complete | R3 | 16e6a079-22a1-496e-8843-a1d65c9c1154
Metropolitan Water District of Southern California | 86af1d7c-22ae-4db5-952d-6b39688af600 | complete | R1 | e45f24fd-21e8-42b3-bc43-d57f68e80a73
MiraCosta Community College District | ad664459-b25c-4a34-9d73-0c806c1966dc | complete | R1 | 39158696-c685-4b8a-8280-740ef8601d35
Omnitrans | 4a184cce-7e45-473e-bf24-89efaa22e58a | failed | R2 | 5e9f57e1-36e1-416b-8ff8-5f857ee7b595
Newport-Mesa Unified School District | f4a29355-539a-4530-a349-1939082dfff7 | complete | R2 | 2c69fcfe-8abd-493a-92d1-0f00913a634b
Orange County Fire Authority | 2487e7f1-1d1e-4dc1-8106-5faeb4933cbd | complete | R2 | 80d86d61-a7f6-42f1-914c-2355848a5e50
Orange Unified School District | c5f1f15d-5aeb-4556-8b31-f8195687a462 | complete | R2 | 0ed6b077-8ebe-4918-b7d7-b2216ed6ba10
Moreno Valley Unified School District | 133b0f6a-f8f8-4b63-ad90-d846d605ad32 | complete | R3 | 589b7081-86da-4ecc-940d-8a978caf7031
Orange County Sanitation District | b610c3aa-0851-4a43-9dd8-8f9ebb784934 | complete | R2 | f7c5452e-884c-43f9-b4de-c970935cf651
Rio Hondo Community College District | 2a02af68-4921-4328-a58e-4698dc1336a4 | complete | R3 | 69fd629e-45e8-4870-b1c0-d26aa236192a
Santa Clarita Community College District | 9f939b9b-0170-4cea-a17a-4e2f80447bd7 | complete | R4 | 98757d9a-a63a-486e-83cb-7080555a6836
San Diego County Regional Airport Authority | 9ae5fc04-5112-4362-9612-7083e4c0a071 | complete | R3 | 52c104e4-97f5-4a89-896f-2296141261c4
San Bernardino County Transportation Authority | 59713eac-1a6a-4a6c-8e64-0cb4c28574fa | complete | R1 | e8eb9eab-8b3b-4c03-989f-29944bf127fc
Port of Long Beach | fe794f1e-b757-4116-95de-d24a2155a23e | failed | R1 | e681c25e-37a1-404a-b9ea-c0a04d4551da
Port of Los Angeles | 9bd7734c-e381-4947-acdf-eec0a45a5a04 | failed | R3 | d057036d-5906-4592-88f5-4ae6a1f87680
Rim of the World Recreation and Park District | 06fc7d95-526c-445e-99bd-a2fd84bff286 | complete | R1 | 1084b325-1e9a-47b5-9e8e-1c47c2f96b37
San Diego Unified School District | e53190e0-d70d-4142-a11f-b91c627e0d23 | complete | R3 | 6d1ced60-f296-475c-9504-675620120444
Santa Margarita Water District | 296e6533-be31-4d24-be8c-ea59bd9c716d | complete | R1 | 6da1c670-b88f-464f-abc3-76f4ac54e064
Val Verde Unified School District | 4321dfd7-066c-40d5-bf5f-dd955c41a1cd | complete | R1 | 1512913f-7918-4c72-991c-dce7580b03a9
Transportation Corridor Agencies | b50eeeec-a71b-4d44-b1f9-af902d7481c1 | complete | R4 | a04f25dd-90dc-4e19-a234-c614b1585819
Santa Clarita Valley Water Agency | 67c9c86e-f651-454c-965e-231eadd518c3 | complete | R4 | 86453e0b-4bbf-480f-b416-45e3004cc152
```

## Implementation follow-up — fresh-session recovery (2026-07-20)

The immediate evidence-backed mitigation is now implemented locally. It has not been pushed, deployed, or production-validated.

### Functional fix

The PlanetBids listing wait can now return `bootstrap_failed` before the ordinary 15-second ceiling when all parts of the production-observed compound signature are present:

- `/papi/bids` has not been observed;
- no rows or authoritative explicit-empty state exists;
- the body is blank or the application root has not initialized;
- an anonymous bootstrap/auth failure is present (OAuth refresh HTTP 401, credentialed CORS/`ERR_FAILED`, token-refresh failure, or equivalent cross-agency bootstrap failure); and
- a route/bootstrap exception is present (`Unexpected end of JSON input`, undefined `data`, or the equivalent `normalizeResponse` failure).

A 750 ms grace period begins after the auth and route-error portions of the compound signature are both present. Rows, invalid-portal evidence, and explicit-empty evidence remain authoritative and are checked before the failure detector.

For this failure class only, the driver finalizes attempt-one diagnostics, closes the page and context, closes the CDP browser, explicitly requests release of the same Browserbase session, and only then creates a fresh session with new context/page identities. It runs the normal listing flow once in the replacement session. The maximum remains two sessions per source.

- If session two reaches rows or an authoritative explicit-empty state, normal scan processing continues.
- If session two repeats the compound signature, the retryable classification is `planetbids_bootstrap_auth_failed` and no third session or task is created.
- If session two reaches a different failure, that failure keeps its existing classification.
- Ordinary hydration timeouts retain the existing bounded same-session reload and `planetbids_listing_hydration_timeout` classification.
- Invalid portals and explicit-empty portals retain their existing terminal/success semantics and do not open a fresh session.

Cleanup is ordered, best-effort, scoped to the current scan's session ID, and recorded in bounded diagnostics. Recovery does not open session two unless session one was successfully closed or released by at least one safe terminal mechanism. The existing Browserbase session-creation gate and configured concurrency remain unchanged.

### Instrumentation

`planetbids_hydration_diagnostics_v1` remains the telemetry field and retains the prior evidence. Backward-compatible recovery fields now include the recovery strategy and trigger, bootstrap signature/timing, per-attempt Browserbase session and page/context identities, first-session cleanup outcome, second-session creation outcome, recovery result, final cleanup outcome, and final error classification. Fresh-session attempt comparisons report different session and Playwright identities. Existing redaction and payload caps remain in force.

### Regression coverage and validation

Focused tests cover HTTP 401 and credentialed-CORS variants, compound-signature timing, isolated-signal and recovery no-overtrigger cases, fresh-session success, repeated failure, different second-session failure, ordinary-timeout preservation, explicit empty and invalid portal behavior, ordered cleanup, session non-overlap, unsafe-cleanup abort, remote release scoping, distinct diagnostic identities, redaction, and payload caps.

Validation results:

- Focused recovery/diagnostics/session tests: 39 passed, 0 failed.
- Full PlanetBids suite: 77 passed, 0 failed (baseline: 57 passed).
- Full worker suite: 131 passed, 0 failed (baseline: 115 passed).
- Full project suite: 218 passed, 0 failed (baseline: 202 passed).
- Changed JavaScript syntax checks: passed.
- TypeScript (`tsc --noEmit`): passed.
- Production build: passed with only pre-existing bundle-size/dynamic-import and Browserslist-age warnings.
- Scoped ESLint: passed.

No direct `/papi/bids` listing ingestion, pagination, candidate mapping, timeout, concurrency, scheduling, source configuration, UI, database, or production behavior was changed beyond the bounded fresh-session recovery code. The durable architecture is recorded separately at [PlanetBids Driver-Owned Listing Discovery Through `/papi/bids`](../initiatives/planetbids-direct-api-listing-discovery.md).
