-- Seed: initial opportunity sources
INSERT INTO opportunity_sources (name, portal_type, listing_url, scan_enabled, scan_interval_hours)
VALUES (
  'Caltrans Active Contracts',
  'caltrans',
  'https://ppmoe.dot.ca.gov/des/oe/contract-advertisements/cs-bids.html',
  true,
  24
);

INSERT INTO opportunity_sources (name, portal_type, listing_url, scan_enabled, scan_interval_hours)
VALUES (
  'PlanetBids - City of Los Angeles',
  'planetbids',
  'https://vendors.planetbids.com/portal/23749/bo/bo-search',
  true,
  24
);
