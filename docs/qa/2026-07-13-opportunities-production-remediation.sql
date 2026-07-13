-- PROPOSED PRODUCTION REMEDIATION — DO NOT RUN WITHOUT APPROVAL.
-- Apply 20260713120000_isolate_opportunity_qualification.sql and deploy the
-- worker/function/frontend first. Run the diagnostic SQL and record expected counts.

BEGIN;
CREATE TABLE IF NOT EXISTS public.opportunity_remediation_backup_20260713 AS
SELECT id, auto_status, auto_status_reason, qualification_score, qualified_at,
  ingestion_status, ingestion_issue_code, ingestion_issue_reason,
  global_exclusion_code, global_exclusion_reason, canonical_candidate_id, crawl_data, updated_at
FROM public.opportunity_candidates WHERE false;

-- 1. Snapshot only confirmed exact Caltrans / Cal eProcure pairs.
INSERT INTO public.opportunity_remediation_backup_20260713
SELECT c.id, c.auto_status, c.auto_status_reason, c.qualification_score, c.qualified_at,
  c.ingestion_status, c.ingestion_issue_code, c.ingestion_issue_reason,
  c.global_exclusion_code, c.global_exclusion_reason, c.canonical_candidate_id, c.crawl_data, c.updated_at
FROM public.opportunity_candidates c
WHERE EXISTS (
  SELECT 1 FROM public.opportunity_candidates other
  WHERE other.portal_bid_id = c.portal_bid_id AND other.portal_type <> c.portal_type
    AND other.portal_type IN ('caltrans', 'caleprocure') AND c.portal_type IN ('caltrans', 'caleprocure')
) ON CONFLICT DO NOTHING;

-- 2. Make Caltrans canonical; no user-owned status, bookmarks, pursuits,
-- intelligence, documents, or project linkage is changed.
WITH pairs AS (
  SELECT ct.id AS caltrans_id, ce.id AS caleprocure_id, ct.portal_bid_id
  FROM public.opportunity_candidates ct JOIN public.opportunity_candidates ce
    ON ce.portal_type = 'caleprocure' AND ce.portal_bid_id = ct.portal_bid_id
  WHERE ct.portal_type = 'caltrans' AND ct.portal_bid_id IS NOT NULL
)
UPDATE public.opportunity_candidates ce SET
  global_exclusion_code = 'duplicate_of_caltrans',
  global_exclusion_reason = 'Duplicate of Caltrans opportunity ' || pairs.portal_bid_id,
  canonical_candidate_id = pairs.caltrans_id,
  updated_at = now()
FROM pairs WHERE ce.id = pairs.caleprocure_id;

WITH caltrans_ids AS (
  SELECT DISTINCT ct.id FROM public.opportunity_candidates ct JOIN public.opportunity_candidates ce
    ON ce.portal_type = 'caleprocure' AND ce.portal_bid_id = ct.portal_bid_id
  WHERE ct.portal_type = 'caltrans' AND ct.portal_bid_id IS NOT NULL
)
UPDATE public.opportunity_candidates ct SET
  global_exclusion_code = NULL, global_exclusion_reason = NULL, canonical_candidate_id = NULL, updated_at = now()
FROM caltrans_ids WHERE ct.id = caltrans_ids.id AND ct.global_exclusion_code = 'duplicate_of_caleprocure';

-- 3. Quarantine, but do not delete, unrecoverable PlanetBids detail rows.
UPDATE public.opportunity_candidates SET
  ingestion_status = 'quarantined',
  ingestion_issue_code = 'missing_required_title',
  ingestion_issue_reason = 'Invalid PlanetBids record: detail metadata is missing a title',
  updated_at = now()
WHERE portal_type = 'planetbids' AND nullif(btrim(raw_title), '') IS NULL
  AND source_url ~ '/bo-detail/[0-9]+'
  AND coalesce(nullif(btrim(crawl_data->>'title'), ''), nullif(btrim(crawl_data->>'raw_title'), ''), nullif(btrim(crawl_data->>'bid_title'), '')) IS NULL;

-- Stop here, compare affected row counts with the diagnostic report, and COMMIT
-- only after approval. Use ROLLBACK for dry runs.
ROLLBACK;

-- Rollback after a committed run:
-- UPDATE public.opportunity_candidates c SET
--   auto_status=b.auto_status, auto_status_reason=b.auto_status_reason,
--   qualification_score=b.qualification_score, qualified_at=b.qualified_at,
--   ingestion_status=b.ingestion_status, ingestion_issue_code=b.ingestion_issue_code,
--   ingestion_issue_reason=b.ingestion_issue_reason, global_exclusion_code=b.global_exclusion_code,
--   global_exclusion_reason=b.global_exclusion_reason, canonical_candidate_id=b.canonical_candidate_id,
--   crawl_data=b.crawl_data, updated_at=b.updated_at
-- FROM public.opportunity_remediation_backup_20260713 b WHERE c.id=b.id;
