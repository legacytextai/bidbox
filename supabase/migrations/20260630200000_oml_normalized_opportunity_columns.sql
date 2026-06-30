-- ============================================================
-- OML: Normalized typed columns on opportunity_candidates
--
-- These columns promote the most-accessed portal metadata fields
-- from the crawl_data JSONB blob into typed columns that are
-- faster to index, filter, and query without casting.
--
-- crawl_data is intentionally left untouched. It remains the
-- authoritative blob for portal-specific overflow data and any
-- field not yet promoted here.
--
-- TODO (future cleanup): if all high-value fields are promoted
-- and crawl_data usage drops to near-zero, consider renaming it
-- to portal_metadata. That is a cosmetic rename with migration
-- risk and no immediate business value — defer until then.
-- ============================================================

-- Core value fields
ALTER TABLE opportunity_candidates
  ADD COLUMN IF NOT EXISTS estimated_value        numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_low    numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_high   numeric;

-- Location / scope
ALTER TABLE opportunity_candidates
  ADD COLUMN IF NOT EXISTS county                 text,
  ADD COLUMN IF NOT EXISTS project_address        text;

-- Licensing / compliance (used by qualify-candidates)
ALTER TABLE opportunity_candidates
  ADD COLUMN IF NOT EXISTS required_licenses      text[],
  ADD COLUMN IF NOT EXISTS required_naics         text[];

-- Portal-specific identity helpers
ALTER TABLE opportunity_candidates
  ADD COLUMN IF NOT EXISTS portal_bid_id          text,
  ADD COLUMN IF NOT EXISTS portal_department      text;

-- Backfill from existing crawl_data rows
UPDATE opportunity_candidates
SET
  estimated_value     = (crawl_data->>'estimated_value')::numeric,
  estimated_value_low = (crawl_data->>'estimated_value_low')::numeric,
  estimated_value_high= (crawl_data->>'estimated_value_high')::numeric,
  county              = crawl_data->>'county',
  project_address     = crawl_data->>'project_address',
  portal_bid_id       = crawl_data->>'bid_id',
  portal_department   = crawl_data->>'department'
WHERE crawl_data IS NOT NULL;

-- Indexes for the columns hit by qualify-candidates and list views
CREATE INDEX IF NOT EXISTS idx_opp_candidates_estimated_value
  ON opportunity_candidates(estimated_value);

CREATE INDEX IF NOT EXISTS idx_opp_candidates_county
  ON opportunity_candidates(county);
