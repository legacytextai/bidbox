DELETE FROM opportunity_sources;

INSERT INTO opportunity_sources (name, portal_type, listing_url, scan_enabled, scan_interval_hours)
VALUES
  ('City of Irvine',           'planetbids', 'https://vendors.planetbids.com/portal/15927/bo/bo-search', true, 24),
  ('City of Riverside',        'planetbids', 'https://vendors.planetbids.com/portal/39475/bo/bo-search', true, 24),
  ('City of San Diego',        'planetbids', 'https://vendors.planetbids.com/portal/17950/bo/bo-search', true, 24),
  ('Port of Long Beach',       'planetbids', 'https://vendors.planetbids.com/portal/19236/bo/bo-search', true, 24),
  ('City of Long Beach',       'planetbids', 'https://vendors.planetbids.com/portal/15810/bo/bo-search', true, 24),
  ('City of Carlsbad',         'planetbids', 'https://vendors.planetbids.com/portal/27970/bo/bo-search', true, 24),
  ('Port of Los Angeles',      'planetbids', 'https://vendors.planetbids.com/portal/42217/bo/bo-search', true, 24),
  ('City of Huntington Beach', 'planetbids', 'https://vendors.planetbids.com/portal/15340/bo/bo-search', true, 24);