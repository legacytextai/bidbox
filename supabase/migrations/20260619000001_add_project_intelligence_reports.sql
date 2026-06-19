-- Phase F4: Project Intelligence Reports.
-- F4 turns processed document evidence into citation-backed estimator-facing reports.
-- Core rule: no citation = no fact. F4 does not perform qualification.

CREATE TABLE IF NOT EXISTS public.opportunity_intelligence_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  agent_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'generating', 'ready', 'partial', 'failed')),
  report_version integer NOT NULL DEFAULT 1,
  report_schema_version text NOT NULL DEFAULT 'f4_mvp_v1',
  title text,
  executive_summary jsonb NOT NULL DEFAULT '{"bullets":[]}'::jsonb,
  overview jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  trade_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  key_dates jsonb NOT NULL DEFAULT '{}'::jsonb,
  bid_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  addenda_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_metadata jsonb,
  confidence_score numeric,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_candidate_id, report_version)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_reports_candidate_id
  ON public.opportunity_intelligence_reports (opportunity_candidate_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_reports_status
  ON public.opportunity_intelligence_reports (status);

DROP TRIGGER IF EXISTS update_opportunity_intelligence_reports_updated_at ON public.opportunity_intelligence_reports;
CREATE TRIGGER update_opportunity_intelligence_reports_updated_at
  BEFORE UPDATE ON public.opportunity_intelligence_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.opportunity_intelligence_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity intelligence reports" ON public.opportunity_intelligence_reports;
CREATE POLICY "Authenticated users can view opportunity intelligence reports"
  ON public.opportunity_intelligence_reports FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity intelligence reports" ON public.opportunity_intelligence_reports;
CREATE POLICY "Service role can manage opportunity intelligence reports"
  ON public.opportunity_intelligence_reports FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.opportunity_intelligence_reports TO authenticated;
GRANT ALL ON public.opportunity_intelligence_reports TO service_role;

CREATE TABLE IF NOT EXISTS public.opportunity_intelligence_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.opportunity_intelligence_reports(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  category text NOT NULL,
  field_key text NOT NULL,
  label text NOT NULL,
  value_text text,
  value_jsonb jsonb,
  status text NOT NULL
    CHECK (status IN ('found', 'unknown', 'conflict', 'not_applicable', 'needs_review')),
  confidence text NOT NULL DEFAULT 'low'
    CHECK (confidence IN ('high', 'medium', 'low')),
  is_critical boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_findings_report_id
  ON public.opportunity_intelligence_findings (report_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_findings_candidate_category
  ON public.opportunity_intelligence_findings (opportunity_candidate_id, category);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_findings_critical
  ON public.opportunity_intelligence_findings (report_id, is_critical);

ALTER TABLE public.opportunity_intelligence_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity intelligence findings" ON public.opportunity_intelligence_findings;
CREATE POLICY "Authenticated users can view opportunity intelligence findings"
  ON public.opportunity_intelligence_findings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity intelligence findings" ON public.opportunity_intelligence_findings;
CREATE POLICY "Service role can manage opportunity intelligence findings"
  ON public.opportunity_intelligence_findings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.opportunity_intelligence_findings TO authenticated;
GRANT ALL ON public.opportunity_intelligence_findings TO service_role;

CREATE TABLE IF NOT EXISTS public.opportunity_intelligence_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.opportunity_intelligence_reports(id) ON DELETE CASCADE,
  finding_id uuid NOT NULL REFERENCES public.opportunity_intelligence_findings(id) ON DELETE CASCADE,
  opportunity_document_id uuid NOT NULL REFERENCES public.opportunity_documents(id) ON DELETE CASCADE,
  opportunity_document_page_id uuid REFERENCES public.opportunity_document_pages(id) ON DELETE SET NULL,
  opportunity_document_chunk_id uuid NOT NULL REFERENCES public.opportunity_document_chunks(id) ON DELETE CASCADE,
  source_document_name text NOT NULL,
  page_number integer,
  page_label text,
  source_excerpt text NOT NULL,
  citation_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_citations_report_id
  ON public.opportunity_intelligence_citations (report_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_citations_finding_id
  ON public.opportunity_intelligence_citations (finding_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_intelligence_citations_chunk_id
  ON public.opportunity_intelligence_citations (opportunity_document_chunk_id);

ALTER TABLE public.opportunity_intelligence_citations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity intelligence citations" ON public.opportunity_intelligence_citations;
CREATE POLICY "Authenticated users can view opportunity intelligence citations"
  ON public.opportunity_intelligence_citations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity intelligence citations" ON public.opportunity_intelligence_citations;
CREATE POLICY "Service role can manage opportunity intelligence citations"
  ON public.opportunity_intelligence_citations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.opportunity_intelligence_citations TO authenticated;
GRANT ALL ON public.opportunity_intelligence_citations TO service_role;

COMMENT ON TABLE public.opportunity_intelligence_reports IS
  'F4 Project Intelligence reports generated from processed document evidence. Reports are not qualification decisions.';

COMMENT ON TABLE public.opportunity_intelligence_findings IS
  'Structured F4 findings. Found/conflict findings must have citation support; no citation means no fact.';

COMMENT ON TABLE public.opportunity_intelligence_citations IS
  'Citation chain from F4 findings back to F3 document chunks/pages/documents.';
