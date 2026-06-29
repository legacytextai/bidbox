## Scope
Single file: `src/pages/Projects.tsx`. Restyle the project cards on `My Projects` to match the Opportunities card pattern.

## Changes

1. **Remove**
   - "Responses: N" line and the `submission_count` enrichment block.

2. **Keep (unchanged)**
   - Project name (top-left).
   - Status pill top-right (LIVE / CLOSED) via `getProjectDisplayStatus`.
   - "Ready to Submit" / "Not Ready to Submit" pill under the title.
   - Card click → navigate to `/projects/:id`.

3. **Bid Date + countdown pill** (new, mirrors Opportunities)
   - Format: `Bid Due: MM/dd/yyyy at h:mm a zzz` (date **and** time — unlike Opportunities which is date-only).
   - Inline to the right of the date: small rounded-full pill (`text-[10px] font-semibold px-2 py-0.5`) with calendar-day countdown.
   - Pill text rules (same as Opportunities):
     - `< 0` → `Closed`, muted
     - `0` → `Today`, red
     - `1` → `Tomorrow`, red
     - `2–3` → `N days`, red (`bg-red-50 text-red-600`)
     - `4–7` → `N days`, amber (`bg-amber-50 text-amber-500`)
     - `8+` → `N days`, green (`bg-green-50 text-green-600`)
   - Reuse the calendar-day logic from `Opportunities.tsx` (`formatInProjectTimezone` → ymd → `Date.UTC` diff). Inline two small helpers (`formatBidDateTime`, `daysUntilBidDue`) at the top of `Projects.tsx`, project timezone-aware via `project.timezone || 'America/Los_Angeles'`.

4. **Copy Link CTA**
   - Move to the bottom of the card (after Bid Due row).
   - Anchor it so it lines up across cards: wrap upper content in a `flex flex-col` with the title/pills/value in a `flex-1` container, then the Bid Due row, then the button.
   - Relabel: `Copy Bid Room Link` (icon unchanged).
   - Keep `stopPropagation` so clicking the button doesn't navigate.

## Out of scope
- No changes to `Opportunities.tsx`, the data layer, or `loadProjects` query shape (just drop the submission-count enrichment call).
- No changes to the "New Project" tile.
- No business logic changes.