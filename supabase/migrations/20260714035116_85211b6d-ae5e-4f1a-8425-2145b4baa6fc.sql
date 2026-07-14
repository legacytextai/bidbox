BEGIN;

DROP POLICY IF EXISTS "Authenticated users can review candidates"
  ON public.opportunity_candidates;
REVOKE UPDATE ON public.opportunity_candidates FROM authenticated;

DROP POLICY IF EXISTS "Public can download project files"
  ON storage.objects;

COMMIT;