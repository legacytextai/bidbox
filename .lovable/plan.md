I'm using knowledge.

## Investigation Report — Pursuit Status Select Failure

### Symptoms
- Select on `/projects/:id` header shows toast "Failed to update pursuit status" only when picking **Reviewing**.
- Picking **Pursuing** or **Passed** appears to silently revert to **Submitted**.
- Only **Submitted** persists.

### Root Cause
The database `CHECK` constraint on `public.projects.pursuit_status` does **not** match the UI's pursuit vocabulary.

```text
DB allows:  active | submitted | won | lost | archived
UI sends:   reviewing | pursuing | passed | submitted
```

So **every** value except `submitted` violates the constraint and the update is rejected with Postgres error `23514` (check constraint `projects_pursuit_status_check`).

Why only Reviewing shows a toast:
- `handlePursuitStatusChange` in `src/components/project-workspace/ProjectWorkspace.tsx` does optimistic update + revert on error and always toasts. The toast does fire for Pursuing/Passed too, but the optimistic state also snaps back to the previously persisted value (`submitted`), so visually the dropdown "switches back to Submitted." Reviewing is the case the user paused on long enough to notice the toast. The underlying failure is identical for all three.

Additionally, default column value is `'active'` — also not in the UI vocabulary, so new rows are out of sync as well (41 rows currently `active`, 1 `submitted`).

### Files Involved
- `src/components/project-workspace/ProjectWorkspace.tsx` — UI options: reviewing / pursuing / passed / submitted.
- DB constraint `projects_pursuit_status_check` defined in an older migration.

### Proposed Fix (single migration, no UI change)

Bring the database in line with the new four-state UI vocabulary, which is what the product currently expects.

1. **Migration** `20260629000001_align_pursuit_status_vocabulary.sql`:
   - Drop constraint `projects_pursuit_status_check`.
   - Backfill existing rows:
     - `active` → `reviewing`
     - `won`, `lost`, `archived` (if any appear later) → `passed`
     - `submitted` → unchanged.
   - Re-add constraint:
     ```sql
     ALTER TABLE public.projects
       ADD CONSTRAINT projects_pursuit_status_check
       CHECK (pursuit_status = ANY (ARRAY['reviewing','pursuing','passed','submitted']));
     ```
   - Change column default to `'reviewing'`.

2. **Hardening (optional, same migration)**: also ensure `pursuit_status` is `NOT NULL` and set any stray NULLs to `reviewing`.

3. **Verification**:
   - `SELECT pursuit_status, count(*) FROM projects GROUP BY 1;` shows only the four allowed values.
   - In-app: switch between Reviewing / Pursuing / Passed / Submitted on the workspace header — each persists, no toast, `pursuit_status_updated_at` updates.

4. **No code changes** required in `ProjectWorkspace.tsx`; existing optimistic update + toast logic is correct once the DB accepts the values.

### Out of Scope
- `project_lifecycle_status` is a separate column with its own vocabulary and is unaffected.
- No RLS / policy changes — existing update policy already covers this column.