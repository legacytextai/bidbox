-- gc_qualification_profiles
CREATE TABLE public.gc_qualification_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_counties     text[]      NOT NULL DEFAULT '{}',
  licenses_held       text[]      NOT NULL DEFAULT '{}',
  min_project_value   numeric,
  max_project_value   numeric,
  bond_capacity       numeric,
  agency_exclusions   text[]      NOT NULL DEFAULT '{}',
  trade_categories    text[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gc_qualification_profiles TO authenticated;
GRANT ALL ON public.gc_qualification_profiles TO service_role;

ALTER TABLE public.gc_qualification_profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_gc_qualification_profiles_updated_at
  BEFORE UPDATE ON public.gc_qualification_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE POLICY "Users can view own qualification profile"
  ON public.gc_qualification_profiles FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Users can insert own qualification profile"
  ON public.gc_qualification_profiles FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "Users can update own qualification profile"
  ON public.gc_qualification_profiles FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "Users can delete own qualification profile"
  ON public.gc_qualification_profiles FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

-- Qualification fields on opportunity_candidates (auto_* is fully separate from manual status)
ALTER TABLE public.opportunity_candidates
  ADD COLUMN auto_status         text        CHECK (auto_status IN ('pending', 'red', 'yellow', 'green')),
  ADD COLUMN auto_status_reason  text,
  ADD COLUMN qualification_score integer     CHECK (qualification_score BETWEEN 0 AND 100),
  ADD COLUMN qualified_at        timestamptz;

CREATE INDEX idx_opportunity_candidates_auto_status
  ON public.opportunity_candidates (auto_status);

-- Seed default qualification profile for admin (no-op if email not present)
INSERT INTO public.gc_qualification_profiles (
  profile_id, target_counties, licenses_held,
  min_project_value, max_project_value, bond_capacity,
  agency_exclusions, trade_categories
)
SELECT
  id,
  ARRAY['Orange', 'Los Angeles', 'Riverside', 'San Diego'],
  ARRAY['A', 'B'],
  2000000, 15000000, 50000000,
  ARRAY[]::text[], ARRAY[]::text[]
FROM public.profiles
WHERE email = 'constructionaisolutions.co@gmail.com';