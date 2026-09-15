# Bug Report: Calendar month clipped at the bottom and day cells won't scroll

Date: 2026-09-15
Route: `/calendar`
User role: GC (logged in)
Reported by: Abdul Bidiwi (screenshots 2026-09-14, viewport ~1002x682)

---

## Bug Description

Two defects on the Calendar dashboard:

- **A.** The bottom portion of the monthly calendar is cut off. The final week (or two) is not visible and the page cannot be scrolled to reach it.
- **B.** On days with more than 2-3 events, only the first items render. The event list inside the day cell cannot be scrolled, so the remaining bids are unreachable.

## Current Behavior

- September 2026 and October 2026 both render with the last row clipped below the viewport; no scrollbar appears on the page.
- Sep 15, 2026 shows three Bid Due events with the third clipped mid-card; mouse wheel over the day box does nothing.

## Expected Behavior

- The entire month, including the last week, is visible or reachable by scrolling.
- Any day cell with more events than fit is independently scrollable through the full list.
- Print output is unchanged: full month, single landscape page.

## Steps to Reproduce

1. Sign in as a GC with 40+ scheduled projects.
2. Navigate to `/calendar` on a ~1000x680 viewport.
3. Observe the last week row is cut off and the page will not scroll.
4. Open a day with 3+ Bid Due events (e.g. Sep 15, 2026) and attempt to scroll inside the day box.

## Environment

- Route: `/calendar`
- Components: `src/pages/CalendarDashboard.tsx`, `src/components/CalendarGrid.tsx`
- Styling: `src/index.css` (print rules)
- Browser: Chrome, macOS

## Root Cause

1. The page wrapper used `h-[calc(100vh-2rem)]` while sitting inside a layout with a 4rem sticky header. The wrapper was taller than its available space, pushing the final week below the fold, and because it was a fixed-height flex column the surrounding container had nothing to scroll.
2. Week rows were `flex-1` with no minimum height, and day cells were `overflow-hidden` with the event list constrained by `max-h-[calc(100%-32px)]`, which resolved against an unreliable parent height. The list clipped instead of producing a working scrollbar.

## Fix Applied

- `src/pages/CalendarDashboard.tsx`: page container height changed to `h-[calc(100dvh-4rem)] min-h-0` to account for the header.
- `src/components/CalendarGrid.tsx`:
  - Grid container is now `overflow-y-auto` (class `calendar-scroll-area`), so tall months scroll instead of clipping.
  - Week rows given `min-h-[7.5rem]` so 6-week months stay legible.
  - Day cells are `flex flex-col min-h-0`; the date badge is `flex-shrink-0`; the event list is `flex-1 min-h-0 overflow-y-auto`, giving each busy day a real scrollbar.
- `src/index.css`: print rules force `.calendar-scroll-area` to `overflow: visible` and `max-height: none` so the printed PDF still renders the full month on one landscape page.

## Verification

- All weeks of September and October 2026 reachable.
- Sep 15, 2026 day box scrolls through every event.
- 6-week months scroll rather than clip.
- Print preview unchanged: single-page landscape month.
