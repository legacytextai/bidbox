-- ============================================================
-- opportunity_sources
-- Listing pages to scan for new project opportunities
-- ============================================================
CREATE TABLE opportunity_sources (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,
  portal_type          text NOT NULL,
  listing_url          text NOT NULL UNIQUE,
  scan_enabled         boolean NOT NULL DEFAULT true,
  scan_interval_hours  integer NOT NULL DEFAULT 24,
  last_scanned_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE opportunity_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view opportunity sources"
  ON opportunity_sources FOR SELECT
  TO authenticated
  USING (true);


-- ============================================================
-- opportunity_candidates
-- Individual project URLs discovered from listing page scans
-- ============================================================
CREATE TABLE opportunity_candidates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id            uuid NOT NULL REFERENCES opportunity_sources(id) ON DELETE CASCADE,
  source_url           text NOT NULL UNIQUE,
  portal_type          text,
  raw_title            text,
  agency               text,
  bid_due_at           timestamptz,
  scope_text           text,
  crawl_data           jsonb,
  last_crawled_at      timestamptz,

  -- Human review
  status               text NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'red', 'yellow', 'green', 'converted')),
  review_notes         text,
  reviewed_by          uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reviewed_at          timestamptz,

  -- Conversion
  converted_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_opportunity_candidates_status     ON opportunity_candidates(status);
CREATE INDEX idx_opportunity_candidates_source_id  ON opportunity_candidates(source_id);
CREATE INDEX idx_opportunity_candidates_bid_due_at ON opportunity_candidates(bid_due_at);

ALTER TABLE opportunity_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view candidates"
  ON opportunity_candidates FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can review candidates"
  ON opportunity_candidates FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);


-- ============================================================
-- agent_runs
-- Audit log for each scan-opportunities execution
-- ============================================================
CREATE TABLE agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        uuid REFERENCES opportunity_sources(id) ON DELETE SET NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  candidates_found integer,
  candidates_new   integer,
  errors           integer,
  raw_log          text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_source_id   ON agent_runs(source_id);
CREATE INDEX idx_agent_runs_started_at  ON agent_runs(started_at DESC);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view agent runs"
  ON agent_runs FOR SELECT
  TO authenticated
  USING (true);
