## Scope
Single file: `src/pages/Opportunities.tsx`. Fix the countdown pill on opportunity cards.

## Problem
`daysUntilBidDue` rounds raw millisecond diffs with `Math.ceil`, which inflates the count whenever the bid is later in the day than "now". Example with today = 6/29:
- 7/1 (any time) → 2.x days → ceils to 3 days (should be 2)
- 7/2 (any time) → 3.x days → ceils to 4 days (sometimes; varies by time-of-day)
- Same-day bids show "1 day" instead of "Today"
- Next-day bids show "1 day" instead of "Tomorrow"

The count should be **calendar-day difference in Pacific Time**, not elapsed-time rounding.

## Fix
Rewrite `daysUntilBidDue` to:
1. Compute the calendar date (YYYY-MM-DD) of "now" in `America/Los_Angeles`.
2. Compute the calendar date of the bid_due_at in `America/Los_Angeles`.
3. Diff the two as whole days (UTC midnight of each ymd subtracted, divided by 86_400_000).

### Output rules (color logic unchanged)
| Calendar-day diff | Pill text   | Color   |
|-------------------|-------------|---------|
| < 0               | `Closed`    | muted   |
| 0                 | `Today`     | red     |
| 1                 | `Tomorrow`  | red     |
| 2 – 3             | `N days`    | red     |
| 4 – 7             | `N days`    | amber   |
| 8+                | `N days`    | green   |

`isBidClosed` keeps its current "past the actual instant" semantics — it's used for filtering/buckets, not the pill. Only the pill text/coloring changes.

## Implementation notes (technical)
Use `formatInProjectTimezone(iso, "America/Los_Angeles", "yyyy-MM-dd")` (already imported) to get both calendar dates, then:

```ts
const toUTC = (ymd: string) => Date.UTC(+ymd.slice(0,4), +ymd.slice(5,7)-1, +ymd.slice(8,10));
const days = Math.round((toUTC(dueYmd) - toUTC(nowYmd)) / 86_400_000);
```

This makes the pill a pure calendar-day comparison and produces consistent values for every card rendered in the same tick.

## Out of scope
- No changes to bucket logic, filtering, sorting, or the date format itself.
- No changes outside `Opportunities.tsx`.
