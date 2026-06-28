-- F5: Opportunity bid items.
-- Bid items are discovery-tier evidence that helps estimators understand
-- what is being bid without turning the Opportunity Overview into estimating.

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
  extraction_method text NOT NULL
    CHECK (extraction_method IN ('portal_tab', 'document_table', 'document_ai', 'manual', 'import')),
  extraction_status text NOT NULL DEFAULT 'extracted'
    CHECK (extraction_status IN ('extracted', 'partial', 'failed', 'needs_review')),
  source_url text,
  source_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_candidate_order
  ON public.opportunity_bid_items (opportunity_candidate_id, source_order);

CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_candidate_method
  ON public.opportunity_bid_items (opportunity_candidate_id, extraction_method);

CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_document_id
  ON public.opportunity_bid_items (opportunity_document_id);

CREATE INDEX IF NOT EXISTS idx_opportunity_bid_items_status
  ON public.opportunity_bid_items (extraction_status);

DROP TRIGGER IF EXISTS update_opportunity_bid_items_updated_at ON public.opportunity_bid_items;
CREATE TRIGGER update_opportunity_bid_items_updated_at
  BEFORE UPDATE ON public.opportunity_bid_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.opportunity_bid_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view opportunity bid items" ON public.opportunity_bid_items;
CREATE POLICY "Authenticated users can view opportunity bid items"
  ON public.opportunity_bid_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service role can manage opportunity bid items" ON public.opportunity_bid_items;
CREATE POLICY "Service role can manage opportunity bid items"
  ON public.opportunity_bid_items FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.opportunity_bid_items TO authenticated;
GRANT ALL ON public.opportunity_bid_items TO service_role;
