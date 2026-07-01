ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS portal_summary    text,
  ADD COLUMN IF NOT EXISTS portal_summary_at timestamptz;