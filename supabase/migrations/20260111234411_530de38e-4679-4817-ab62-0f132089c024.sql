-- Update the daily re-crawl cron job to run at 5:00 AM PST (13:00 UTC)
SELECT cron.unschedule('daily-recrawl-one-link-projects');

SELECT cron.schedule(
  'daily-recrawl-one-link-projects',
  '0 13 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/recrawl-projects',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('supabase.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);