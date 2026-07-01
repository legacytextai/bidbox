# Pending Database Migrations

Migrations in this file have been written and committed to the repository but
**have not been applied to the production Supabase database**. They must be
applied before the features that depend on them will work.

Lovable normally applies all migrations automatically. Use Lovable to apply
them once it becomes available again. There is no local Supabase CLI, no
GitHub Actions CI, and no direct postgres connection string available in this
environment — the only paths are Lovable or the Supabase dashboard SQL editor.

---

## 20260701150000_reschedule_nightly_refresh_midnight_pdt.sql

**Status:** Pending  
**File:** `supabase/migrations/20260701150000_reschedule_nightly_refresh_midnight_pdt.sql`  
**Committed in:** (next commit)

**What it does:**  
Reschedules the `nightly-refresh-opportunities` pg_cron job from `0 9 * * *` UTC
(02:00 AM PDT) to `0 7 * * *` UTC (00:00 PDT = midnight Pacific Daylight Time).
The original schedule had the UTC offset calculated incorrectly.

**Who is blocked:**  
No one — the scan still runs, just at 2 AM instead of midnight. This is cosmetic
correctness, not a functional blocker.

**What to do after applying:**  
Verify the updated schedule:
```sql
SELECT jobname, schedule FROM cron.job WHERE jobname = 'nightly-refresh-opportunities';
```
Expected: `schedule = '0 7 * * *'`

---

## 20260701120000_planetbids_login_lock.sql

**Status:** Pending  
**File:** `supabase/migrations/20260701120000_planetbids_login_lock.sql`  
**Committed in:** `ac7366a`

**What it does:**  
Creates two PostgreSQL functions — `acquire_planetbids_lock` and
`release_planetbids_lock` — that implement a cooperative distributed mutex
for PlanetBids login sessions. Without this migration, multiple Railway worker
instances logging in simultaneously will invalidate each other's bearer tokens
and all document_prefetch tasks for PlanetBids portals will fail.

**Who is blocked:**  
The worker. Railway workers will continue to get "No PlanetBids bearer token
captured after login" errors for any concurrent document_prefetch tasks.

**What to do after applying:**  
Deploy the Railway worker with commit `ac7366a`+ in scope, then run:
```
node bidbox-worker/scripts/requeue-failed-prefetch.js
```
to requeue the ~3 failed tasks from the June 2026 OML validation.

---

## 20260701130000_agent_tasks_auth_insert.sql

**Status:** Pending — **this is a user-facing blocker**  
**File:** `supabase/migrations/20260701130000_agent_tasks_auth_insert.sql`  
**Committed in:** `14b0e1c`

**What it does:**  
Adds an RLS INSERT policy to `agent_tasks` that allows authenticated users
to queue `project_analysis` tasks directly from the frontend. This is required
by the "Add to Calendar" flow (`queuePostCalendarPreparation` in
`src/pages/OpportunityReport.tsx`), which inserts the task via the Supabase JS
client instead of routing through the `manage-opportunity-intelligence` edge
function (the deployed edge function was outdated and returned "Unsupported
action" for `force_prepare`).

**Current symptom:**  
Clicking "Add to Calendar" shows a red toast:
> Failed to add — new row violates row-level security policy for table "agent_tasks"

The project IS created successfully (the INSERT into `projects` table works).
Only the intelligence task queuing fails. The user is correctly navigated to
the project, but no preparation starts automatically.

**SQL in the migration (safe to paste directly into SQL editor):**
```sql
CREATE POLICY "Authenticated users can queue project_analysis tasks"
  ON public.agent_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (task_type = 'project_analysis');
```

**Who is blocked:**  
Users clicking "Add to Calendar" on any opportunity that hasn't been analyzed
yet. The project is still created but intelligence preparation doesn't start.

**Workaround while blocked:**  
None available without applying the migration. The user must navigate to the
project manually and trigger analysis from within the project workspace.

**What to do after applying:**  
No code changes needed. The frontend will immediately start working as soon as
the policy exists in the database.

---

## 20260701140000_opportunity_documents_storage_policy.sql

**Status:** Pending — **this is a user-facing blocker**  
**File:** `supabase/migrations/20260701140000_opportunity_documents_storage_policy.sql`  
**Committed in:** `(next commit)`

**What it does:**  
Adds a `storage.objects` SELECT policy for authenticated users on the
`opportunity-documents` bucket. Without it, `createSignedUrl()` returns
"Object not found" (HTTP 400) for every document download attempt. Supabase
intentionally returns this non-descriptive error (not 401/403) to prevent
bucket enumeration. The files are present in storage; the policy is what's missing.

**Current symptom:**  
Every Download button in the Opportunity Documents and Project Workspace
Documents tabs shows: "Could not generate a download link."

**SQL in the migration:**
```sql
CREATE POLICY "Authenticated users can download opportunity documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'opportunity-documents');
```

**Who is blocked:**  
All users trying to download any acquired opportunity document.

**Workaround while blocked:**  
None. Download is completely non-functional until this policy exists.

**What to do after applying:**  
No code changes needed. Download buttons will work immediately.
