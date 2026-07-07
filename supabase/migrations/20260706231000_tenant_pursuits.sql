-- ============================================================
-- Tenant Boundary Refactor — Foundation 2 of 2: pursuits
--
-- The company-scoped home for tenant opinion about a canonical
-- opportunity. Replaces (over a dual-write window, NOT yet a
-- drop) the tenant state currently leaked onto shared
-- opportunity_candidates rows: review_notes and the
-- converted_project_id linkage.
--
-- Deliberately NOT migrated here (scope discipline):
--   - auto_status / qualification_score  → frozen; retires when
--     F5 resumes company-scoped (see roadmap Task 7.5 note)
--   - saved_opportunities                → stays as-is; absorb
--     into pursuits is deferred to Phase G
--
-- Depends on: 20260706230000_tenant_companies.sql
-- Architecture: docs/architecture/unified-data-model.md §5, §6 (M2)
-- Rollback: DROP TABLE public.pursuits — legacy columns remain
-- authoritative until the cleanup phase; nothing is destroyed.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pursuits (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  opportunity_candidate_id  uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE CASCADE,
  -- Stage vocabulary matches projects.pursuit_status (20260625000001)
  -- plus the pre-conversion stages that precede a project's existence.
  stage                     text NOT NULL DEFAULT 'reviewing'
                              CHECK (stage IN ('tracking', 'reviewing', 'estimating',
                                               'submitted', 'won', 'lost', 'archived')),
  triage_notes              text,
  project_id                uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by                uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, opportunity_candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_pursuits_company_id
  ON public.pursuits(company_id);
CREATE INDEX IF NOT EXISTS idx_pursuits_candidate_id
  ON public.pursuits(opportunity_candidate_id);
CREATE INDEX IF NOT EXISTS idx_pursuits_project_id
  ON public.pursuits(project_id)
  WHERE project_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_pursuits_updated_at ON public.pursuits;
CREATE TRIGGER update_pursuits_updated_at
  BEFORE UPDATE ON public.pursuits
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- RLS — company-scoped for every verb. This is the boundary.
-- ------------------------------------------------------------
ALTER TABLE public.pursuits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view company pursuits" ON public.pursuits;
CREATE POLICY "Members can view company pursuits"
  ON public.pursuits FOR SELECT
  TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Members can create company pursuits" ON public.pursuits;
CREATE POLICY "Members can create company pursuits"
  ON public.pursuits FOR INSERT
  TO authenticated
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Members can update company pursuits" ON public.pursuits;
CREATE POLICY "Members can update company pursuits"
  ON public.pursuits FOR UPDATE
  TO authenticated
  USING (public.is_company_member(company_id))
  WITH CHECK (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Members can delete company pursuits" ON public.pursuits;
CREATE POLICY "Members can delete company pursuits"
  ON public.pursuits FOR DELETE
  TO authenticated
  USING (public.is_company_member(company_id));

DROP POLICY IF EXISTS "Service role can manage pursuits" ON public.pursuits;
CREATE POLICY "Service role can manage pursuits"
  ON public.pursuits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pursuits TO authenticated;
GRANT ALL ON public.pursuits TO service_role;

-- ------------------------------------------------------------
-- Backfill 1 — converted candidates.
-- Company is attributed through the owning project's gc_id
-- membership (deterministic; no name matching). Stage maps from
-- the project's existing pursuit_status; 'active' means the
-- pursuit is in estimating (a project exists).
-- Covers both linkage directions: candidate.converted_project_id
-- and projects.source_opportunity_candidate_id.
-- ------------------------------------------------------------
INSERT INTO public.pursuits
  (company_id, opportunity_candidate_id, stage, triage_notes, project_id, created_by)
SELECT DISTINCT ON (m.company_id, oc.id)
  m.company_id,
  oc.id,
  CASE p.pursuit_status
    WHEN 'submitted' THEN 'submitted'
    WHEN 'won'       THEN 'won'
    WHEN 'lost'      THEN 'lost'
    WHEN 'archived'  THEN 'archived'
    ELSE 'estimating'
  END,
  oc.review_notes,
  p.id,
  p.gc_id
FROM public.opportunity_candidates oc
JOIN public.projects p
  ON p.id = oc.converted_project_id
  OR (p.origin = 'opportunity_intelligence' AND p.source_opportunity_candidate_id = oc.id)
JOIN public.company_members m
  ON m.profile_id = p.gc_id
ORDER BY m.company_id, oc.id,
         -- prefer the project the candidate itself points at
         (p.id = oc.converted_project_id) DESC, p.created_at DESC
ON CONFLICT (company_id, opportunity_candidate_id) DO UPDATE
  SET project_id   = COALESCE(pursuits.project_id, EXCLUDED.project_id),
      triage_notes = COALESCE(pursuits.triage_notes, EXCLUDED.triage_notes);

-- ------------------------------------------------------------
-- Backfill 2 — notes-only candidates.
-- review_notes has no author column (reviewed_by was never
-- written anywhere), so attribution is only safe when exactly
-- one company exists (the single-tenant era this refactor ends).
-- With multiple companies, unattributable notes are left on the
-- legacy column and reported via NOTICE for manual attribution.
-- ------------------------------------------------------------
DO $$
DECLARE
  sole_company_id uuid;
  company_count   integer;
  skipped         integer;
BEGIN
  SELECT count(*) INTO company_count FROM public.companies;

  IF company_count = 1 THEN
    SELECT id INTO sole_company_id FROM public.companies;

    INSERT INTO public.pursuits
      (company_id, opportunity_candidate_id, stage, triage_notes)
    SELECT sole_company_id, oc.id, 'reviewing', oc.review_notes
    FROM public.opportunity_candidates oc
    WHERE oc.review_notes IS NOT NULL
    ON CONFLICT (company_id, opportunity_candidate_id) DO UPDATE
      SET triage_notes = COALESCE(pursuits.triage_notes, EXCLUDED.triage_notes);
  ELSE
    SELECT count(*) INTO skipped
    FROM public.opportunity_candidates oc
    WHERE oc.review_notes IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.pursuits pu
        WHERE pu.opportunity_candidate_id = oc.id
      );
    RAISE NOTICE 'tenant_pursuits backfill: % companies exist; % notes-only candidates left unattributed on legacy columns',
      company_count, skipped;
  END IF;
END $$;

COMMENT ON TABLE public.pursuits IS
  'Company-scoped tenant opinion about a canonical opportunity (triage notes, stage, project linkage). Canonical facts stay on opportunity_candidates; this table is the tenant boundary. Legacy candidate columns (status, review_notes, converted_project_id) remain dual-written until the cleanup phase.';
