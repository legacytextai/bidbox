## What's happening

The progress bar disappeared because of two separate issues, not because the scan finished.

### 1. Worker has stalled (backend)
- `agent_tasks` shows **68 `planetbids_scan` rows still `pending`**, all created at `2026-06-29 17:13:56 UTC`.
- None have been updated since they were queued — the Railway worker has not picked up a single one.
- The previous run (yesterday 21:58–22:22 UTC) completed all 68 sources normally, so this is a current worker outage, not a code regression.

### 2. UI rehydration window is too short (frontend)
- `src/pages/Opportunities.tsx` only rehydrates the `ActiveScansPanel` for scan tasks created within the **last 60 minutes** (`sinceIso = now - 1h`).
- The scan queued at 17:13 UTC; reloading after 18:13 UTC returns zero rows from that query, so `scanActive` stays `false` and the panel is hidden — even though 68 tasks are still pending.

## Proposed fix

**Frontend (Opportunities.tsx)**
- Widen the rehydration lookback from 1h to **6h** so a stuck or long-running scan still surfaces the panel on reload.
- No other UI logic changes; auto-dismiss after completion still works because it only fires once all tasks reach a terminal state.

**Backend (worker) — separate from this code change**
- Investigate why the Railway worker is not consuming `pending` `planetbids_scan` tasks (process down, crashed loop, env config). This is operational, not a code edit to this repo.
- Once the worker is healthy, the 68 pending tasks will drain and the (now-visible) panel will progress to 100%.

## Files touched

- `src/pages/Opportunities.tsx` — change the `sinceIso` constant in the rehydration `useEffect` from 60 minutes to 6 hours.

No schema changes, no edge function changes, no migrations.
