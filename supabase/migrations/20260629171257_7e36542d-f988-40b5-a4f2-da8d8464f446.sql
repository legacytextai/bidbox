-- F5 lifecycle + refresh metadata
ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS opportunity_lifecycle_status text NOT NULL DEFAULT 'discovered'
    CHECK (opportunity_lifecycle_status IN (
      'discovered','opportunity_intelligence_queued','opportunity_intelligence_preparing',
      'opportunity_intelligence_ready','opportunity_intelligence_partial',
      'opportunity_intelligence_failed','added_to_calendar')),
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_status text NOT NULL DEFAULT 'not_requested'
    CHECK (opportunity_intelligence_status IN (
      'not_requested','queued','acquiring_documents','processing_documents',
      'generating_report','ready','partial','failed')),
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
      'calendar_anchor','project_intelligence_preparing','project_intelligence_ready',
      'active_pursuit','submitted','won','lost','archived')),
  ADD COLUMN IF NOT EXISTS project_intelligence_status text NOT NULL DEFAULT 'not_requested'
    CHECK (project_intelligence_status IN ('not_requested','queued','preparing','ready','partial','failed')),
  ADD COLUMN IF NOT EXISTS project_intelligence_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_intelligence_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS project_intelligence_error text,
  ADD COLUMN IF NOT EXISTS added_to_calendar_at timestamptz,
  ADD COLUMN IF NOT EXISTS added_to_calendar_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pursuit_status text NOT NULL DEFAULT 'active'
    CHECK (pursuit_status IN ('active','submitted','won','lost','archived')),
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
    CHECK (last_refresh_status IN ('never','queued','running','complete','partial','failed','skipped')),
  ADD COLUMN IF NOT EXISTS last_refresh_error text;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS trigger_reason text,
  ADD COLUMN IF NOT EXISTS refresh_window text;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_lifecycle ON public.opportunity_candidates(opportunity_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_oi_status ON public.opportunity_candidates(opportunity_intelligence_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_metadata_refreshed ON public.opportunity_candidates(last_metadata_refreshed_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_lifecycle_status ON public.projects(project_lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_projects_pursuit_status ON public.projects(pursuit_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_sources_refresh_status ON public.opportunity_sources(last_refresh_status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_refresh_window ON public.agent_tasks(task_type, refresh_window) WHERE refresh_window IS NOT NULL;

-- Backfill lifecycle/status from existing analysis columns
UPDATE public.opportunity_candidates SET
  opportunity_intelligence_status = CASE
    WHEN analysis_status = 'ready' THEN 'ready'
    WHEN analysis_status IN ('queued','analyzing') THEN 'generating_report'
    WHEN analysis_status = 'failed' THEN 'failed'
    WHEN document_processing_status IN ('processed','partial') THEN 'generating_report'
    WHEN document_processing_status IN ('queued','processing') THEN 'processing_documents'
    WHEN document_acquisition_status IN ('queued','acquiring') THEN 'acquiring_documents'
    ELSE opportunity_intelligence_status END,
  opportunity_lifecycle_status = CASE
    WHEN converted_project_id IS NOT NULL THEN 'added_to_calendar'
    WHEN analysis_status = 'ready' THEN 'opportunity_intelligence_ready'
    WHEN analysis_status = 'failed' THEN 'opportunity_intelligence_failed'
    WHEN analysis_status IN ('queued','analyzing')
      OR document_acquisition_status IN ('queued','acquiring')
      OR document_processing_status IN ('queued','processing')
      THEN 'opportunity_intelligence_preparing'
    ELSE opportunity_lifecycle_status END,
  opportunity_intelligence_ready_at = CASE WHEN analysis_status='ready' THEN COALESCE(analysis_completed_at, opportunity_intelligence_ready_at) ELSE opportunity_intelligence_ready_at END,
  opportunity_intelligence_error = CASE WHEN analysis_status='failed' THEN analysis_error ELSE opportunity_intelligence_error END;

-- opportunity_bid_items
CREATE TABLE IF NOT EXISTS public.opportunity_bid_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  opportunity_document_id uuid REFERENCES public.opportunity_documents(id) ON DELETE SET NULL,
  source_portal text,
  source_opportunity_id text,
  section_name text,
  section_number text,
  item_number text,
  item_code text,
  description text NOT NULL,
  unit_of_measure text,
  quantity numeric,
  quantity_raw text,
  reference text,
  unit_price numeric,
  unit_price_raw text,
  raw_text text,
  extraction_method text NOT NULL CHECK (extraction_method IN ('portal_tab','document_table','document_ai','manual','import')),
  extraction_status text NOT NULL DEFAULT 'extracted' CHECK (extraction_status IN ('extracted','partial','failed','needs_review')),
  source_url text,
  source_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_candidate_order ON public.opportunity_bid_items (opportunity_candidate_id, source_order);
CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_candidate_method ON public.opportunity_bid_items (opportunity_candidate_id, extraction_method);
CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_document_id ON public.opportunity_bid_items (opportunity_document_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_status ON public.opportunity_bid_items (extraction_status);

GRANT SELECT ON public.opportunity_bid_items TO authenticated;
GRANT ALL ON public.opportunity_bid_items TO service_role;

ALTER TABLE public.opportunity_bid_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity bid items" ON public.opportunity_bid_items;
CREATE POLICY "Authenticated users can view opportunity bid items"
  ON public.opportunity_bid_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity bid items" ON public.opportunity_bid_items;
CREATE POLICY "Service role can manage opportunity bid items"
  ON public.opportunity_bid_items FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_opportunity_bid_items_updated_at ON public.opportunity_bid_items;
CREATE TRIGGER update_opportunity_bid_items_updated_at
  BEFORE UPDATE ON public.opportunity_bid_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- app_settings (service role only)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'null',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;