-- Phase 0: Add One Link columns to projects table
-- All columns are nullable to ensure partial crawls work

ALTER TABLE public.projects
ADD COLUMN IF NOT EXISTS source_url text,
ADD COLUMN IF NOT EXISTS portal_type text,
ADD COLUMN IF NOT EXISTS last_crawled_at timestamptz,
ADD COLUMN IF NOT EXISTS job_walk_exists boolean,
ADD COLUMN IF NOT EXISTS job_walk_mandatory boolean,
ADD COLUMN IF NOT EXISTS job_walk_details text,
ADD COLUMN IF NOT EXISTS eligibility_restricted boolean,
ADD COLUMN IF NOT EXISTS eligibility_notes text,
ADD COLUMN IF NOT EXISTS documents_visible boolean,
ADD COLUMN IF NOT EXISTS documents_accessible boolean,
ADD COLUMN IF NOT EXISTS scope_text text,
ADD COLUMN IF NOT EXISTS crawl_snapshot jsonb;

-- Add index on source_url for re-crawl queries
CREATE INDEX IF NOT EXISTS idx_projects_source_url ON public.projects(source_url) WHERE source_url IS NOT NULL;

-- Add index on last_crawled_at for scheduled re-crawl jobs
CREATE INDEX IF NOT EXISTS idx_projects_last_crawled_at ON public.projects(last_crawled_at) WHERE source_url IS NOT NULL;