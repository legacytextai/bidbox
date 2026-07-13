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

## Rollback

- Disable automatic recovery by setting `planetbids_recovery_automatic_enabled.enabled` to false.
- Stop new worker task processing by pausing Railway if required.
- Do not delete candidates or qualification history.
- Frontend/Edge code can be rolled back while the additive tables remain.
- Existing active qualification version remains available even if a new job fails.
