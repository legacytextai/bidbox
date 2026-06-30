-- Nightly opportunity refreshes are autonomous full-source scans.
-- Manual refresh cadence must not suppress the scheduled overnight run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-refresh-opportunities') THEN
    PERFORM cron.unschedule('nightly-refresh-opportunities');
  END IF;
END $$;

SELECT cron.schedule(
  'nightly-refresh-opportunities',
  '0 9 * * *',
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
