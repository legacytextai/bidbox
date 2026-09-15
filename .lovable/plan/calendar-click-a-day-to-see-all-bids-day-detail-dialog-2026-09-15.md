# Calendar: Click a Day to See All Bids (Day Detail Dialog)

## Goal
Clicking any day cell on the Calendar opens a dialog listing every event that day (Bid Due and Job Walk entries), so busy days are fully visible without scrolling inside the tiny day box.

## Changes

### 1. `src/components/CalendarGrid.tsx`
- Add state: `selectedDay: Date | null`.
- Make each day cell clickable (on the cell container, with `cursor-pointer` and a subtle `hover:bg-muted/50` affordance; only for days in the current month).
- Keep event buttons working: clicking an event still navigates to `/projects/:id` — stop click propagation so it does not also open the dialog.
- Keep the existing per-day scrollable event list (recently fixed) unchanged as the inline view.

### 2. New `src/components/calendar/DayDetailDialog.tsx`
- shadcn `Dialog` showing `format(day, "EEEE, MMMM d, yyyy")` as the title.
- Lists all events for the day, sorted by time, each row showing:
  - Type badge (Bid Due / Job Walk) with the same color coding as the calendar (pursuing = green, submitted = blue, reviewing/job walk = gray).
  - Project name, agency, formatted date/time, and Ready / Not Ready badge for bid-due events.
- Each row is a button that navigates to `/projects/:id` and closes the dialog.
- Empty state (shouldn't normally trigger since the dialog opens from any day): "No bids or job walks scheduled for this day."
- Dialog is `print:hidden` so it never affects the print/PDF output.

### 3. Wiring
- `CalendarGrid` renders `<DayDetailDialog day={selectedDay} events={...} onClose={() => setSelectedDay(null)} />`, passing events via the existing `eventsForDay` helper.

## Technical notes
- No data/backend changes — reuses the already-fetched `projects` prop and `eventsForDay` mapping.
- Reuses `formatProjectDateTime` for timezone-correct times (per date-fns-tz convention).
- Print behavior (iframe landscape PDF) untouched.
- Mobile: dialog is full-width friendly; day cells keep 44px+ tap targets via padding.

## Verification
- Click a busy day (e.g. one with 4+ events) → dialog lists all of them; clicking an entry opens the project.
- Click an event chip directly → still navigates without opening the dialog.
- Print output unchanged.
