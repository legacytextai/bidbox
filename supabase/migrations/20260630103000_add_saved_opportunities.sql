-- User-scoped saved/bookmarked opportunity candidates.
-- opportunity_candidates are globally visible to authenticated users, so saved
-- state belongs in a per-user join table instead of on the candidate row.
CREATE TABLE IF NOT EXISTS public.saved_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, opportunity_candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_opportunities_user_created
  ON public.saved_opportunities(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_opportunities_candidate
  ON public.saved_opportunities(opportunity_candidate_id);

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

GRANT SELECT, INSERT, DELETE ON public.saved_opportunities TO authenticated;
GRANT ALL ON public.saved_opportunities TO service_role;
