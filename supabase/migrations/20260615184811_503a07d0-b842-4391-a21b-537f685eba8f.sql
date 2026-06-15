ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS document_acquisition_status text NOT NULL DEFAULT 'not_requested'
    CHECK (document_acquisition_status IN ('not_requested', 'queued', 'acquiring', 'acquired', 'failed')),
  ADD COLUMN IF NOT EXISTS document_acquisition_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_acquisition_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_acquisition_error text;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_document_acquisition_status
  ON public.opportunity_candidates (document_acquisition_status);

CREATE TABLE IF NOT EXISTS public.opportunity_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  agent_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_type text,
  source_url text,
  storage_bucket text NOT NULL DEFAULT 'opportunity-documents',
  storage_path text,
  file_size bigint,
  acquisition_status text NOT NULL DEFAULT 'queued'
    CHECK (acquisition_status IN ('queued', 'acquiring', 'acquired', 'failed')),
  acquisition_error text,
  manifest_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.opportunity_documents TO authenticated;
GRANT ALL ON public.opportunity_documents TO service_role;

ALTER TABLE public.opportunity_documents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_opportunity_documents_candidate_id
  ON public.opportunity_documents (opportunity_candidate_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_documents_agent_task_id
  ON public.opportunity_documents (agent_task_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_documents_acquisition_status
  ON public.opportunity_documents (acquisition_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_documents_candidate_source_url
  ON public.opportunity_documents (opportunity_candidate_id, source_url)
  WHERE source_url IS NOT NULL;

DROP TRIGGER IF EXISTS update_opportunity_documents_updated_at ON public.opportunity_documents;
CREATE TRIGGER update_opportunity_documents_updated_at
  BEFORE UPDATE ON public.opportunity_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

DROP POLICY IF EXISTS "Authenticated users can view opportunity documents" ON public.opportunity_documents;
CREATE POLICY "Authenticated users can view opportunity documents"
  ON public.opportunity_documents FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity documents" ON public.opportunity_documents;
CREATE POLICY "Service role can manage opportunity documents"
  ON public.opportunity_documents FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);