-- Replace the existing nightly-refresh-opportunities cron with a corrected body + midnight-PT schedule.
DO $$
DECLARE
  v_jobid BIGINT;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'nightly-refresh-opportunities';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'nightly-refresh-opportunities',
  '0 7 * * *',  -- 00:00 America/Los_Angeles during PDT (UTC-7). During PST this runs at 11pm PT; acceptable given pg_cron uses UTC.
  $CRON$
  SELECT net.http_post(
    url := 'https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/refresh-opportunities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0dXlqbHl1emFzYmNlZXBlenVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTY3ODYsImV4cCI6MjA3OTQ5Mjc4Nn0.6FNzhggKKaWf0jAixg3MzdYUMTj22JK9853oMPP-Nu0',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp0dXlqbHl1emFzYmNlZXBlenVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTY3ODYsImV4cCI6MjA3OTQ5Mjc4Nn0.6FNzhggKKaWf0jAixg3MzdYUMTj22JK9853oMPP-Nu0'
    ),
    body := jsonb_build_object(
      'trigger', 'nightly_cron',
      'trigger_reason', 'nightly_cron',
      'force', true,
      'scheduled_at', now()
    )
  ) AS request_id;
  $CRON$
);