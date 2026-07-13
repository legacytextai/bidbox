-- READ-ONLY DIAGNOSTIC. Run with a production read-only role.
BEGIN TRANSACTION READ ONLY;

-- Overall missing metadata and portal distribution.
SELECT
  count(*) FILTER (WHERE nullif(btrim(raw_title), '') IS NULL) AS missing_title,
  count(*) FILTER (WHERE bid_due_at IS NULL) AS missing_due_date,
  count(*) FILTER (WHERE nullif(btrim(raw_title), '') IS NULL AND bid_due_at IS NULL) AS missing_both,
  count(*) FILTER (WHERE source_url IS NOT NULL) AS with_source_url,
  count(*) FILTER (WHERE source_url ~ '/bo-detail/[0-9]+') AS with_detail_url,
  count(*) FILTER (WHERE portal_bid_id IS NOT NULL OR crawl_data->>'bid_id' IS NOT NULL) AS with_external_id
FROM public.opportunity_candidates;

SELECT portal_type, count(*) AS rows,
  count(*) FILTER (WHERE nullif(btrim(raw_title), '') IS NULL) AS missing_title,
  count(*) FILTER (WHERE bid_due_at IS NULL) AS missing_due_date,
  count(*) FILTER (WHERE nullif(btrim(raw_title), '') IS NULL AND bid_due_at IS NULL) AS missing_both
FROM public.opportunity_candidates GROUP BY portal_type ORDER BY missing_title DESC, rows DESC;

SELECT agency, count(*) AS rows FROM public.opportunity_candidates
WHERE nullif(btrim(raw_title), '') IS NULL GROUP BY agency ORDER BY rows DESC LIMIT 50;

SELECT s.id AS source_id, s.name, count(*) AS rows FROM public.opportunity_candidates c
JOIN public.opportunity_sources s ON s.id = c.source_id
WHERE nullif(btrim(c.raw_title), '') IS NULL GROUP BY s.id, s.name ORDER BY rows DESC;

SELECT date_trunc('day', created_at) AS created_day, count(*) AS rows
FROM public.opportunity_candidates WHERE nullif(btrim(raw_title), '') IS NULL
GROUP BY 1 ORDER BY 1 DESC;

SELECT date_trunc('day', updated_at) AS updated_day, count(*) AS rows
FROM public.opportunity_candidates WHERE nullif(btrim(raw_title), '') IS NULL
GROUP BY 1 ORDER BY 1 DESC;

-- Stable-ID and URL collision checks (exact duplicates).
SELECT portal_type, portal_bid_id, count(*) AS rows, array_agg(id ORDER BY created_at) AS candidate_ids
FROM public.opportunity_candidates WHERE portal_bid_id IS NOT NULL
GROUP BY portal_type, portal_bid_id HAVING count(*) > 1 ORDER BY rows DESC;

SELECT source_url, count(*) AS rows, array_agg(id ORDER BY created_at) AS candidate_ids
FROM public.opportunity_candidates GROUP BY source_url HAVING count(*) > 1 ORDER BY rows DESC;

-- Probable duplicate clusters and retry bursts.
SELECT portal_type, agency, lower(regexp_replace(coalesce(raw_title, ''), '[^a-z0-9]+', ' ', 'g')) AS normalized_title,
  count(*) AS rows, array_agg(id ORDER BY created_at) AS candidate_ids
FROM public.opportunity_candidates
GROUP BY portal_type, agency, normalized_title HAVING count(*) > 1 ORDER BY rows DESC LIMIT 100;

SELECT agency, date_trunc('minute', created_at) AS created_minute, count(*) AS rows,
  array_agg(id ORDER BY created_at) AS candidate_ids
FROM public.opportunity_candidates WHERE nullif(btrim(raw_title), '') IS NULL
GROUP BY agency, created_minute HAVING count(*) > 1 ORDER BY rows DESC LIMIT 100;

-- Scan-task attribution. source task IDs are currently carried in task payload/logs,
-- not as a candidate FK; correlate by source and scan window.
SELECT t.id AS scan_task_id, t.task_type, t.status, t.created_at, t.completed_at,
  t.payload->>'source_id' AS source_id, t.payload->>'source_name' AS source_name
FROM public.agent_tasks t WHERE t.task_type = 'planetbids_scan' ORDER BY t.created_at DESC;

-- Recoverable raw values.
SELECT
  count(*) FILTER (WHERE nullif(btrim(raw_title), '') IS NULL AND coalesce(
    nullif(btrim(crawl_data->>'title'), ''), nullif(btrim(crawl_data->>'raw_title'), ''),
    nullif(btrim(crawl_data->>'bid_title'), '')) IS NOT NULL) AS recoverable_title,
  count(*) FILTER (WHERE bid_due_at IS NULL AND coalesce(
    nullif(btrim(crawl_data->>'due_date_raw'), ''), nullif(btrim(crawl_data->>'bid_due_raw'), '')) IS NOT NULL) AS recoverable_due_date
FROM public.opportunity_candidates;

SELECT id, source_id, agency, source_url, portal_bid_id, raw_title, bid_due_at, created_at, updated_at,
  crawl_data->>'title' AS metadata_title, crawl_data->>'raw_title' AS metadata_raw_title,
  crawl_data->>'due_date_raw' AS metadata_due_date
FROM public.opportunity_candidates WHERE nullif(btrim(raw_title), '') IS NULL
ORDER BY agency, created_at LIMIT 100;

-- Confirmed cross-portal duplicate direction and reversed links.
SELECT ct.id AS caltrans_id, ce.id AS caleprocure_id, ct.portal_bid_id,
  ct.global_exclusion_code AS caltrans_exclusion, ce.global_exclusion_code AS caleprocure_exclusion,
  ce.canonical_candidate_id
FROM public.opportunity_candidates ct JOIN public.opportunity_candidates ce
  ON ce.portal_type = 'caleprocure' AND ce.portal_bid_id = ct.portal_bid_id
WHERE ct.portal_type = 'caltrans' AND ct.portal_bid_id IS NOT NULL;

-- Account-isolation proof: counts must group independently by user.
SELECT q.user_id, p.email, qp.target_counties, q.status, count(*) AS rows
FROM public.user_opportunity_qualifications q
JOIN public.profiles p ON p.id = q.user_id
LEFT JOIN public.gc_qualification_profiles qp ON qp.profile_id = q.user_id
GROUP BY q.user_id, p.email, qp.target_counties, q.status ORDER BY p.email, q.status;

ROLLBACK;
