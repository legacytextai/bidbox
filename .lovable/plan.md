## Scope
Update the opportunity card in `src/pages/Opportunities.tsx` only.

## Changes

1. **Remove time from Bid Due**
   - Card-level bid-due line shows date only (e.g. `06/11/2026`).
   - Keep full datetime formatting everywhere else (detail page, reports, etc.).

2. **Make Bid Due date black**
   - Change from `text-muted-foreground` to `text-foreground`.

3. **Add centered days-remaining countdown**
   - Positioned directly below the Bid Due date, centered in the card.
   - Font size: `text-lg` (smaller than the `text-2xl` estimate, larger than body text).
   - Reads as a whole number: e.g. `8 days`.
   - If the bid is past due, show `Closed` in muted gray.

4. **Color thresholds**
   - `0–3 days` → red (`text-red-600`)
   - `4–7 days` → amber (`text-amber-500`)
   - `8+ days` → green (`text-green-600`)

## Files
- `src/pages/Opportunities.tsx` — card rendering and a new helper to compute days until bid due.

## Out of scope
- No backend or database changes.
- No changes to other pages, tabs, or the Project Workspace.
