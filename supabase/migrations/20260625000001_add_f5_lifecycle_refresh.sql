-- F5 Phase 1: lifecycle state and opportunity refresh foundation.
-- Additive only: preserves existing F1/F2/F3/F4 fields and data.

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS opportunity_lifecycle_status text NOT NULL DEFAULT 'discovered'
    CHECK (opportunity_lifecycle_status IN (
      'discovered',
      'opportunity_intelligence_queued',
      'opportunity_intelligence_preparing',
      'opportunity_intelligence_ready',
      'opportunity_intelligence_partial',
      'opportunity_intelligence_failed',
      'added_to_calendar'
    )),
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_status text NOT NULL DEFAULT 'not_requested'
    CHECK (opportunity_intelligence_status IN (
      'not_requested',
      'queued',
      'acquiring_documents',
      'processing_documents',
      'generating_report',
      'ready',
      'partial',
      'failed'
    )),
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_error text,
  ADD COLUMN IF NOT EXISTS last_metadata_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_metadata_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata_refresh_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata_refresh_source text,
  ADD COLUMN IF NOT EXISTS metadata_refresh_trigger text;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_lifecycle_status text NOT NULL DEFAULT 'active_pursuit'
    CHECK (project_lifecycle_status IN (
      'calendar_anchor',
      'project_intelligence_preparing',
      'project_intelligence_ready',
      'active_pursuit',
      'submitted',
      'won',
      'lost',
      'archived'
    )),
  ADD COLUMN IF NOT EXISTS project_intelligence_status text NOT NULL DEFAULT 'not_requested'
    CHECK (project_intelligence_status IN (
      'not_requested',
      'queued',
      'preparing',
      'ready',
      'partial',
      'failed'
    )),
  ADD COLUMN IF NOT EXISTS project_intelligence_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_intelligence_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_intelligence_error text,
  ADD COLUMN IF NOT EXISTS added_to_calendar_at timestamptz,
  ADD COLUMN IF NOT EXISTS added_to_calendar_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pursuit_status text NOT NULL DEFAULT 'active'
    CHECK (pursuit_status IN ('active', 'submitted', 'won', 'lost', 'archived')),
  ADD COLUMN IF NOT EXISTS pursuit_status_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS pursuit_status_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.opportunity_sources
  ADD COLUMN IF NOT EXISTS refresh_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS refresh_cadence_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS last_refresh_queued_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_status text NOT NULL DEFAULT 'never'
    CHECK (last_refresh_status IN ('never', 'queued', 'running', 'complete', 'partial', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS last_refresh_error text;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS trigger_reason text,
  ADD COLUMN IF NOT EXISTS refresh_window text;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_lifecycle
  ON public.opportunity_candidates(opportunity_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_oi_status
  ON public.opportunity_candidates(opportunity_intelligence_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_metadata_refreshed
  ON public.opportunity_candidates(last_metadata_refreshed_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_status
  ON public.projects(project_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_projects_pursuit_status
  ON public.projects(pursuit_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_refresh_status
  ON public.opportunity_sources(last_refresh_status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_refresh_window
  ON public.agent_tasks(task_type, refresh_window)
  WHERE refresh_window IS NOT NULL;

UPDATE public.opportunity_candidates
SET
  opportunity_intelligence_status = CASE
    WHEN analysis_status = 'ready' THEN 'ready'
    WHEN analysis_status IN ('queued', 'analyzing') THEN 'generating_report'
    WHEN analysis_status = 'failed' THEN 'failed'
    WHEN document_processing_status IN ('processed', 'partial') THEN 'generating_report'
    WHEN document_processing_status IN ('queued', 'processing') THEN 'processing_documents'
    WHEN document_acquisition_status IN ('queued', 'acquiring') THEN 'acquiring_documents'
    ELSE opportunity_intelligence_status
  END,
  opportunity_lifecycle_status = CASE
    WHEN converted_project_id IS NOT NULL THEN 'added_to_calendar'
    WHEN analysis_status = 'ready' THEN 'opportunity_intelligence_ready'
    WHEN analysis_status = 'failed' THEN 'opportunity_intelligence_failed'
    WHEN analysis_status IN ('queued', 'analyzing')
      OR document_acquisition_status IN ('queued', 'acquiring')
      OR document_processing_status IN ('queued', 'processing')
      THEN 'opportunity_intelligence_preparing'
    ELSE opportunity_lifecycle_status
  END,
  opportunity_intelligence_ready_at = CASE
    WHEN analysis_status = 'ready' THEN COALESCE(analysis_completed_at, opportunity_intelligence_ready_at)
    ELSE opportunity_intelligence_ready_at
  END,
  opportunity_intelligence_error = CASE
    WHEN analysis_status = 'failed' THEN analysis_error
    ELSE opportunity_intelligence_error
  END
WHERE true;

UPDATE public.projects
SET
  project_lifecycle_status = CASE
    WHEN origin = 'opportunity_intelligence' AND opportunity_intelligence_report_id IS NOT NULL THEN 'project_intelligence_ready'
    WHEN origin = 'opportunity_intelligence' THEN 'calendar_anchor'
    ELSE project_lifecycle_status
  END,
  project_intelligence_status = CASE
    WHEN origin = 'opportunity_intelligence' AND opportunity_intelligence_report_id IS NOT NULL THEN 'ready'
    ELSE project_intelligence_status
  END,
  project_intelligence_ready_at = CASE
    WHEN origin = 'opportunity_intelligence' AND opportunity_intelligence_report_id IS NOT NULL THEN COALESCE(updated_at, project_intelligence_ready_at)
    ELSE project_intelligence_ready_at
  END,
  added_to_calendar_at = CASE
    WHEN origin = 'opportunity_intelligence' THEN COALESCE(created_at, added_to_calendar_at)
    ELSE added_to_calendar_at
  END,
  pursuit_status_updated_at = COALESCE(pursuit_status_updated_at, updated_at)
WHERE true;
