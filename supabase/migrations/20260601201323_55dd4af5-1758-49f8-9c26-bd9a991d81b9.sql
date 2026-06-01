ALTER TABLE public.gc_qualification_profiles
  ADD COLUMN naics_codes text[] NOT NULL DEFAULT '{}';