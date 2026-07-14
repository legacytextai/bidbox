-- Close the two critical authorization findings without changing shared
-- candidate reads or owner-scoped project-file workflows.
BEGIN;

-- Canonical opportunity rows are worker-owned. Browser workflows now write
-- tenant state to pursuits or call an authenticated service-role Edge Function.
DROP POLICY IF EXISTS "Authenticated users can review candidates"
  ON public.opportunity_candidates;
REVOKE UPDATE ON public.opportunity_candidates FROM authenticated;

-- project-files metadata stores object paths. Owners continue to use the
-- existing JWT-scoped storage policies; anonymous public object URLs stop here.
DROP POLICY IF EXISTS "Public can download project files"
  ON storage.objects;
UPDATE storage.buckets
SET public = false
WHERE id = 'project-files';

COMMIT;
