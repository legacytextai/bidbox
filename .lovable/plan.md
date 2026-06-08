# Apply pending migration + redeploy qualifier

## 1. Run migration `20260608000002_mark_expired_opportunity_candidates_red.sql`

Backfill: mark every existing `opportunity_candidates` row whose `bid_due_at < now()` as:
- `auto_status = 'red'`
- `auto_status_reason = 'Bid closed'`
- `qualification_score = 0`
- `qualified_at = now()`

This immediately hides the 2024 "Pipeline Construction Bidding" row (and any other past-due rows) from the default `/opportunities` view.

```sql
UPDATE public.opportunity_candidates
SET auto_status = 'red',
    auto_status_reason = 'Bid closed',
    qualification_score = 0,
    qualified_at = now()
WHERE bid_due_at IS NOT NULL
  AND bid_due_at < now()
  AND (auto_status IS DISTINCT FROM 'red' OR auto_status_reason IS DISTINCT FROM 'Bid closed');
```

No schema change, no GRANT/RLS changes — data-only backfill that complements the hard rule already in `qualify-candidates/index.ts` (the "Bid closed" red branch is already in source at lines ~93–104).

## 2. Redeploy edge function `qualify-candidates`

The function source already contains the hard red rule (bid due in past → red + "Bid closed", returns immediately). Redeploy so the live runtime matches source. No code edits needed.

## 3. Worker redeploy (Railway)

Railway auto-deploys from the connected GitHub branch on push. Commit `b1ffff7` (driver fix scoping "Bidding" match to the status cell, not full row text) lives in the `bidbox-worker/` directory and is outside the Lovable build pipeline — Railway picks it up on its own. Nothing to do from this side beyond confirming the deploy went green after the push.

## Verification after apply

1. Re-query: `select count(*) from opportunity_candidates where bid_due_at < now() and auto_status <> 'red'` → expect 0.
2. Refresh `/opportunities` → 2024 Pipeline row should be gone from the default view (visible only under Filtered Out).
3. Next worker scan after `b1ffff7` deploys → no new candidates with Closed/Awarded titles containing "Bidding".

## Pull from GitHub

Lovable's GitHub sync is bidirectional and automatic — the latest `phase1-opportunity-intelligence` commits sync in without a manual pull step on this side. Worker commit `b1ffff7` is already in the repo per the file tree.

## Out of scope
- No driver code edits (already in `b1ffff7`).
- No `qualify-candidates` code edits (rule already in source).
- No new RLS, schema, or UI changes.
