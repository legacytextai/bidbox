-- Restore Cal eProcure placeholder-title rows that were red only because the
-- title contained "[Event Title]".
--
-- Product rule:
--   Placeholder title = visible but low-confidence metadata.
--   Irrelevant procurement = hidden/red.
--   Duplicate Caltrans record = hidden/red.
--
-- Scope guardrails:
--   * Cal eProcure only: source_id = 75d7fa42-2302-4fce-ba0f-ba33ef6e9a82
--   * No deletes, no task enqueueing, no document acquisition.
--   * Does not restore rows marked duplicate_of_caltrans.
--   * Does not restore rows marked irrelevant_caleprocure_category.

WITH placeholder_only AS (
  SELECT id
  FROM public.opportunity_candidates
  WHERE source_id = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82'
    AND (
      raw_title ILIKE '%[Event Title]%'
      OR crawl_data->>'title' ILIKE '%[Event Title]%'
    )
    AND auto_status = 'red'
    AND (
      auto_status_reason = 'Incomplete Cal eProcure placeholder title'
      OR crawl_data->>'auto_reject_reason' = 'Incomplete Cal eProcure placeholder title'
      OR COALESCE(crawl_data->>'incomplete_caleprocure_placeholder_title', 'false') = 'true'
    )
    AND COALESCE(crawl_data->>'duplicate_of_caltrans', 'false') <> 'true'
    AND COALESCE(crawl_data->>'irrelevant_caleprocure_category', 'false') <> 'true'
),
updated AS (
  UPDATE public.opportunity_candidates oc
  SET
    auto_status = 'yellow',
    auto_status_reason = 'Placeholder Cal eProcure title; review source for full title',
    qualification_score = CASE
      WHEN oc.qualification_score IS NULL OR oc.qualification_score = 0 THEN 30
      ELSE oc.qualification_score
    END,
    qualified_at = now(),
    crawl_data = (
      COALESCE(oc.crawl_data, '{}'::jsonb)
      - 'incomplete_caleprocure_placeholder_title'
      - 'auto_reject_reason'
    )
      || jsonb_build_object(
        'title_quality', 'placeholder',
        'metadata_quality', 'placeholder_title',
        'caleprocure_placeholder_restore', jsonb_build_object(
          'applied_at', now(),
          'source', '20260711143000_restore_caleprocure_placeholder_titles',
          'reason', 'placeholder_title_is_not_rejection'
        )
      ),
    updated_at = now()
  FROM placeholder_only
  WHERE oc.id = placeholder_only.id
  RETURNING oc.id
)
SELECT count(*) AS caleprocure_placeholder_titles_restored_to_yellow FROM updated;