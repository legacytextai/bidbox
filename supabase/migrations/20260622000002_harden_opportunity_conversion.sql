-- Phase G / Task 8.2: Opportunity conversion hardening.
-- Enforce deterministic one-opportunity-to-one-project conversion links.

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_one_oi_project_per_candidate
  ON public.projects (source_opportunity_candidate_id)
  WHERE origin = 'opportunity_intelligence'
    AND source_opportunity_candidate_id IS NOT NULL;

COMMENT ON INDEX public.idx_projects_one_oi_project_per_candidate IS
  'Prevents one analyzed opportunity from creating multiple Opportunity Intelligence projects.';

CREATE OR REPLACE FUNCTION public.prevent_conflicting_opportunity_project_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.converted_project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.opportunity_candidates oc
    WHERE oc.converted_project_id = NEW.converted_project_id
      AND oc.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Project % is already linked to another opportunity candidate', NEW.converted_project_id
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_conflicting_opportunity_project_link
  ON public.opportunity_candidates;

CREATE TRIGGER prevent_conflicting_opportunity_project_link
  BEFORE INSERT OR UPDATE OF converted_project_id
  ON public.opportunity_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_conflicting_opportunity_project_link();

COMMENT ON FUNCTION public.prevent_conflicting_opportunity_project_link() IS
  'Prevents future conversion writes from linking one project to multiple opportunity candidates.';
