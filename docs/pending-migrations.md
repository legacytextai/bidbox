# Pending Database Migrations

Migrations in this file have been written and committed to the repository but
**have not been applied to the production Supabase database**. They must be
applied before the features that depend on them will work.

Lovable normally applies all migrations automatically. Use Lovable to apply
them once it becomes available again. There is no local Supabase CLI, no
GitHub Actions CI, and no direct postgres connection string available in this
environment — the only paths are Lovable or the Supabase dashboard SQL editor.

---

## PENDING — Cal eProcure title-recovery task dedupe (2026-07-14)

### 20260714080000_caleprocure_title_recovery_dedupe.sql

**Status:** PENDING — DDL (partial unique index), cannot be applied via the
service role from the worker environment.
**File:** `supabase/migrations/20260714080000_caleprocure_title_recovery_dedupe.sql`

**What it does:**
One partial unique index on `agent_tasks((payload->>'candidate_id'))` scoped to
active (`pending`/`running`/`retrying`) `caleprocure_title_recovery` tasks, so a
candidate can never have two live title-recovery tasks. Mirrors the PlanetBids
recovery index from `20260713233000`. No tables or columns change; the recovery
driver reuses the existing `recovery_*` candidate columns and
`opportunity_recovery_audits`.

**Until applied:** the worker performs an application-level active-task check
before enqueueing (`maybeQueueCaleprocureTitleRecovery` in
`bidbox-worker/index.js`) and the controlled-batch queue script does the same,
so the system is safe but not race-proof until the index lands.

**Validation queries:**
```sql
SELECT indexname FROM pg_indexes
WHERE tablename = 'agent_tasks'
  AND indexname = 'idx_agent_tasks_active_caleprocure_title_recovery';
```

## PENDING — OpenGov Phase 1 discovery driver (2026-07-07)

### 20260707230000_seed_opengov_source.sql

**Status:** APPLIED LIVE 2026-07-08 during Phase 1 validation — the two upserts
(opportunity_sources + portal_drivers) were executed against production via the
Supabase service role (the migration is pure DML). Source validated end-to-end
(125 CA construction candidates, 0 errors) and is now ENABLED
(`scan_enabled=true`, `refresh_enabled=true`). When Lovable applies the
committed migration file it is a no-op (`ON CONFLICT` upserts; the conflict
update never touches scan_enabled/refresh_enabled). Validation record:
`docs/handoff/2026-07-08-opengov-phase1-validation.md`.
**File:** `supabase/migrations/20260707230000_seed_opengov_source.sql`

**What it does:**
Seeds OpenGov as a first-class portal: one global `opportunity_sources` row
(`portal_type='opengov'`, "OpenGov — California Construction",
`scan_enabled=false`/`refresh_enabled=false` pending live validation) plus a
`portal_drivers` row (`opengov` → `opengov_driver`, `browserbase`). Additive +
idempotent (`ON CONFLICT (listing_url)` / `ON CONFLICT (portal_type)`); the
conflict update never re-disables an operator-enabled source.

**Depends on (Railway worker + env):**
- Worker deployed with `bidbox-worker/drivers/opengov.js` and the `opengov_scan`
  wiring (commit accompanying this migration).
- Env vars `OPENGOV_EMAIL` / `OPENGOV_PASSWORD` set in Railway.
- `BROWSERBASE_API_KEY` / `BROWSERBASE_PROJECT_ID` (already present for
  PlanetBids/LACMTA).

**What to do after applying (validation, then enable):**
```sql
-- confirm the source + driver rows exist
SELECT id, name, portal_type, scan_enabled FROM opportunity_sources WHERE portal_type='opengov';
SELECT * FROM portal_drivers WHERE portal_type='opengov';
```
Then trigger one manual scan (worker picks up an `opengov_scan` task), confirm
`opportunity_candidates` rows appear with `portal_type='opengov'`, populated
titles/agencies/due dates/source URLs, then flip `scan_enabled`/`refresh_enabled`
to true. Full runbook in the Phase 1 deliverables / handoff.

---

## PENDING — Edge function deployment: download-opportunity-document (2026-07-10)

**Status:** Committed (`41e69da`) but **NOT deployed** to Supabase. Confirmed live
2026-07-10: `POST /functions/v1/download-opportunity-document` returns 404
`NOT_FOUND` while deployed functions (e.g. `analyze-project`) return 401 without
auth. Lovable deployed the frontend from the push but did not deploy the new
edge function.

**File:** `supabase/functions/download-opportunity-document/index.ts`
(+ `verify_jwt = true` entry in `supabase/config.toml`)

**What it does:**
F2-lite on-demand document download (uniform document policy). Returns a signed
URL for acquired documents; for unacquired OpenGov documents enqueues one
candidate-scoped `document_prefetch` (trigger `f2_lite_on_demand_download`) and
the frontend polls until ready. No F3/F4 cascade.

**Who is blocked:**
Every Download button on title-only (Case B) OpenGov document rows fails with
"Download failed — Please try again." (`Retry Download`). Acquired-row
downloads (Case A, e.g. Force Main) are unaffected — they use storage signed
URLs directly, not the function.

**How to deploy (any one):**
1. Supabase CLI (installed locally, needs login):
   ```bash
   supabase login
   supabase functions deploy download-opportunity-document --project-ref ztuyjlyuzasbceepezua
   ```
2. Lovable: ask it to deploy the repo's Supabase edge functions.
3. Supabase dashboard → Edge Functions → new function
   `download-opportunity-document`, paste `index.ts`, enforce JWT verification.

**What to do after deploying (verification):**
```bash
curl -s -X POST "https://ztuyjlyuzasbceepezua.supabase.co/functions/v1/download-opportunity-document" -H "Content-Type: application/json" -d '{}'
# expect 401 Missing authorization header (NOT 404)
```
Then the controlled UI retest (needs explicit approval): click Download on
"Model Contract-IFB-012-294504-01-ME-1" (candidate `b8ca5c59…`, Asphalt and
Concrete Maintenance Services / County of Orange) — expect one
`document_prefetch` task (trigger `f2_lite_on_demand_download`), ~20-60s
Downloading…, then the PDF downloads; queue clean after; zero downstream
document_processing/project_analysis/project_intelligence tasks.

---

## PENDING — Admin role seed (2026-07-07)

### 20260707120000_seed_admin_role.sql

**Status:** Pending
**File:** `supabase/migrations/20260707120000_seed_admin_role.sql`

**What it does:**
Grants the `admin` role (existing `user_roles`/`has_role` architecture,
migration `20251130211130`) to `constructionaisolutionsco@gmail.com`.
Idempotent; NOTICE + no-op if the account does not exist yet. The Admin
section of the app (sidebar group + `/admin/coverage`) is visible only to
users with this role — no emails are hardcoded in application code.

**Who is blocked:**
The Admin sidebar section and Coverage Dashboard are invisible to the
intended admin until this is applied (existing admins, if any, see them
immediately).

**What to do after applying:**
```sql
SELECT u.email, r.role FROM public.user_roles r
JOIN auth.users u ON u.id = r.user_id WHERE r.role = 'admin';
-- expect: constructionaisolutionsco@gmail.com listed
```
Then sign in as that account — the Admin group appears in the sidebar with
Coverage, Analytics, and Network Subs.

---

## PENDING — Tenant Boundary Refactor foundation (2026-07-06)

### 20260706230000_tenant_companies.sql

**Status:** Pending
**File:** `supabase/migrations/20260706230000_tenant_companies.sql`

**What it does:**
Creates the tenant root: `companies`, `company_members`, the
`is_company_member(uuid)` RLS helper, RLS policies (member SELECT,
service-role writes), a backfill creating one company per existing profile
(owner membership), and an AFTER INSERT trigger on `profiles` so new signups
get a company automatically. Purely additive — nothing existing reads these
tables until the dual-write frontend deploy.

**Who is blocked:**
Pursuit dual-writes no-op harmlessly (fail-soft) until this and the pursuits
migration are applied. No user-facing breakage either way.

**What to do after applying:**
```sql
-- company count must equal profile count
SELECT (SELECT count(*) FROM public.companies)  AS companies,
       (SELECT count(*) FROM public.profiles)   AS profiles;
-- every profile has exactly one membership
SELECT count(*) FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.company_members m WHERE m.profile_id = p.id);
-- expected: 0
```

### 20260706231000_tenant_pursuits.sql

**Status:** Pending — apply AFTER 20260706230000
**File:** `supabase/migrations/20260706231000_tenant_pursuits.sql`

**What it does:**
Creates `pursuits` (company-scoped tenant opinion about a canonical
opportunity: stage, triage_notes, project linkage) with company RLS on every
verb, and backfills from existing data: converted candidates (attributed via
the owning project's `gc_id` membership; stage mapped from
`projects.pursuit_status`) and notes-only candidates (attributed to the sole
company when exactly one exists; otherwise left on legacy columns with a
NOTICE). Legacy candidate columns are untouched and stay dual-written until
the cleanup phase.

**What to do after applying:**
```sql
-- no duplicates possible (UNIQUE), spot-check totals:
SELECT count(*) FROM public.pursuits;
-- every converted candidate has a pursuit with project linkage
SELECT count(*) FROM public.opportunity_candidates oc
WHERE oc.converted_project_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.pursuits pu
                  WHERE pu.opportunity_candidate_id = oc.id
                    AND pu.project_id = oc.converted_project_id);
-- expected: 0
-- every noted candidate has its notes in a pursuit
SELECT count(*) FROM public.opportunity_candidates oc
WHERE oc.review_notes IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.pursuits pu
                  WHERE pu.opportunity_candidate_id = oc.id
                    AND pu.triage_notes = oc.review_notes);
-- expected: 0 (single-company era)
-- re-running the migration must be a no-op (idempotency)
```

Full production validation runbook: `docs/handoff/2026-07-06-tenant-boundary-refactor.md`.

---

## Applied 2026-07-01 (bundled by Lovable into `20260701175427`, commit `94de189`; cron fix superseded by `20260701194915`, commit `57b4721`) — see `docs/handoff/2026-07-01-oml-completion-agency-expansion.md` §3

## 20260701150000_reschedule_nightly_refresh_midnight_pdt.sql

**Status:** Applied (superseded by `20260701194915`)  
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

**Status update 2026-07-06: Applied** (bundled into `20260701175427`).

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

**Status update 2026-07-06: Applied** (bundled into `20260701175427`).

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

**Status update 2026-07-06: Applied** (bundled into `20260701175427`).

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
