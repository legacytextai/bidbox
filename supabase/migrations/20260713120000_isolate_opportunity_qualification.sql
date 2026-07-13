-- Separate global opportunity validity from per-user bid-profile matching.
-- Additive only: this migration does not backfill, merge, delete, or rewrite rows.

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS ingestion_status text NOT NULL DEFAULT 'valid'
    CHECK (ingestion_status IN ('valid', 'quarantined')),
  ADD COLUMN IF NOT EXISTS ingestion_issue_code text,
  ADD COLUMN IF NOT EXISTS ingestion_issue_reason text,
  ADD COLUMN IF NOT EXISTS global_exclusion_code text,
  ADD COLUMN IF NOT EXISTS global_exclusion_reason text,
  ADD COLUMN IF NOT EXISTS canonical_candidate_id uuid
    REFERENCES public.opportunity_candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_ingestion_status
  ON public.opportunity_candidates (ingestion_status);
CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_canonical
  ON public.opportunity_candidates (canonical_candidate_id)
  WHERE canonical_candidate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_opportunity_qualifications (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  bid_profile_id uuid REFERENCES public.gc_qualification_profiles(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('red', 'yellow', 'green')),
  primary_reason text NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  qualification_score integer NOT NULL CHECK (qualification_score BETWEEN 0 AND 100),
  qualified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, opportunity_candidate_id)
);

ALTER TABLE public.user_opportunity_qualifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own opportunity qualifications"
  ON public.user_opportunity_qualifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Writes are performed only by the qualification function's service role.
GRANT SELECT ON public.user_opportunity_qualifications TO authenticated;
GRANT ALL ON public.user_opportunity_qualifications TO service_role;

COMMENT ON COLUMN public.opportunity_candidates.global_exclusion_reason IS
  'Authoritative global exclusion. Never stores a user bid-profile decision.';
COMMENT ON TABLE public.user_opportunity_qualifications IS
  'Per-user bid-profile decisions. RLS prevents cross-account reads; global validity remains on opportunity_candidates.';
