-- Add crawl_changes column to store detected changes from re-crawls
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS crawl_changes jsonb DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.projects.crawl_changes IS 'Stores detected changes from the latest re-crawl (e.g., bid_due_at changes). Null when no changes detected.';

-- Create cron job for nightly re-crawl of One Link projects
-- Runs at 10:00 UTC (2:00 AM PST / 3:00 AM PDT)
SELECT cron.schedule(
  'daily-recrawl-one-link-projects',
  '0 10 * * *',
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