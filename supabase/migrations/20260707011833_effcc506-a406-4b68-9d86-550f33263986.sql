-- Backfill opportunity_intelligence projects: repair source links + fill county from candidate metadata.

WITH latest_reports AS (
  SELECT DISTINCT ON (opportunity_candidate_id)
    id,
    opportunity_candidate_id
  FROM public.opportunity_intelligence_reports
  WHERE status IN ('ready', 'partial')
  ORDER BY opportunity_candidate_id, completed_at DESC NULLS LAST, updated_at DESC, created_at DESC
)
UPDATE public.projects p
SET
  origin = 'opportunity_intelligence',
  source_opportunity_candidate_id = COALESCE(p.source_opportunity_candidate_id, oc.id),
  opportunity_intelligence_report_id = COALESCE(p.opportunity_intelligence_report_id, lr.id)
FROM public.opportunity_candidates oc
LEFT JOIN latest_reports lr
  ON lr.opportunity_candidate_id = oc.id
WHERE oc.converted_project_id = p.id
  AND (
    p.origin <> 'opportunity_intelligence'
    OR p.source_opportunity_candidate_id IS NULL
    OR p.opportunity_intelligence_report_id IS NULL
  );

WITH ca_counties(county) AS (
  VALUES
    ('Alameda'), ('Alpine'), ('Amador'), ('Butte'), ('Calaveras'), ('Colusa'),
    ('Contra Costa'), ('Del Norte'), ('El Dorado'), ('Fresno'), ('Glenn'),
    ('Humboldt'), ('Imperial'), ('Inyo'), ('Kern'), ('Kings'), ('Lake'),
    ('Lassen'), ('Los Angeles'), ('Madera'), ('Marin'), ('Mariposa'),
    ('Mendocino'), ('Merced'), ('Modoc'), ('Mono'), ('Monterey'), ('Napa'),
    ('Nevada'), ('Orange'), ('Placer'), ('Plumas'), ('Riverside'),
    ('Sacramento'), ('San Benito'), ('San Bernardino'), ('San Diego'),
    ('San Francisco'), ('San Joaquin'), ('San Luis Obispo'), ('San Mateo'),
    ('Santa Barbara'), ('Santa Clara'), ('Santa Cruz'), ('Shasta'), ('Sierra'),
    ('Siskiyou'), ('Solano'), ('Sonoma'), ('Stanislaus'), ('Sutter'), ('Tehama'),
    ('Trinity'), ('Tulare'), ('Tuolumne'), ('Ventura'), ('Yolo'), ('Yuba')
),
city_counties(city, county) AS (
  VALUES
    ('alhambra', 'Los Angeles'), ('anaheim', 'Orange'), ('bakersfield', 'Kern'),
    ('burbank', 'Los Angeles'), ('carlsbad', 'San Diego'),
    ('cerritos', 'Los Angeles'), ('chula vista', 'San Diego'),
    ('compton', 'Los Angeles'), ('corona', 'Riverside'), ('costa mesa', 'Orange'),
    ('downey', 'Los Angeles'), ('el monte', 'Los Angeles'), ('escondido', 'San Diego'),
    ('fontana', 'San Bernardino'), ('fresno', 'Fresno'), ('fullerton', 'Orange'),
    ('garden grove', 'Orange'), ('glendale', 'Los Angeles'),
    ('huntington beach', 'Orange'), ('inglewood', 'Los Angeles'), ('irvine', 'Orange'),
    ('lancaster', 'Los Angeles'), ('long beach', 'Los Angeles'),
    ('los angeles', 'Los Angeles'), ('murrieta', 'Riverside'),
    ('norwalk', 'Los Angeles'), ('oceanside', 'San Diego'),
    ('ontario', 'San Bernardino'), ('orange', 'Orange'), ('oxnard', 'Ventura'),
    ('palmdale', 'Los Angeles'), ('pasadena', 'Los Angeles'), ('pomona', 'Los Angeles'),
    ('riverside', 'Riverside'), ('sacramento', 'Sacramento'),
    ('san bernardino', 'San Bernardino'), ('san diego', 'San Diego'),
    ('san francisco', 'San Francisco'), ('san jose', 'Santa Clara'),
    ('santa ana', 'Orange'), ('santa clarita', 'Los Angeles'),
    ('santa monica', 'Los Angeles'), ('torrance', 'Los Angeles'),
    ('victorville', 'San Bernardino')
),
project_candidates AS (
  SELECT
    p.id AS project_id,
    oc.crawl_data,
    lower(NULLIF(trim(COALESCE(
      oc.crawl_data->>'city',
      oc.crawl_data->>'project_city'
    )), '')) AS city,
    lower(COALESCE(
      oc.crawl_data->>'project_address',
      oc.crawl_data->>'location',
      oc.crawl_data->>'address',
      oc.crawl_data->>'project_location',
      oc.agency,
      ''
    )) AS address_text,
    initcap(regexp_replace(NULLIF(trim(COALESCE(
      oc.crawl_data->>'county',
      oc.crawl_data->>'project_county',
      oc.crawl_data->>'location_county'
    )), ''), '\s+county$', '', 'i')) AS metadata_county
  FROM public.projects p
  JOIN public.opportunity_candidates oc
    ON oc.id = p.source_opportunity_candidate_id
    OR oc.converted_project_id = p.id
  WHERE p.origin = 'opportunity_intelligence'
    AND p.county IS NULL
),
resolved AS (
  SELECT DISTINCT ON (pc.project_id)
    pc.project_id,
    COALESCE(valid_metadata.county, city_exact.county, city_in_address.county) AS county
  FROM project_candidates pc
  LEFT JOIN ca_counties valid_metadata
    ON valid_metadata.county = pc.metadata_county
  LEFT JOIN city_counties city_exact
    ON city_exact.city = pc.city
  LEFT JOIN city_counties city_in_address
    ON pc.address_text ~ ('\m' || city_in_address.city || '\M')
  WHERE COALESCE(valid_metadata.county, city_exact.county, city_in_address.county) IS NOT NULL
  ORDER BY pc.project_id
)
UPDATE public.projects p
SET county = resolved.county
FROM resolved
WHERE p.id = resolved.project_id
  AND p.county IS NULL;