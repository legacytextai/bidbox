-- Phase F1: Analyze Project workflow state.
-- This captures the estimator's human-interest signal without creating a project
-- or implying Project Intelligence has already been generated.

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS analysis_status text NOT NULL DEFAULT 'not_requested'
    CHECK (analysis_status IN ('not_requested', 'queued', 'analyzing', 'ready', 'failed')),
  ADD COLUMN IF NOT EXISTS analysis_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS analysis_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_error text,
  ADD COLUMN IF NOT EXISTS analysis_requested_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_analysis_status
  ON public.opportunity_candidates (analysis_status);

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_analysis_task_id
  ON public.opportunity_candidates (analysis_task_id);

COMMENT ON COLUMN public.opportunity_candidates.analysis_status IS
  'Estimator-requested Project Intelligence state. F1 queues analysis only; document intelligence is generated in later phases.';

COMMENT ON COLUMN public.opportunity_candidates.analysis_task_id IS
  'Latest project_analysis agent task created for this candidate.';
