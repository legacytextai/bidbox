-- Phase E1: Southern California PlanetBids source expansion, pass 2.
--
-- Additive and idempotent: keeps existing source history intact, updates the
-- portal metadata when a source URL already exists, and enables scans.

INSERT INTO opportunity_sources (name, portal_type, listing_url, scan_enabled, scan_interval_hours)
VALUES
  ('City of Anaheim', 'planetbids', 'https://vendors.planetbids.com/portal/14424/bo/bo-search', true, 24),
  ('Brea Olinda Unified School District', 'planetbids', 'https://vendors.planetbids.com/portal/56096/bo/bo-search', true, 24),
  ('Central Coast Water Authority', 'planetbids', 'https://vendors.planetbids.com/portal/84436/bo/bo-search', true, 24),
  ('Chaffey College', 'planetbids', 'https://vendors.planetbids.com/portal/43704/bo/bo-search', true, 24),
  ('City of Eastvale', 'planetbids', 'https://vendors.planetbids.com/portal/43976/bo/bo-search', true, 24),
  ('Elsinore Valley Municipal Water District', 'planetbids', 'https://vendors.planetbids.com/portal/32069/bo/bo-search', true, 24),
  ('City of Gardena - GTrans', 'planetbids', 'https://vendors.planetbids.com/portal/39470/bo/bo-search', true, 24),
  ('City of Huntington Park', 'planetbids', 'https://vendors.planetbids.com/portal/72415/bo/bo-search', true, 24),
  ('Imperial County Department of Public Works', 'planetbids', 'https://vendors.planetbids.com/portal/64020/bo/bo-search', true, 24),
  ('City of Indio', 'planetbids', 'https://vendors.planetbids.com/portal/32404/bo/bo-search', true, 24),
  ('Inland Empire Utilities Agency', 'planetbids', 'https://vendors.planetbids.com/portal/27411/bo/bo-search', true, 24),
  ('Irvine Ranch Water District', 'planetbids', 'https://vendors.planetbids.com/portal/39499/bo/bo-search', true, 24),
  ('MiraCosta Community College District', 'planetbids', 'https://vendors.planetbids.com/portal/47167/bo/bo-search', true, 24),
  ('City of Moreno Valley', 'planetbids', 'https://vendors.planetbids.com/portal/24660/bo/bo-search', true, 24),
  ('City of Palmdale', 'planetbids', 'https://vendors.planetbids.com/portal/23532/bo/bo-search', true, 24),
  ('Rim of the World Recreation and Park District', 'planetbids', 'https://vendors.planetbids.com/portal/84052/bo/bo-search', true, 24),
  ('Rio Hondo Community College District', 'planetbids', 'https://vendors.planetbids.com/portal/65292/bo/bo-search', true, 24),
  ('San Bernardino County Transportation Authority', 'planetbids', 'https://vendors.planetbids.com/portal/20136/bo/bo-search', true, 24),
  ('Santa Margarita Water District', 'planetbids', 'https://vendors.planetbids.com/portal/75207/bo/bo-search', true, 24),
  ('City of Santa Fe Springs', 'planetbids', 'https://vendors.planetbids.com/portal/65093/bo/bo-search', true, 24),
  ('City of Upland', 'planetbids', 'https://vendors.planetbids.com/portal/66713/bo/bo-search', true, 24),
  ('Downey Unified School District', 'planetbids', 'https://vendors.planetbids.com/portal/74430/bo/bo-search', true, 24)
ON CONFLICT (listing_url) DO UPDATE
SET
  name = EXCLUDED.name,
  portal_type = EXCLUDED.portal_type,
  scan_enabled = EXCLUDED.scan_enabled,
  scan_interval_hours = EXCLUDED.scan_interval_hours,
  updated_at = now();
