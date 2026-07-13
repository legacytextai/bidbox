# Opportunity recovery and qualification rollout

Status: code complete; production rollout is gated. Apply in the order below.

## 1. Lovable: additive schema first

Apply `supabase/migrations/20260713233000_opportunity_recovery_and_qualification_jobs.sql`.

Verify:

```sql
select to_regclass('public.qualification_jobs'),
       to_regclass('public.opportunity_recovery_audits');

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'opportunity_candidates'
  and column_name like 'recovery_%'
order by column_name;

select key, value
from public.app_settings
where key = 'planetbids_recovery_automatic_enabled';
```

The setting must remain `{ "enabled": false }` through the representative dry run and controlled 10-record write batch.

The migration is additive with one deliberate qualification-key change: existing per-user qualification rows become active profile version `0`; the primary key becomes `(user_id, opportunity_candidate_id, profile_version)` so a new result set can be staged without destroying the last complete set.

## 2. Lovable: Edge Functions

Deploy these functions from the same commit:

- `qualify-candidates` — compatibility endpoint now returns HTTP 202 after queuing a durable rebuild.
- `refresh-opportunities` — queues at most 100 due recoveries during the nightly window, only when the recovery setting is enabled.
- `scan-opportunities` — removes the premature synchronous qualification call; database fanout handles completed candidate writes.

Verify an unauthenticated call to `qualify-candidates` returns 401. With an authenticated test user and an existing Bid Profile, verify it returns 202 and creates one `qualification_jobs` row plus one pending `qualification_rebuild` task.

## 3. Railway worker

Deploy the current `phase1-opportunity-intelligence` commit to the `bidbox` Railway service. Required existing variables remain:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `PLANETBIDS_EMAIL`
- `PLANETBIDS_PASSWORD`

Optional tuning:

- `PLANETBIDS_SCAN_DETAIL_TIMEOUT_MS` (default 15000)
- `PLANETBIDS_RECOVERY_DETAIL_TIMEOUT_MS` (default 45000)

The existing distributed PlanetBids login lock is retained and is stricter than the approved maximum of two recovery sessions: only one shared PlanetBids account session runs globally, preventing session invalidation.

Verify logs show the worker polling and no missing-column, missing-table, RLS, crash-loop, or unsupported-task errors.

## 4. Lovable: frontend Publish

Publish the frontend from the same commit. Validate:

1. Saving Bid Profile returns the button to normal immediately.
2. The page shows “Opportunity evaluation in progress” with durable counts.
3. Navigation and refresh preserve the status.
4. Opportunities shows the updating banner and keeps the prior active results.
5. Completion refreshes cards automatically.
6. Failure retains prior results and exposes Retry.
7. Missing rows read “Not yet evaluated”.
8. Unknown county reads “County not verified” and remains visible.

## 5. Riverside controlled rebuild

After schema, worker, Edge Functions, and frontend are live, save or explicitly queue the existing Riverside profile. Do not include IDs or credentials in public logs.

Validate the job and active version:

```sql
select status, total_candidates, processed_candidates,
       green_count, yellow_count, red_count,
       query_time_ms, evaluation_time_ms, upsert_time_ms,
       started_at, completed_at
from public.qualification_jobs
where bid_profile_id = '<riverside-profile-id>'
order by created_at desc
limit 1;
```

Confirm known non-Riverside counties are red, Riverside remains visible, unknown county is yellow with `County not verified`, and only the owning user can read the job/results.

## 6. PlanetBids guarded rollout

Keep automatic recovery disabled.

1. Select exactly 10 representative legacy candidate IDs spanning at least five agencies and all required evidence/error categories.
2. Queue dry-run tasks only:

```bash
railway run --service bidbox node bidbox-worker/scripts/queue-planetbids-recovery.js \
  --candidate-ids=<comma-separated-10-ids> --limit=10 --trigger=representative_dry_run
```

3. Review all 10 task results. No candidate/audit write occurs in dry-run mode.
4. If sound, queue the same exact 10 IDs with writes enabled:

```bash
railway run --service bidbox node bidbox-worker/scripts/queue-planetbids-recovery.js \
  --candidate-ids=<comma-separated-10-ids> --limit=10 --trigger=controlled_write_10 \
  --write --confirm-existing-only
```

5. Stop on any approved threshold breach. Verify candidate UUIDs, related document/downstream counts, duplicate counts, unrelated-row checks, and non-null regression checks before expanding.
6. Queue the remaining approved historical IDs in waves of at most 100. Checkpoint after every wave.
7. Enable automatic recovery only after controlled validation passes:

```sql
update public.app_settings
set value = '{"enabled":true}'::jsonb, updated_at = now()
where key = 'planetbids_recovery_automatic_enabled';
```

Never construct the wave population from newly created rows; use the frozen historical candidate ID set.

### Representative dry run completed (2026-07-13)

The read-only gate ran directly through the deployed recovery driver with no candidate, audit, or task writes. It covered 10 existing UUIDs across 10 agencies: three sources that no longer resurfaced, recent resurfacing sources, one quarantined row, records with acquired documents, records without documents, and Downey's known error-page source.

| Candidate | Agency | Documents | Source | Title | Due date (UTC) | Runtime |
|---|---|---:|---|---|---|---:|
| `a54c998c-8805-46b2-8d8d-0930781f4e47` | City of Diamond Bar | 8 | listing API | Diamond Bar Facilities Private Event Security | 2025-04-25 01:00 | 10.550s |
| `bd7975a1-ec44-4776-8725-8fb7ce13fdc8` | Burbank-Glendale-Pasadena Airport Authority | 28 | listing API | Self-Park Management, Valet Parking, and Courtesy Shuttle Services | 2023-05-22 23:00 | 11.525s |
| `b6ca4405-ac66-4460-9dea-d667316a4a38` | Orange Unified School District | 42 | listing API | Install OFCI Door Entry Access Control at Multiple Sites. | 2025-12-22 22:00 | 10.959s |
| `41d7afd6-1c88-4602-a882-34aed29f05d6` | Santa Clarita Community College District | 12 | listing API | Compact CNC Turning Centers | 2022-07-07 22:00 | 9.327s |
| `a6cff9c3-b260-4fa3-ac55-837ed066f397` | City of National City | 37 | listing API | Bayshore Bikeway Segment 5 and Connections (PLA project) | 2025-07-23 00:00 | 10.169s |
| `502200ab-bde8-4f4b-96bf-ef20168fd72c` | City of Anaheim | 14 | listing API | TREE TRIMMING, CARE, AND MAINTENANCE SERVICES FOR ARMD EAST | 2024-12-17 22:00 | 9.437s |
| `feb2828a-1a45-416a-9b71-c25eecac254a` | Orange County Sanitation District | 40 | listing API | P1-138, INDUSTRIAL CONTROL SYSTEM AND IT DATA CENTER RELOCATION AT PLANT NO. 1 | 2024-11-21 19:00 | 9.869s |
| `8af9049a-cbec-40e7-82c8-d8cd3a312d59` | MiraCosta Community College District | 0 | listing API | College for Kids Mailer 2023 | 2022-12-15 18:00 | 10.914s |
| `4671ee56-d809-499c-95cd-458cfd6cf026` | Downey Unified School District | 0 | listing API | Downey USD Food Services Asian Inspired Food products | 2025-07-11 19:00 | 9.565s |
| `82bbf99e-9ae5-4780-9f10-c86e64c71fb4` | Chaffey College | 0 | listing API | BID NO. 2025CS593 MOBILE DIGITAL X-RAY SYSTEM | 2025-05-01 21:00 | 10.511s |

Result: 10 attempted, 10 title recoveries, 10 due-date recoveries, 0 unresolved, 0 context deaths, 0 portal error pages, 0 database writes. Cumulative end-to-end runtime was 102.826 seconds. All dates are historical. The matched listing rows did not expose a reliable status value, so status is intentionally unknown pending later evidence. Exact Browserbase billed session-minutes were not emitted by the API result and are not inferred here.

The controlled write gate remains blocked until the additive migration is applied; production did not yet expose the recovery columns/audit table at the time of this dry run.

## Rollback

- Disable automatic recovery by setting `planetbids_recovery_automatic_enabled.enabled` to false.
- Stop new worker task processing by pausing Railway if required.
- Do not delete candidates or qualification history.
- Frontend/Edge code can be rolled back while the additive tables remain.
- Existing active qualification version remains available even if a new job fails.
