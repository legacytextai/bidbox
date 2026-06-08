-- Mark already-discovered expired opportunity candidates as auto-red.
--
-- This is a one-time cleanup for candidates that were inserted before
-- qualify-candidates had a hard "bid closed" rule.

UPDATE public.opportunity_candidates
SET
  auto_status = 'red',
  auto_status_reason = 'Bid closed',
  qualification_score = 0,
  qualified_at = now(),
  updated_at = now()
WHERE bid_due_at IS NOT NULL
  AND bid_due_at < now()
  AND status <> 'converted';
