-- Cal eProcure Phase 1 cleanup.
--
-- Scope guardrails:
--   * Cal eProcure only: source_id = 75d7fa42-2302-4fce-ba0f-ba33ef6e9a82
--   * No deletes, no task enqueueing, no document acquisition.
--   * Existing non-null bid_due_at values are not overwritten.
--   * Rows are preserved for audit; irrelevant/duplicate rows are marked auto-red.

CREATE OR REPLACE FUNCTION public._caleprocure_parse_bid_due(raw text)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  m text[];
  hh int;
  mm int;
  ss int;
  stamp timestamp;
BEGIN
  IF raw IS NULL OR btrim(raw) = '' THEN
    RETURN NULL;
  END IF;

  -- Supports both normal and malformed PeopleSoft date/time strings:
  --   07/21/2026 5:00PM PDT
  --   07/21/20265:00PM PDT
  m := regexp_match(
    btrim(raw),
    '^\s*([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})\s*([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?\s*([AP]M)\s*(?:P[DS]T)?\s*$',
    'i'
  );

  IF m IS NULL THEN
    RETURN NULL;
  END IF;

  hh := m[4]::int;
  mm := m[5]::int;
  ss := COALESCE(NULLIF(m[6], '')::int, 0);

  IF upper(m[7]) = 'PM' AND hh < 12 THEN
    hh := hh + 12;
  ELSIF upper(m[7]) = 'AM' AND hh = 12 THEN
    hh := 0;
  END IF;

  stamp := make_timestamp(m[3]::int, m[1]::int, m[2]::int, hh, mm, ss);
  RETURN stamp AT TIME ZONE 'America/Los_Angeles';
END;
$$;

WITH parsed AS (
  SELECT
    id,
    public._caleprocure_parse_bid_due(crawl_data->>'bid_due_raw') AS parsed_due
  FROM public.opportunity_candidates
  WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND bid_due_at IS NULL
    AND crawl_data->>'bid_due_raw' IS NOT NULL
),
updated AS (
  UPDATE public.opportunity_candidates oc
  SET
    bid_due_at = parsed.parsed_due,
    crawl_data = jsonb_set(
      jsonb_set(
        COALESCE(oc.crawl_data, '{}'::jsonb),
        '{bid_due_note}',
        'null'::jsonb,
        true
      ),
      '{caleprocure_due_backfill}',
      jsonb_build_object(
        'applied_at', now(),
        'source', '20260710180000_caleprocure_phase1_cleanup',
        'raw', oc.crawl_data->>'bid_due_raw',
        'parsed_bid_due_at', parsed.parsed_due
      ),
      true
    ),
    updated_at = now()
  FROM parsed
  WHERE oc.id = parsed.id
    AND parsed.parsed_due IS NOT NULL
  RETURNING oc.id
)
SELECT count(*) AS caleprocure_due_dates_backfilled FROM updated;

WITH exact_duplicates AS (
  SELECT
    ce.id AS caleprocure_id,
    ce.portal_bid_id,
    ct.id AS caltrans_id,
    ct.source_url AS caltrans_source_url
  FROM public.opportunity_candidates ce
  JOIN public.opportunity_candidates ct
    ON ct.portal_type = 'caltrans'
   AND ct.portal_bid_id = ce.portal_bid_id
  WHERE ce.source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND ce.portal_bid_id IS NOT NULL
),
updated AS (
  UPDATE public.opportunity_candidates ce
  SET
    portal_type = COALESCE(ce.portal_type, 'caleprocure'),
    auto_status = 'red',
    auto_status_reason = 'Duplicate of Caltrans-native opportunity ' || exact_duplicates.portal_bid_id,
    qualification_score = 0,
    qualified_at = now(),
    crawl_data = COALESCE(ce.crawl_data, '{}'::jsonb)
      || jsonb_build_object(
        'duplicate_of_caltrans', true,
        'duplicate_of_candidate_id', exact_duplicates.caltrans_id,
        'duplicate_of_source_url', exact_duplicates.caltrans_source_url,
        'duplicate_match_field', 'portal_bid_id',
        'duplicate_match_value', exact_duplicates.portal_bid_id,
        'duplicate_marked_at', now(),
        'duplicate_marked_by', '20260710180000_caleprocure_phase1_cleanup'
      ),
    updated_at = now()
  FROM exact_duplicates
  WHERE ce.id = exact_duplicates.caleprocure_id
  RETURNING ce.id
)
SELECT count(*) AS caleprocure_caltrans_duplicates_suppressed FROM updated;

WITH candidates AS (
  SELECT
    id,
    lower(regexp_replace(COALESCE(raw_title, ''), '[^a-z0-9/&+\-\s\[\]]', ' ', 'g')) AS normalized_title
  FROM public.opportunity_candidates
  WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND COALESCE(crawl_data->>'duplicate_of_caltrans', 'false') <> 'true'
    AND (
      auto_status IS NULL
      OR auto_status <> 'red'
      OR auto_status_reason IS NULL
      OR auto_status_reason NOT ILIKE 'Duplicate of Caltrans-native opportunity%'
    )
),
classified AS (
  SELECT
    id,
    CASE
      WHEN normalized_title ~ '\[event title\]' THEN 'Incomplete Cal eProcure placeholder title'
      WHEN normalized_title ~ '(cannabis.*(integration|system|software|platform)|(integration|system|software|platform).*cannabis)' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(software|saas|it services?|information technology|managed cybersecurity|cybersecurity|calnet|technical access portal|saphire|data system)' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(cloud services?|cloud.*(subscription|service|platform|hosting)|data.*(services?|subscription|platform|system))' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(broadband funding|funding program|grant program)' THEN 'Non-public-works funding program'
      WHEN normalized_title ~ '(janitorial|custodial|guard services?|security services?|towing services?)' THEN 'Municipal operations outside construction scope'
      WHEN normalized_title ~ '(consulting services?|consultant|medical consultant|health program|pharmaceutical consulting|food|agriculture|lab supplies|laboratory supplies|office moving|title/escrow|title and escrow|general supplies)' THEN 'Municipal operations outside construction scope'
      ELSE NULL
    END AS reason,
    normalized_title
  FROM candidates
),
filtered AS (
  SELECT *
  FROM classified
  WHERE reason IS NOT NULL
    -- Public works terms win over broad words like services/system/portal.
    AND normalized_title !~ '(bridge|roadway|road|pavement|paving|drainage|lighting|traffic|signal|sewer|wastewater|potable water|water wells?|wells?|utilities|utility|electrical|ev supply equipment|ev charging|charging infrastructure|site improvements?|parks?|facilit(y|ies)|buildings?|hvac|pipeline|sidewalk|surveying|survey|a&e|architectural|engineering|environmental|ceqa|construction|construction management|improvements?|rehabilitation|rehab|replacement|renovation|modernization|road rocking)'
),
updated AS (
  UPDATE public.opportunity_candidates oc
  SET
    portal_type = COALESCE(oc.portal_type, 'caleprocure'),
    auto_status = 'red',
    auto_status_reason = filtered.reason,
    qualification_score = 0,
    qualified_at = now(),
    crawl_data = COALESCE(oc.crawl_data, '{}'::jsonb)
      || jsonb_build_object(
        'caleprocure_hygiene_backfill', jsonb_build_object(
          'applied_at', now(),
          'source', '20260710180000_caleprocure_phase1_cleanup',
          'reason', filtered.reason
        )
      ),
    updated_at = now()
  FROM filtered
  WHERE oc.id = filtered.id
  RETURNING oc.id
)
SELECT count(*) AS caleprocure_hygiene_rows_marked_red FROM updated;

UPDATE public.opportunity_candidates
SET
  portal_type = 'caleprocure',
  updated_at = now()
WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
  AND portal_type IS NULL;

DROP FUNCTION public._caleprocure_parse_bid_due(text);
