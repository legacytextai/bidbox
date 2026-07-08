-- Seed OpenGov Procurement as a first-class opportunity source
-- (portal_type = 'opengov'), Phase 1 discovery-only.
--
-- Unlike PlanetBids/Caltrans/DPW/Metro, OpenGov is ONE GLOBAL SOURCE, not one
-- per agency: a single authenticated account's Network view surfaces every
-- California construction opportunity across all OpenGov agencies. Agencies are
-- captured as candidate metadata (crawl_data.government_code / agency), not as
-- separate opportunity_sources rows. See:
--   docs/handoff/2026-07-07-opengov-protocol-recon.md
--   docs/handoff/2026-07-07-opengov-category-dictionary.md
--
-- Transport: Browserbase (login only → Cloudflare clearance + session cookie),
-- then authenticated JSON API for discovery. Credentials come from Railway env
-- (OPENGOV_EMAIL / OPENGOV_PASSWORD), never from the DB.
--
-- Inserted DISABLED (scan_enabled = false, refresh_enabled = false) so the
-- nightly schedulers do NOT pick it up until end-to-end validation completes on
-- the Railway worker. An operator enables it explicitly once a real scan passes.
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
  'OpenGov — California Construction',
  'opengov',
  'https://procurement.opengov.com/vendors/open-bids',
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
VALUES ('opengov', 'opengov_driver', 'browserbase', true)
ON CONFLICT (portal_type) DO UPDATE
  SET driver_name = EXCLUDED.driver_name,
      driver_mode = EXCLUDED.driver_mode,
      enabled     = EXCLUDED.enabled;
