
-- Seed Cal eProcure portal driver + single source (Phase 1 metadata-only)
INSERT INTO public.portal_drivers (portal_type, driver_name, driver_mode, enabled)
VALUES ('caleprocure', 'caleprocure_driver', 'browserbase', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.opportunity_sources (
  name,
  portal_type,
  listing_url,
  scan_enabled,
  refresh_enabled,
  scan_interval_hours,
  refresh_cadence_hours
)
SELECT
  'California eProcure (Cal eProcure)',
  'caleprocure',
  'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx',
  false,
  false,
  24,
  24
WHERE NOT EXISTS (
  SELECT 1 FROM public.opportunity_sources WHERE portal_type = 'caleprocure'
);
