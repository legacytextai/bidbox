# Known Data Issues

Issues in this file are database-state problems discovered in production. They
are not code bugs — the application code is correct — but the data is
inconsistent and requires a manual remediation step.

---

## Orphaned `opportunity_documents` rows — storage objects missing

**Discovered:** 2026-06-30  
**Affected candidates:** City of Palmdale — "3rd Street East and Technology Drive Traffic Signal 934" (and potentially others from the same period)

### Symptom

The Documents tab shows a Download button for each document (because
`acquisition_status = 'acquired'` and `storage_path` is set). Clicking Download
shows a red toast:

> "This document's file is no longer available in storage. Re-acquiring documents will restore it."

Supabase Storage returns HTTP 400 "Object not found" when the signed URL is
requested. The bytes do not exist at the path recorded in `storage_path`.

### Root cause

The `opportunity_documents` DB rows have `acquisition_status = 'acquired'` and
a populated `storage_path`, but the file objects in the `opportunity-documents`
Supabase Storage bucket at those paths no longer exist.

The worker only sets `acquisition_status = 'acquired'` after a successful
`storage.upload()` call, so the files existed in storage at the time of
acquisition. They were subsequently deleted. The most likely cause: a previous
`delete_analysis` call (or manual storage cleanup) removed the bytes from the
bucket but left the `opportunity_documents` rows in place.

### How to remediate

Re-acquire the documents by resetting the `document_prefetch` task for the
affected candidates and letting the worker re-run. Two prerequisites must be
met first:

1. **Apply migration `20260701120000_planetbids_login_lock.sql`** — prevents the
   concurrent login bug that caused prior `document_prefetch` failures for
   PlanetBids portals. See `docs/pending-migrations.md`.
2. **Deploy the Railway worker** with commit `ac7366a`+ so the lock code is live.

Then run the requeue script:
```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  node bidbox-worker/scripts/requeue-failed-prefetch.js --all
```

`--all` is needed here because these tasks likely completed with `status =
'acquired'` on the document rows but without the actual storage objects. You
may need to reset the document records directly:

```sql
-- Reset opportunity_documents rows back to a re-acquirable state
-- for a specific candidate (replace the UUID):
UPDATE opportunity_documents
SET acquisition_status = 'queued',
    storage_path       = NULL,
    storage_bucket     = NULL,
    file_size          = NULL
WHERE opportunity_candidate_id = '<candidate-id>'
  AND acquisition_status = 'acquired';

-- Also reset the candidate's document_acquisition_status so the
-- worker will re-run document_prefetch:
UPDATE opportunity_candidates
SET document_acquisition_status       = 'not_requested',
    document_acquisition_started_at   = NULL,
    document_acquisition_completed_at = NULL,
    document_acquisition_error        = NULL
WHERE id = '<candidate-id>';
```

After resetting, queue a new `document_prefetch` task via the admin panel or
by queueing it manually, then confirm the files appear in Supabase Storage and
the Download buttons work.

### Prevention

The `delete_analysis` edge function action (`deleteAnalysis`) calls
`removeOpportunityDocuments`, which deletes both the storage objects AND the
DB rows in the same transaction-equivalent flow. If a future cleanup operation
only deletes storage objects without also deleting or resetting the DB rows, it
will reproduce this issue. Any cleanup script touching the `opportunity-documents`
bucket must always pair storage deletion with a corresponding DB reset.
