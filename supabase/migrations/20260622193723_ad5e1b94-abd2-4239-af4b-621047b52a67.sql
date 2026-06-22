-- Phase G / Task 8.1: Project origin and Opportunity Intelligence linkage.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_opportunity_candidate_id uuid REFERENCES public.opportunity_candidates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS opportunity_intelligence_report_id uuid REFERENCES public.opportunity_intelligence_reports(id) ON DELETE SET NULL;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_origin_check;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_origin_check
  CHECK (origin IN ('manual', 'one_link', 'opportunity_intelligence'));

CREATE INDEX IF NOT EXISTS idx_projects_origin ON public.projects (origin);
CREATE INDEX IF NOT EXISTS idx_projects_source_opportunity_candidate_id
  ON public.projects (source_opportunity_candidate_id)
  WHERE source_opportunity_candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_opportunity_intelligence_report_id
  ON public.projects (opportunity_intelligence_report_id)
  WHERE opportunity_intelligence_report_id IS NOT NULL;

UPDATE public.projects
SET origin = 'one_link'
WHERE origin = 'manual' AND source_url IS NOT NULL;

WITH latest_reports AS (
  SELECT DISTINCT ON (opportunity_candidate_id)
    id, opportunity_candidate_id
  FROM public.opportunity_intelligence_reports
  WHERE status IN ('ready', 'partial')
  ORDER BY opportunity_candidate_id, completed_at DESC NULLS LAST, updated_at DESC, created_at DESC
)
UPDATE public.projects p
SET origin = 'opportunity_intelligence',
    source_opportunity_candidate_id = oc.id,
    opportunity_intelligence_report_id = lr.id
FROM public.opportunity_candidates oc
LEFT JOIN latest_reports lr ON lr.opportunity_candidate_id = oc.id
WHERE oc.converted_project_id = p.id;

COMMENT ON COLUMN public.projects.origin IS 'Project creation source: manual, one_link, or opportunity_intelligence.';
COMMENT ON COLUMN public.projects.source_opportunity_candidate_id IS 'Originating opportunity candidate for Opportunity Intelligence projects.';
COMMENT ON COLUMN public.projects.opportunity_intelligence_report_id IS 'F4 Project Intelligence report used to seed the project workspace.';

-- Phase G / Task 8.2: Opportunity conversion hardening.
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_one_oi_project_per_candidate
  ON public.projects (source_opportunity_candidate_id)
  WHERE origin = 'opportunity_intelligence' AND source_opportunity_candidate_id IS NOT NULL;

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
    SELECT 1 FROM public.opportunity_candidates oc
    WHERE oc.converted_project_id = NEW.converted_project_id
      AND oc.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Project % is already linked to another opportunity candidate', NEW.converted_project_id
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_conflicting_opportunity_project_link ON public.opportunity_candidates;
CREATE TRIGGER prevent_conflicting_opportunity_project_link
  BEFORE INSERT OR UPDATE OF converted_project_id
  ON public.opportunity_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_conflicting_opportunity_project_link();

COMMENT ON FUNCTION public.prevent_conflicting_opportunity_project_link() IS
  'Prevents future conversion writes from linking one project to multiple opportunity candidates.';