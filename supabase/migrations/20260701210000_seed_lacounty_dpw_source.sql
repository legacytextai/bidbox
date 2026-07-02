-- Seed LA County Department of Public Works as the first Agency Direct
-- opportunity source (portal_type = 'lacounty_dpw').
--
-- Inserted DISABLED (scan_enabled = false, refresh_enabled = false) so it is NOT
-- picked up by the nightly refresh-opportunities / scan-opportunities schedulers
-- until end-to-end validation is complete. An operator enables it explicitly
-- once validation passes.
--
-- Additive and idempotent via ON CONFLICT (listing_url). The conflict update
-- intentionally does NOT touch scan_enabled / refresh_enabled, so re-running the
-- migration never re-disables a source an operator has already turned on.

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
  'Los Angeles County Department of Public Works',
  'lacounty_dpw',
  'https://dpw.lacounty.gov/contracts/Opportunities.aspx',
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
