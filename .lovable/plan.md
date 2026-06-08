# Opportunity Card Tweaks

Scope: `src/pages/Opportunities.tsx` only. No DB/status-value changes.

## 1. Relabel status buttons
In the status selector row, map internal status values to friendly labels:
- `red` → "No"
- `yellow` → "Maybe"
- `green` → "Yes"

Keep underlying status values (`red`/`yellow`/`green`) unchanged so filters, `STATUS_STYLES`, auto_status, and DB stay intact. Only the rendered button text changes.

## 2. Always-enabled Convert button
Update the Convert to Project button so it's clickable regardless of manual status:
- Remove the `(status !== "green" && status !== "yellow")` part of `disabled`. Keep `convertingId === candidate.id` to prevent double-clicks.
- Remove the gating `title` tooltip.
- Still hide/replace with "View Project" when `status === "converted"` (unchanged).

`handleConvert` logic is unchanged — it already works for any status.

No other files touched.