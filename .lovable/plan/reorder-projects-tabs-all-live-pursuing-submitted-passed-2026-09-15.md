# Reorder /projects tabs: All - Live - Pursuing - Submitted - Passed

## Goal
Move the "Pursuing" tab from its current position (left of Live) to sit between "Live" and "Submitted", so the tab order reads:

```
All | Live | Pursuing | Submitted | Passed
```

## Change
Single edit in `src/pages/Projects.tsx`:

- Reorder the `TABS` array (lines 39–45) so entries appear in this order:
  1. `all` — All
  2. `live` — Live
  3. `pursuing` — Pursuing (status: "pursuing")
  4. `submitted` — Submitted
  5. `passed` — Passed

No other changes needed:
- Tab rendering iterates `TABS` in order, so the UI order follows automatically.
- Default active tab is `all` and tab keys don't change, so no state or filter logic is affected.
- Colors and filtering behavior are untouched.

## Verification
- Typecheck (`tsgo`) passes.
- Open /projects in the preview and confirm the tab order reads All - Live - Pursuing - Submitted - Passed, with Pursuing still filtering correctly and keeping its green styling.
