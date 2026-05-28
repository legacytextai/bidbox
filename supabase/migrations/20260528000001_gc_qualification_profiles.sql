-- ============================================================
-- Task 2.1: gc_qualification_profiles — user bid parameters
-- Task 2.2: qualification fields on opportunity_candidates
-- Task 2.3: seed default qualification profile
-- ============================================================

-- ------------------------------------------------------------
-- gc_qualification_profiles
-- One row per profiles row. Tied to profiles.id (auth.uid()).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- Task 2.2: Add qualification fields to opportunity_candidates
--
-- auto_status is completely separate from status.
-- The auto-qualifier never writes to status.
-- NULL means not yet qualified (no profile set up yet).
-- ------------------------------------------------------------
ALTER TABLE public.opportunity_candidates
  ADD COLUMN auto_status         text        CHECK (auto_status IN ('pending', 'red', 'yellow', 'green')),
  ADD COLUMN auto_status_reason  text,
  ADD COLUMN qualification_score integer     CHECK (qualification_score BETWEEN 0 AND 100),
  ADD COLUMN qualified_at        timestamptz;

CREATE INDEX idx_opportunity_candidates_auto_status
  ON public.opportunity_candidates (auto_status);

-- ------------------------------------------------------------
-- Task 2.3: Seed default qualification profile
--
-- Uses a subquery on profiles.email — no hardcoded UUIDs.
-- If the email does not exist in profiles, inserts nothing.
-- ------------------------------------------------------------
INSERT INTO public.gc_qualification_profiles (
  profile_id,
  target_counties,
  licenses_held,
  min_project_value,
  max_project_value,
  bond_capacity,
  agency_exclusions,
  trade_categories
)
SELECT
  id,
  ARRAY['Orange', 'Los Angeles', 'Riverside', 'San Diego'],
  ARRAY['A', 'B'],
  2000000,
  15000000,
  50000000,
  ARRAY[]::text[],
  ARRAY[]::text[]
FROM public.profiles
WHERE email = 'constructionaisolutions.co@gmail.com';
