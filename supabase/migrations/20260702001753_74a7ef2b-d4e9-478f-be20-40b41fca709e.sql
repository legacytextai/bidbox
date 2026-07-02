-- Seed LA County DPW source (disabled) and register portal driver
INSERT INTO opportunity_sources (
  name, portal_type, listing_url, scan_enabled, scan_interval_hours,
  refresh_enabled, refresh_cadence_hours
) VALUES (
  'Los Angeles County Department of Public Works',
  'lacounty_dpw',
  'https://dpw.lacounty.gov/contracts/Opportunities.aspx',
  false, 24, false, 24
)
ON CONFLICT (listing_url) DO UPDATE
  SET name                  = EXCLUDED.name,
      portal_type           = EXCLUDED.portal_type,
      scan_interval_hours   = EXCLUDED.scan_interval_hours,
      refresh_cadence_hours = EXCLUDED.refresh_cadence_hours;

INSERT INTO portal_drivers (portal_type, driver_name, driver_mode, enabled)
VALUES ('lacounty_dpw', 'lacounty_dpw_driver', 'http', true)
ON CONFLICT (portal_type) DO UPDATE
  SET driver_name = EXCLUDED.driver_name,
      driver_mode = EXCLUDED.driver_mode,
      enabled     = EXCLUDED.enabled;