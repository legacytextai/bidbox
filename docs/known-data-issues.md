# Known Data Issues

Issues in this file are database-state or configuration problems discovered in
production. They are not code bugs in the general sense, but are gaps in the
database setup that affect runtime behavior.

---

## Download buttons fail with "Object not found" — missing storage policy

**Discovered:** 2026-06-30  
**Status:** Fix written, awaiting migration application

### Symptom

Clicking a Download button on the Opportunity Documents tab (or the Project
Workspace Documents tab) shows a toast: "Could not generate a download link."

The browser console shows:
```
StorageApiError: Object not found
POST https://.../storage/v1/object/sign/opportunity-documents/... 400 (Bad Request)
```

### Root cause

The `opportunity-documents` storage bucket was created as private
(`public = false`) in migration `20260615000001` but **no `storage.objects`
SELECT policy was ever added for authenticated users.**

Supabase returns HTTP 400 "Object not found" — not 401 or 403 — when a
signed URL request is denied due to a missing RLS policy. This is a deliberate
Supabase security design: callers cannot distinguish "file missing" from "you
have no permission."

Workers upload via the `service_role` key, which bypasses RLS. So acquisition
succeeds and `acquisition_status` is correctly set to `acquired`. The frontend
uses the user's JWT (anon key + session), which follows RLS. Without a SELECT
policy, `createSignedUrl()` fails even though the file is present in storage.

**The files are not missing. The policy is missing.**

### Evidence

Every other private bucket in the app has a storage SELECT policy:
- `bid-submissions` — `CREATE POLICY ... FOR SELECT ... USING (bucket_id = 'bid-submissions' AND ...)`
- `project-files` — `CREATE POLICY ... FOR SELECT USING (bucket_id = 'project-files')`

The `opportunity-documents` bucket has none.

### Fix

Migration `20260701140000_opportunity_documents_storage_policy.sql` adds:
```sql
CREATE POLICY "Authenticated users can download opportunity documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'opportunity-documents');
```

This migration is committed but **not yet applied**. See `docs/pending-migrations.md`.
Once applied, Download buttons will work immediately — no other code changes needed.
