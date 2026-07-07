-- ============================================================
-- Tenant Boundary Refactor — Foundation 1 of 2: companies
--
-- Creates the tenant root (companies + company_members) and the
-- RLS helper every tenant-scoped table uses from now on.
-- Purely additive: nothing existing reads these tables yet.
--
-- Backfill: one company per existing profile (single-member era).
-- New signups get a company automatically via trigger.
--
-- Architecture: docs/architecture/unified-data-model.md §5, §6 (M1)
-- Rollback: DROP TRIGGER/FUNCTION/TABLEs — no existing data touched.
-- ============================================================

-- ------------------------------------------------------------
-- companies — the tenant root
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- company_members — who belongs to which tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'owner'
               CHECK (role IN ('owner', 'estimator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_company_members_profile_id
  ON public.company_members(profile_id);

-- ------------------------------------------------------------
-- RLS helper — the one membership test used everywhere.
-- SECURITY DEFINER so policies on company_members itself do not
-- recurse; STABLE so the planner can cache it per statement.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_company_member(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_members
    WHERE company_id = target_company_id
      AND profile_id = auth.uid()
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_company_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_company_member(uuid) TO service_role;

-- ------------------------------------------------------------
-- RLS — members read their own company; writes are service-role
-- and trigger only (no user-facing company management yet).
-- ------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their company" ON public.companies;
CREATE POLICY "Members can view their company"
  ON public.companies FOR SELECT
  TO authenticated
  USING (public.is_company_member(id));

DROP POLICY IF EXISTS "Service role can manage companies" ON public.companies;
CREATE POLICY "Service role can manage companies"
  ON public.companies FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.company_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their memberships" ON public.company_members;
CREATE POLICY "Members can view their memberships"
  ON public.company_members FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.is_company_member(company_id));

DROP POLICY IF EXISTS "Service role can manage company members" ON public.company_members;
CREATE POLICY "Service role can manage company members"
  ON public.company_members FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
GRANT SELECT ON public.company_members TO authenticated;
GRANT ALL ON public.company_members TO service_role;

-- ------------------------------------------------------------
-- Backfill — one company per existing profile.
-- Idempotent: skips profiles that already have a membership.
-- ------------------------------------------------------------
DO $$
DECLARE
  p RECORD;
  new_company_id uuid;
BEGIN
  FOR p IN
    SELECT pr.id, pr.email, pr.company_name
    FROM public.profiles pr
    WHERE NOT EXISTS (
      SELECT 1 FROM public.company_members m WHERE m.profile_id = pr.id
    )
  LOOP
    INSERT INTO public.companies (name)
    VALUES (COALESCE(NULLIF(trim(p.company_name), ''), p.email, 'My Company'))
    RETURNING id INTO new_company_id;

    INSERT INTO public.company_members (company_id, profile_id, role)
    VALUES (new_company_id, p.id, 'owner');
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- New signups — create a company + owner membership whenever a
-- profile is created (handle_new_user already creates profiles;
-- this is a separate additive trigger, not a modification of it).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_profile_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.company_members WHERE profile_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.companies (name)
  VALUES (COALESCE(NULLIF(trim(NEW.company_name), ''), NEW.email, 'My Company'))
  RETURNING id INTO new_company_id;

  INSERT INTO public.company_members (company_id, profile_id, role)
  VALUES (new_company_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_company ON public.profiles;
CREATE TRIGGER on_profile_created_company
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile_company();

COMMENT ON TABLE public.companies IS
  'Tenant root. Every contractor-specific record hangs off a company, never a bare profile. One company per profile in the single-member era; multi-member is schema-ready but not product-exposed.';

COMMENT ON TABLE public.company_members IS
  'Company membership. RLS on tenant tables uses is_company_member(company_id).';
