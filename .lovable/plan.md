# Bug Report + Fix Plan: Calendar month is cut off and day cells won't scroll

## Confirmed understanding

Two separate problems on the Calendar page (`/calendar`):

**A. Bottom of the month is cut off.** The last week (or two) of the month is hidden below the visible area and the page will not scroll down to reveal it.

**B. Busy days won't scroll.** On a day with more than 2-3 events, only the first items are visible and the list inside that day box cannot be scrolled.

Screenshots from Sep 14, 2026 confirm both: September shows rows clipped at the bottom, and Sep 15 shows at least three Bid Due entries with the third clipped mid-card.

## Root cause

- The calendar page wrapper is locked to `h-[calc(100vh-2rem)]`, but it sits inside a layout that already spends 4rem on the sticky header. The wrapper is therefore taller than the space it actually has, so the final week renders below the fold. Because the page is a fixed-height flex column, the surrounding scroll container has nothing to scroll, so the user cannot reach it.
- Each week row is `flex-1`, so rows split whatever height is left evenly. When a month needs 6 rows, each row shrinks; day cells are `overflow-hidden` and the inner event list uses `max-h-[calc(100%-32px)]`, which resolves against an unreliable parent height. The result is a clipped list with no working scrollbar.

## Fix

1. **Give the page real height.** Replace the hard-coded `h-[calc(100vh-2rem)]` on the Calendar page with a height that accounts for the header (use `min-h-0` flex chain or `h-[calc(100dvh-4rem)]`), so the grid gets the exact space available and nothing renders below the fold.
2. **Guarantee a minimum week-row height.** Keep rows flexible but add a sensible minimum so 6-week months stay legible; if the month exceeds available space, the page container scrolls vertically instead of clipping.
3. **Make each day's event list scrollable.** Give the day cell a proper flex column (`flex flex-col min-h-0`) and the events list `flex-1 min-h-0 overflow-y-auto`, replacing the `max-h-[calc(100%-32px)]` approach so the scrollbar actually engages on busy days.
4. **Keep print output unchanged.** Print uses the iframe path and the `@media print` rules; the new scroll containers must stay `overflow: visible` in print so the PDF still shows the full month on one landscape page.

## Verification

- September and October 2026 for this account: all weeks visible, including the last row.
- Sep 15, 2026 (3+ Bid Due events): the day box scrolls through every event.
- 6-week month: page remains usable; no row is clipped without a scroll path.
- Print preview still produces the full single-page landscape month.
- Smaller viewport (laptop 1002x682 as in the screenshots) and mobile width.

## Technical notes

Files touched: `src/pages/CalendarDashboard.tsx` (page height container), `src/components/CalendarGrid.tsx` (week row min-height, day cell flex column, scrollable event list), `src/index.css` (print overrides for the new scroll containers only). No data, query, or backend changes.

A written bug report will also be saved to `docs/bug-reports/2026-09-15-calendar-month-clipping-and-day-scroll.md` following the BidBox bug report template.
