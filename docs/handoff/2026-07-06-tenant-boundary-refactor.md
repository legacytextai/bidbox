# BidBox Engineering Handoff — Tenant Boundary Refactor (Foundation + Dual-Write)

**Date:** 2026-07-06
**Branch:** `phase1-opportunity-intelligence`
**Commits:** `217a97f` (foundation migrations), `4c59588` (dual-write layer)
**Architecture:** `docs/architecture/unified-data-model.md` §5–§6 (M1–M3)
**Status:** Code and migrations complete and pushed. **Production application + validation pending** — this environment has no Supabase service access (same constraint as prior sessions); migrations apply via Lovable or the dashboard SQL editor. §4 below is the complete validation runbook.

---

## 1. What Changed

### Migrations (additive only; nothing altered, nothing dropped)

| File | Creates |
|---|---|
| `20260706230000_tenant_companies.sql` | `companies`, `company_members`, `is_company_member(uuid)` RLS helper, backfill (one company per profile, owner membership), AFTER INSERT trigger on `profiles` for new signups |
| `20260706231000_tenant_pursuits.sql` | `pursuits` (company-scoped: stage, triage_notes, project_id; `UNIQUE(company_id, opportunity_candidate_id)`; company RLS on every verb), backfill from converted + noted candidates |

Backfill attribution rules (deterministic, no name matching):
- **Converted candidates** → company via the owning project's `gc_id` membership; stage mapped from `projects.pursuit_status` (`active`→`estimating`, else 1:1). Covers both linkage directions (`converted_project_id` and `projects.source_opportunity_candidate_id`).
- **Notes-only candidates** → the sole company **iff exactly one company exists** (`review_notes` has no author column — `reviewed_by` was never written by any code). With multiple companies, notes stay on the legacy column and a NOTICE reports the count.

### Code (dual-write phase — legacy columns remain authoritative)

- **`src/lib/tenant.ts` (new):** `getActiveCompanyId()` (cached), `fetchCompanyPursuits()` (RLS-scoped), `upsertPursuit()` — **all fail-soft**: if the migrations aren't applied yet or the user has no membership, every call no-ops with a console warning and legacy behavior is unchanged. The frontend deploy is therefore safe in either order relative to migration application.
- **`src/pages/Opportunities.tsx`:** loads company pursuits alongside candidates; notes box dual-writes (`pursuits.triage_notes` + legacy `review_notes`) and dual-reads (pursuit preferred, legacy fallback); On-Calendar badge prefers `pursuits.project_id`.
- **`src/pages/OpportunityReport.tsx`:** Add to Calendar (`syncCandidateLink`) dual-writes the pursuit (stage `estimating`, project linkage).
- **`supabase/functions/manage-opportunity-intelligence/index.ts`:** analysis-delete unlinks the pursuit (`project_id` null, stage → `reviewing`) **before** deleting the project row (`pursuits.project_id` is `ON DELETE SET NULL`, so the precise match only exists while the project does). Fail-soft.

### Explicitly untouched (scope discipline, per approval)

Worker (`bidbox-worker/` — zero changes), all drivers, all edge functions except the one above, qualification (`auto_status`/`qualification_score` frozen on candidates; retires at F5 resume per roadmap Task 7.5 note), `saved_opportunities` (kept as-is; absorb deferred to Phase G), intelligence/document/chunk tables, Atlas.

---

## 2. Migration Sequence & Current Phase

```
[✅ code] Foundation migrations written        (217a97f)
[✅ code] Dual-write + dual-read overlay       (4c59588)
[⬜ prod] Apply 20260706230000 then 20260706231000   ← NEXT (Lovable/dashboard)
[⬜ prod] Run validation runbook (§4)
[⬜ soak] Dual-write soak (a few days of normal use + 2 nightly scans)
[⬜ later] CLEANUP PHASE — deliberately deferred, do NOT run yet:
          stop legacy writes → column-guard trigger on candidates →
          drop dead columns (reviewed_by/reviewed_at first)
```

Per the approval: legacy columns stay in place as long as they reduce risk. The cleanup phase is a separate, explicit decision after validation passes.

## 3. Rollback Strategy

- **Before migrations apply:** nothing to roll back; fail-soft code no-ops.
- **After migrations, before cleanup:** legacy columns are still written by every flow, so rollback = revert the frontend commit (`4c59588`) and/or `DROP TABLE public.pursuits, public.company_members, public.companies; DROP FUNCTION public.is_company_member(uuid), public.handle_new_profile_company(); DROP TRIGGER on_profile_created_company ON public.profiles;`. No canonical data is touched in any path.
- **Point of no return:** only the (deferred) cleanup phase's column drops. Everything before that is reversible.

---

## 4. Production Validation Runbook

Run after both migrations apply. SQL runs in the dashboard SQL editor; UI steps in the production app.

### 4.1 Migration integrity (SQL)

```sql
-- 1) Tenant root: companies == profiles, every profile has a membership
SELECT (SELECT count(*) FROM companies) companies, (SELECT count(*) FROM profiles) profiles;
SELECT count(*) FROM profiles p WHERE NOT EXISTS
  (SELECT 1 FROM company_members m WHERE m.profile_id = p.id);           -- expect 0

-- 2) Pursuit backfill completeness
SELECT count(*) FROM opportunity_candidates oc
WHERE oc.converted_project_id IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM pursuits pu WHERE pu.opportunity_candidate_id = oc.id
     AND pu.project_id = oc.converted_project_id);                       -- expect 0
SELECT count(*) FROM opportunity_candidates oc
WHERE oc.review_notes IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM pursuits pu WHERE pu.opportunity_candidate_id = oc.id
     AND pu.triage_notes = oc.review_notes);                             -- expect 0

-- 3) No duplicate pursuits (belt and suspenders; UNIQUE enforces it)
SELECT company_id, opportunity_candidate_id, count(*) FROM pursuits
GROUP BY 1,2 HAVING count(*) > 1;                                        -- expect 0 rows

-- 4) RLS in place
SELECT tablename, policyname FROM pg_policies
WHERE tablename IN ('companies','company_members','pursuits') ORDER BY 1;
-- expect: member SELECT + service ALL on companies/company_members;
--         member SELECT/INSERT/UPDATE/DELETE + service ALL on pursuits

-- 5) Idempotency: re-run both migration files in the SQL editor → all no-ops, same counts
```

### 4.2 User flows (production UI, as the beta user)

| # | Check (from the approval's validation list) | How | Pass = |
|---|---|---|---|
| 1 | Existing opportunities still work | Open /opportunities | List renders; badges, notes, tabs intact |
| 2 | Notes migrated + dual-write | Read an existing note; edit and save; then SQL: pursuit `triage_notes` == candidate `review_notes` | Both updated |
| 3 | Saved opportunities work | Toggle save on/off; check Saved tab | Unchanged behavior (deliberately untouched) |
| 4 | Add to Calendar works | Add an analyzed opportunity | Project created; SQL: pursuit has `stage='estimating'`, `project_id` set; legacy `converted_project_id` matches |
| 5 | Existing projects remain linked | Open a pre-refactor converted project | ProjectDetail still shows source opportunity |
| 6 | Analyze Project works | Trigger on a fresh opportunity | Task queued; pipeline columns update (path untouched by refactor) |
| 7 | Delete analysis resets pursuit | Delete an analysis with a project | SQL: pursuit `project_id` null, `stage='reviewing'`, notes preserved |
| 8 | Intelligence reports untouched | Open an existing report | Renders identically (no code path changed) |
| 9 | Console check | DevTools on /opportunities | No `[tenant]` warnings once migrations are applied |

### 4.3 Pipeline non-interference (after the next 2 nightly scans)

```sql
SELECT start_time, status, return_message FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname='nightly-refresh-opportunities')
ORDER BY start_time DESC LIMIT 2;                    -- expect: succeeded, sources queued as usual
SELECT count(*) FROM opportunity_candidates;         -- expect: normal growth, no anomaly
```
The worker has zero knowledge of the new tables; any scan anomaly is by definition unrelated — but verify anyway.

### 4.4 Company isolation (the acceptance test that defines the refactor)

Create a **second test account** (new signup → trigger should auto-create its company):
```sql
-- after signup:
SELECT c.name, m.role FROM companies c JOIN company_members m ON m.company_id=c.id
JOIN profiles p ON p.id=m.profile_id WHERE p.email='<test email>';       -- expect 1 owner row
```
As the test user: /opportunities must show **no notes and no On-Calendar badges** from the beta company (canonical cards themselves are shared — correct). Save a note as the test user; confirm the beta user does not see it (note: the note *text* also lands on the shared legacy column during dual-write — this is the known, accepted limitation of the dual-write window and is exactly what the cleanup phase removes; the pursuit-side isolation is what's being validated). Then `DELETE` the test pursuit/membership/company rows or leave for cleanup-phase testing.

---

## 5. Remaining Technical Debt (documented, deliberately not implemented)

1. **Cleanup phase** (the scheduled remainder of this refactor): stop legacy writes; column-guard trigger on `opportunity_candidates` (must come only after dual-writes stop — it would reject them); drop `reviewed_by`/`reviewed_at` (dead), then `status`/`review_notes`/`converted_project_id` after a clean soak. Trigger: validation §4 fully green + user go-ahead.
2. **Dual-write window limitation:** legacy `review_notes` is still a shared column — a second company's notes would collide there until cleanup. Acceptable now (one real company); the pursuit rows are already correctly isolated. Trigger for urgency: any second real signup.
3. **Qualification freeze:** `auto_status`/`qualification_score` still tenant-derived-on-canonical; retires at F5 resume into `pursuit_qualifications` (roadmap Task 7.5 note).
4. **`saved_opportunities` absorb into pursuits** (stage `tracking`): deferred to Phase G.
5. **`getActiveCompanyId()` caches per page load** and assumes single membership — fine for the single-member era; revisit with multi-member companies.
6. **Discovered while implementing** (documented per approval, not fixed): `docs/pending-migrations.md` was stale (2026-07-01 entries were applied but still listed pending — now annotated); `OpportunityReport.tsx` writes candidate pipeline columns with the user JWT, which is what makes the future guard trigger (not a policy drop) the right closure mechanism.

## 6. What the Next Session Does

1. Apply the two migrations (Lovable or SQL editor), in order.
2. Run §4.1–§4.2 the same day; §4.3 after two nights; §4.4 when convenient.
3. Any failure: diagnose against §1's write-site list — every pursuit write site is listed there.
4. When all green + a quiet soak: propose the cleanup phase as its own small, explicit change.
