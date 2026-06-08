## Why nothing seems to happen when you click Scan Now

The button does work — when you clicked it just now, 50+ PlanetBids tasks were queued in the database (confirmed). The problem is the UI feedback:

`scan-opportunities` queues sources **one at a time with a 2-second pause between each**. With ~50+ Southern California sources, the HTTP call takes roughly 100 seconds to return. Today the Active Scans panel is only rendered after that response comes back — so the button just sits on "Scanning…" for nearly two minutes with no panel, no toast, no movement. From the user's seat, it looks broken.

A second smaller issue: when the panel finally does render, the initial fetch joins by `payload->source_name`, which is fine, but the order of operations means `taskIds` is computed all at once from a single `gte("created_at", scanStartedAt)` query at the end — so even mid-scan we show nothing.

## Fix: show the panel the moment tasks start appearing

Drive the panel from a live subscription to `agent_tasks` INSERTs instead of waiting for the edge function's response.

### Changes in `src/pages/Opportunities.tsx`

1. When the user clicks Scan Now:
   - Record `scanStartedAt = new Date().toISOString()` and store it in state (`scanStartedAt`).
   - Open the panel immediately by setting a `scanActive` flag to `true` (panel shows "Queuing tasks…" until the first row arrives).
   - Fire-and-forget `supabase.functions.invoke("scan-opportunities")` — do **not** await its full response to render the panel. Still surface the final toast when it resolves (totals + errors).
   - Clear `scanLoading` once the invoke promise resolves so the button label returns to normal.

2. Add a realtime subscription to `agent_tasks` INSERT events that:
   - Filters client-side by `created_at >= scanStartedAt` and `task_type === "planetbids_scan"`.
   - Appends each new task id to `activeScanTaskIds` as it arrives, so the panel grows live while the edge function is still queuing.

3. The existing `onDismiss` clears `activeScanTaskIds`, `scanStartedAt`, and `scanActive`.

### Changes in `src/components/ActiveScansPanel.tsx`

1. Accept an optional `isQueuing: boolean` prop. When `taskIds.length === 0` and `isQueuing` is true, render the header ("Scanning…") + spinner + "Queuing tasks…" placeholder instead of returning `null`. This is what makes the panel appear instantly on click.

2. Header counter handles the growing total naturally — `completed / total` already recomputes as new task ids stream in.

3. Keep current auto-dismiss (10s after all done) and manual `X` dismiss. Skip auto-dismiss while `isQueuing` is still true (otherwise an empty panel could self-close before any tasks arrive).

### What stays the same

- No edge function changes. No worker changes. No new migration — `agent_tasks` is already in the realtime publication and already has `updated_at`.
- Existing realtime subscriptions for `opportunity_candidates` and `agent_tasks` UPDATEs keep handling new candidates and status transitions.
- Toast on completion still uses `data.total_queued` / `total_candidates_new` from the eventual edge response.

## Acceptance

- Click Scan Now → panel renders within ~100ms showing "Scanning… 0 / 0 — Queuing tasks…".
- Within seconds the panel populates row-by-row as `agent_tasks` INSERTs stream in.
- As the Railway worker claims tasks, statuses flip Queued → Scanning → Complete live via the existing UPDATE subscription.
- New opportunities appear in the grid via the existing `opportunity_candidates` INSERT subscription.
- Auto-dismiss after all tasks complete, or manual X.
