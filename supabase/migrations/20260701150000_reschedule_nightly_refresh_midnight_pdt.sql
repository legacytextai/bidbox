-- Reschedule nightly opportunity refresh from 09:00 UTC (02:00 AM PDT) to
-- 07:00 UTC (00:00 AM PDT / midnight Pacific Daylight Time).
--
-- The original schedule (0 9 * * *) was set when the job was created on
-- 2026-06-30. The intent was midnight Pacific but the UTC offset was
-- calculated incorrectly. PDT is UTC-7, so midnight PDT = 07:00 UTC.
--
-- Note: during PST (winter, UTC-8), 07:00 UTC = 23:00 PST the previous
-- evening. If midnight PST is required in winter, use 08:00 UTC instead.
-- 07:00 UTC is the correct value for midnight PDT (summer operation).

SELECT cron.unschedule('nightly-refresh-opportunities');

SELECT cron.schedule(
  'nightly-refresh-opportunities',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/refresh-opportunities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := jsonb_build_object(
      'trigger', 'nightly_cron',
      'force', true
    )
  );
  $$
);
