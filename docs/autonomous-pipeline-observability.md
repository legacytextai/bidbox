# Autonomous Opportunity Pipeline — Operations & Observability

## Scheduler

A single pg_cron job triggers the entire nightly pipeline:

- Job name: `nightly-refresh-opportunities`
- Schedule: `0 9 * * *` UTC (≈ 01:00–02:00 Pacific)
- Calls: `POST /functions/v1/refresh-opportunities` with `{ trigger_reason: "scheduled_refresh" }`

### Verify the scheduler exists and is active
```sql
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'nightly-refresh-opportunities';
```

### See last 10 cron runs
```sql
SELECT runid, job_pid, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'nightly-refresh-opportunities')
ORDER BY start_time DESC
LIMIT 10;
```

## One-time backfill sentinel
```sql
SELECT * FROM app_settings WHERE key = 'one_time_oi_backfill_completed';
```
Present ⇒ backfill has already run. Absent ⇒ next refresh-opportunities invocation will execute it.

## Refresh status per source
```sql
SELECT name, last_refresh_status, last_refresh_queued_at, last_refresh_completed_at, last_refresh_error
FROM opportunity_sources
WHERE scan_enabled = true
ORDER BY last_refresh_queued_at DESC NULLS LAST;
```

## Task pipeline health
```sql
SELECT task_type, status, COUNT(*)
FROM agent_tasks
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY 1,2 ORDER BY 1,2;
```

Expected daily task types: `planetbids_scan`, `caltrans_scan`, `project_analysis`,
`document_processing`, `project_intelligence`.

## Recent failures
```sql
SELECT id, task_type, error, created_at
FROM agent_tasks
WHERE status = 'failed' AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

## Opportunity lifecycle distribution
```sql
SELECT opportunity_lifecycle_status, opportunity_intelligence_status, COUNT(*)
FROM opportunity_candidates
GROUP BY 1,2 ORDER BY 1,2;
```

## Manual trigger (for ops / re-runs)
```bash
curl -X POST https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/refresh-opportunities \
  -H "Content-Type: application/json" \
  -H "apikey: <anon key>" \
  -d '{"trigger_reason":"manual","force":true}'
```

`force: true` bypasses the per-source `refresh_cadence_hours` gate.

## Definition of "the autonomous pipeline ran last night"
1. `cron.job_run_details` shows a successful run for `nightly-refresh-opportunities` after 09:00 UTC.
2. `opportunity_sources.last_refresh_queued_at` advanced for all enabled sources.
3. Scan tasks created and completed in `agent_tasks` (`status='complete'`).
4. New candidates appear in `opportunity_candidates` with `created_at` in the window.
5. Newly discovered candidates progress to `opportunity_intelligence_status='ready'`.
