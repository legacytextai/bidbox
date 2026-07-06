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
  'Los Angeles County Metropolitan Transportation Authority',
  'lacmta',
  'https://business.metro.net/webcenter/portal/VendorPortal/pages_home/solicitations/openSolicitations',
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
VALUES ('lacmta', 'lacmta_driver', 'browserbase', true)
ON CONFLICT (portal_type) DO UPDATE
  SET driver_name = EXCLUDED.driver_name,
      driver_mode = EXCLUDED.driver_mode,
      enabled     = EXCLUDED.enabled;