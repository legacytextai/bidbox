-- Storage SELECT policy for the opportunity-documents bucket.
--
-- The bucket was created as private (public = false) in migration
-- 20260615000001_add_opportunity_document_acquisition.sql, but no
-- storage.objects RLS policy was ever added for authenticated users.
--
-- Without this policy, Supabase returns "Object not found" (HTTP 400)
-- when an authenticated frontend client calls createSignedUrl() on any
-- object in this bucket — even if the file is present.  Supabase does
-- this by design to prevent bucket enumeration: "no permission" and
-- "does not exist" look identical to the caller.
--
-- Workers upload via the service_role key (bypasses RLS), so acquisition
-- succeeds.  The frontend reads via the anon key + user JWT (follows RLS),
-- so signed URL generation fails without this policy.
--
-- Scope: any authenticated user.  opportunity_documents has no per-user
-- ownership column (documents belong to candidates, not to individual GC
-- accounts), and the app is single-tenant.  Files are still private — they
-- are only reachable via the time-limited signed URL.

CREATE POLICY "Authenticated users can download opportunity documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'opportunity-documents');
