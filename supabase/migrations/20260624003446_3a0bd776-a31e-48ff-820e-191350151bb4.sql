ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS job_walk_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS job_walk_override_reason text;

CREATE INDEX IF NOT EXISTS idx_projects_job_walk_override_at
  ON public.projects (job_walk_override_at)
  WHERE job_walk_override_at IS NOT NULL;