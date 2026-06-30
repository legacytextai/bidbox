-- ===== saved_opportunities =====
CREATE TABLE IF NOT EXISTS public.saved_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opportunity_candidate_id)
);

GRANT SELECT, INSERT, DELETE ON public.saved_opportunities TO authenticated;
GRANT ALL ON public.saved_opportunities TO service_role;

ALTER TABLE public.saved_opportunities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own saved opportunities" ON public.saved_opportunities;
CREATE POLICY "Users can view own saved opportunities"
  ON public.saved_opportunities FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can save own opportunities" ON public.saved_opportunities;
CREATE POLICY "Users can save own opportunities"
  ON public.saved_opportunities FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can unsave own opportunities" ON public.saved_opportunities;
CREATE POLICY "Users can unsave own opportunities"
  ON public.saved_opportunities FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user_created
  ON public.saved_opportunities(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_opportunities_candidate
  ON public.saved_opportunities(opportunity_candidate_id);

-- ===== OML normalized columns on opportunity_candidates =====
ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS estimated_value        numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_low    numeric,
  ADD COLUMN IF NOT EXISTS estimated_value_high   numeric,
  ADD COLUMN IF NOT EXISTS county                 text,
  ADD COLUMN IF NOT EXISTS project_address        text,
  ADD COLUMN IF NOT EXISTS required_licenses      text[],
  ADD COLUMN IF NOT EXISTS required_naics         text[],
  ADD COLUMN IF NOT EXISTS portal_bid_id          text,
  ADD COLUMN IF NOT EXISTS portal_department      text;

-- Safe backfill (guard against non-numeric strings)
UPDATE public.opportunity_candidates
SET
  estimated_value      = NULLIF(regexp_replace(coalesce(crawl_data->>'estimated_value',''), '[^0-9.\-]', '', 'g'), '')::numeric,
  estimated_value_low  = NULLIF(regexp_replace(coalesce(crawl_data->>'estimated_value_low',''), '[^0-9.\-]', '', 'g'), '')::numeric,
  estimated_value_high = NULLIF(regexp_replace(coalesce(crawl_data->>'estimated_value_high',''), '[^0-9.\-]', '', 'g'), '')::numeric,
  county               = crawl_data->>'county',
  project_address      = crawl_data->>'project_address',
  portal_bid_id        = crawl_data->>'bid_id',
  portal_department    = crawl_data->>'department'
WHERE crawl_data IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opp_candidates_estimated_value
  ON public.opportunity_candidates(estimated_value);

CREATE INDEX IF NOT EXISTS idx_opp_candidates_county
  ON public.opportunity_candidates(county);