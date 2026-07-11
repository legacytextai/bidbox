-- Cal eProcure placeholder title suppression and relevance tightening.
WITH placeholder_rows AS (
  SELECT id
  FROM public.opportunity_candidates
  WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND COALESCE(crawl_data->>'duplicate_of_caltrans', 'false') <> 'true'
    AND (
      raw_title ILIKE '%[Event Title]%'
      OR crawl_data->>'title' ILIKE '%[Event Title]%'
    )
),
updated AS (
  UPDATE public.opportunity_candidates oc
  SET
    auto_status = 'red',
    auto_status_reason = 'Incomplete Cal eProcure placeholder title',
    qualification_score = 0,
    qualified_at = now(),
    crawl_data = COALESCE(oc.crawl_data, '{}'::jsonb)
      || jsonb_build_object(
        'incomplete_caleprocure_placeholder_title', true,
        'auto_reject_reason', 'Incomplete Cal eProcure placeholder title',
        'caleprocure_hygiene_backfill', jsonb_build_object(
          'applied_at', now(),
          'source', '20260711120000_caleprocure_placeholder_and_relevance_cleanup',
          'reason', 'incomplete_caleprocure_placeholder_title'
        )
      ),
    updated_at = now()
  FROM placeholder_rows
  WHERE oc.id = placeholder_rows.id
  RETURNING oc.id
)
SELECT count(*) AS caleprocure_placeholder_titles_marked_red FROM updated;

WITH candidates AS (
  SELECT
    id,
    lower(
      regexp_replace(
        concat_ws(' ', raw_title, crawl_data->>'title'),
        '[^a-z0-9/&+\-\s]',
        ' ',
        'g'
      )
    ) AS normalized_title
  FROM public.opportunity_candidates
  WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND COALESCE(crawl_data->>'duplicate_of_caltrans', 'false') <> 'true'
    AND NOT (
      raw_title ILIKE '%[Event Title]%'
      OR crawl_data->>'title' ILIKE '%[Event Title]%'
    )
),
classified AS (
  SELECT
    id,
    CASE
      WHEN normalized_title ~ '(cannabis.*(integration|system|software|platform)|(integration|system|software|platform).*cannabis)' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(software|saas|it services?|information technology|managed cybersecurity|cybersecurity|calnet|technical access portal|saphire|data system|data logger equipment|call processing equipment|9-?1-?1 call processing)' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(cloud services?|cloud.*(subscription|service|platform|hosting)|data.*(services?|subscription|platform|system))' THEN 'Non-public-works software / IT procurement'
      WHEN normalized_title ~ '(broadband funding|funding program|grant program)' THEN 'Non-public-works funding program'
      WHEN normalized_title ~ '(lodging|hotel|courier|shipping|delivery services?|freight shipping|custom envelopes?|print and deliver|printing|mailing|videographer|video production|focus group|research services?)' THEN 'Municipal operations outside construction scope'
      WHEN normalized_title ~ '(janitorial|custodial|guard services?|security services?|towing services?)' THEN 'Municipal operations outside construction scope'
      WHEN normalized_title ~ '(consulting services?|consultant|medical consultant|medical consulting|physician consulting|health program|health care provider|prior authorization|pharmaceutical consulting|pharmaceutical)' THEN 'Municipal operations outside construction scope'
      WHEN normalized_title ~ '(asl interpreting|interpreting services?|interpreter|translation|food|agriculture|lab supplies|laboratory supplies|office moving|title/escrow|title and escrow|general supplies)' THEN 'Municipal operations outside construction scope'
      WHEN normalized_title ~ '(protective clothing|operational supplies|supplies rental|clothing rental)' THEN 'Municipal operations outside construction scope'
      ELSE NULL
    END AS reason,
    normalized_title
  FROM candidates
),
filtered AS (
  SELECT *
  FROM classified
  WHERE reason IS NOT NULL
    AND normalized_title !~ '(bridge|roadway|road|street|sidewalk|landscaping|concrete|asphalt|demolition|pavement|paving|drainage|lighting|traffic|signal|sewer|storm drain|wastewater|potable water|water wells?|wells?|utilities|utility|electrical|plumbing|ev supply equipment|ev charging|charging infrastructure|pumping plant|site improvements?|parks?|facilit(y|ies)|buildings?|roof|hvac|pipeline|drilling|site characterization|surveying|survey|a&e|architectural|on-call engineering|engineering|environmental|ceqa|construction|contractors?|general contractors?|joc|job order contract|construction management|improvements?|repair|maintenance|rehabilitation|rehab|replacement|renovation|modernization|road rocking)'
),
updated AS (
  UPDATE public.opportunity_candidates oc
  SET
    auto_status = 'red',
    auto_status_reason = filtered.reason,
    qualification_score = 0,
    qualified_at = now(),
    crawl_data = COALESCE(oc.crawl_data, '{}'::jsonb)
      || jsonb_build_object(
        'irrelevant_caleprocure_category', true,
        'auto_reject_reason', filtered.reason,
        'caleprocure_hygiene_backfill', jsonb_build_object(
          'applied_at', now(),
          'source', '20260711120000_caleprocure_placeholder_and_relevance_cleanup',
          'reason', 'irrelevant_caleprocure_category',
          'category', filtered.reason
        )
      ),
    updated_at = now()
  FROM filtered
  WHERE oc.id = filtered.id
  RETURNING oc.id
)
SELECT count(*) AS caleprocure_irrelevant_rows_marked_red FROM updated;