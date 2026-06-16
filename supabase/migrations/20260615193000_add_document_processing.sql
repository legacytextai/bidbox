-- Phase F3: Document Processing for acquired opportunity documents.
-- F3 extracts evidence only: classification, page text, chunks, and citations.
-- It does not generate Project Intelligence, qualification, summaries, or reports.

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS document_processing_status text NOT NULL DEFAULT 'not_requested'
    CHECK (document_processing_status IN ('not_requested', 'queued', 'processing', 'processed', 'partial', 'failed')),
  ADD COLUMN IF NOT EXISTS document_processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_processing_error text;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_document_processing_status
  ON public.opportunity_candidates (document_processing_status);

COMMENT ON COLUMN public.opportunity_candidates.document_processing_status IS
  'F3 document processing lifecycle. Processed documents do not mean Project Intelligence has been generated.';

ALTER TABLE public.opportunity_documents
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'not_requested'
    CHECK (processing_status IN ('not_requested', 'queued', 'processing', 'processed', 'partial', 'failed', 'unsupported')),
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error text,
  ADD COLUMN IF NOT EXISTS detected_file_type text,
  ADD COLUMN IF NOT EXISTS detected_mime_type text,
  ADD COLUMN IF NOT EXISTS document_class text,
  ADD COLUMN IF NOT EXISTS document_family text,
  ADD COLUMN IF NOT EXISTS document_subclass text,
  ADD COLUMN IF NOT EXISTS document_source_order integer,
  ADD COLUMN IF NOT EXISTS document_date date,
  ADD COLUMN IF NOT EXISTS document_revision text,
  ADD COLUMN IF NOT EXISTS document_sequence integer,
  ADD COLUMN IF NOT EXISTS is_addendum boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS addendum_number integer,
  ADD COLUMN IF NOT EXISTS inferred_precedence_rank integer,
  ADD COLUMN IF NOT EXISTS text_extraction_method text,
  ADD COLUMN IF NOT EXISTS text_page_count integer,
  ADD COLUMN IF NOT EXISTS text_char_count integer,
  ADD COLUMN IF NOT EXISTS has_text boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_ocr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_metadata jsonb;

CREATE INDEX IF NOT EXISTS idx_opportunity_documents_processing_status
  ON public.opportunity_documents (processing_status);

CREATE INDEX IF NOT EXISTS idx_opportunity_documents_candidate_processing_status
  ON public.opportunity_documents (opportunity_candidate_id, processing_status);

CREATE INDEX IF NOT EXISTS idx_opportunity_documents_candidate_family
  ON public.opportunity_documents (opportunity_candidate_id, document_family);

CREATE TABLE IF NOT EXISTS public.opportunity_document_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_document_id uuid NOT NULL REFERENCES public.opportunity_documents(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  page_label text,
  sheet_number text,
  sheet_title text,
  text text,
  char_count integer NOT NULL DEFAULT 0,
  extraction_method text,
  text_confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_document_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_document_pages_candidate_id
  ON public.opportunity_document_pages (opportunity_candidate_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_document_pages_document_page
  ON public.opportunity_document_pages (opportunity_document_id, page_number);

ALTER TABLE public.opportunity_document_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity document pages" ON public.opportunity_document_pages;
CREATE POLICY "Authenticated users can view opportunity document pages"
  ON public.opportunity_document_pages FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity document pages" ON public.opportunity_document_pages;
CREATE POLICY "Service role can manage opportunity document pages"
  ON public.opportunity_document_pages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.opportunity_document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_document_id uuid NOT NULL REFERENCES public.opportunity_documents(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  page_start integer NOT NULL,
  page_end integer NOT NULL,
  chunk_index integer NOT NULL,
  text text NOT NULL,
  char_count integer NOT NULL DEFAULT 0,
  token_estimate integer,
  document_class text,
  document_family text,
  citation_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_document_chunks_candidate_id
  ON public.opportunity_document_chunks (opportunity_candidate_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_document_chunks_document_index
  ON public.opportunity_document_chunks (opportunity_document_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_opportunity_document_chunks_candidate_family
  ON public.opportunity_document_chunks (opportunity_candidate_id, document_family);

ALTER TABLE public.opportunity_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity document chunks" ON public.opportunity_document_chunks;
CREATE POLICY "Authenticated users can view opportunity document chunks"
  ON public.opportunity_document_chunks FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity document chunks" ON public.opportunity_document_chunks;
CREATE POLICY "Service role can manage opportunity document chunks"
  ON public.opportunity_document_chunks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
