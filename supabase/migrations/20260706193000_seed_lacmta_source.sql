-- Seed LA Metro (LACMTA) as the second Agency Direct opportunity source
-- (portal_type = 'lacmta'), following the LA County DPW pattern.
--
-- Inserted DISABLED (scan_enabled = false, refresh_enabled = false) so it is NOT
-- picked up by the nightly refresh-opportunities / scan-opportunities schedulers
-- until end-to-end validation is complete. An operator enables it explicitly
-- once validation passes.
--
-- Unlike LA County DPW, this driver's transport is Browserbase (see
-- bidbox-worker/lib/browserbase.js and bidbox-worker/drivers/lacmta.js) because
-- the portal (Oracle WebCenter/ADF) blocked local headless Playwright during
-- validation — the same failure signature that caused PlanetBids to require
-- Browserbase. Live end-to-end validation against Metro is still pending a
-- Railway/Browserbase deploy (see docs/handoff/2026-07-06-lacmta-recon-and-blocker.md);
-- do not flip scan_enabled/refresh_enabled to true until that validation passes.
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
