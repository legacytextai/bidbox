-- portal_drivers: maps portal_type values to their acquisition driver
-- Determines which driver scan-opportunities uses for each source type.
-- driver_mode reflects the underlying execution strategy (firecrawl, stagehand, browserbase).

CREATE TABLE public.portal_drivers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_type text        NOT NULL UNIQUE,
  driver_name text        NOT NULL,
  driver_mode text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.portal_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read portal drivers"
  ON public.portal_drivers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write portal drivers"
  ON public.portal_drivers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Seed: all current portal types map to firecrawl_driver
-- Update planetbids row to planetbids_driver once Phase C2 is complete.
INSERT INTO public.portal_drivers (portal_type, driver_name, driver_mode)
VALUES
  ('planetbids', 'firecrawl_driver', 'firecrawl'),
  ('caltrans',   'firecrawl_driver', 'firecrawl'),
  ('simple_html','firecrawl_driver', 'firecrawl');
