-- Seed Cal eProcure as a statewide aggregator source.
--
-- This source is inserted disabled so production schedulers do not pick it up
-- until Phase 1 Browserbase validation is complete. The conflict update avoids
-- touching scan_enabled / refresh_enabled so an operator can safely enable it
-- after validation without a later migration re-disabling it.

INSERT INTO opportunity_sources (
  name,
  portal_type,
  listing_url,
  scan_enabled,
  scan_interval_hours,
  refresh_enabled,
  refresh_cadence_hours
)
VALUES (
  'Cal eProcure',
  'caleprocure',
  'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx',
  false,
  24,
  false,
  24
)
ON CONFLICT (listing_url) DO UPDATE
  SET name                  = EXCLUDED.name,
      portal_type           = EXCLUDED.portal_type,
      scan_interval_hours   = EXCLUDED.scan_interval_hours,
      refresh_cadence_hours = EXCLUDED.refresh_cadence_hours;

INSERT INTO portal_drivers (portal_type, driver_name, driver_mode, enabled)
VALUES ('caleprocure', 'caleprocure_driver', 'browserbase', true)
ON CONFLICT (portal_type) DO UPDATE
  SET driver_name = EXCLUDED.driver_name,
      driver_mode = EXCLUDED.driver_mode,
      enabled     = EXCLUDED.enabled;
