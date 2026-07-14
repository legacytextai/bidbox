# UI Guardrail — Opportunities Cards (PROTECTED)

**Status:** Locked. Do not modify without explicit product authorization referencing this file.

## Scope

The opportunity/project card rendered by `src/pages/Opportunities.tsx` (the JSX
returned by the card renderer around the `<Card>` block that includes the
title, portal pill, estimated value, bid due row, and action button) is a
protected UI surface.

## What agents must NOT change without explicit approval

Do not add, remove, reorder, restyle, or otherwise modify anything inside the
opportunity card, including:

- Badges, chips, labels, or status pills (e.g. "Not yet evaluated",
  "County not verified", "Scope not yet available", "Value not determinable",
  or any similar diagnostic/quality-flag label). These are **explicitly
  prohibited** on the card.
- Text, copy, icons, or tooltips
- Buttons, hover states, click targets
- Spacing, colors, typography, borders, shadows
- Card layout, order of elements, or metadata surfaces
- The portal pill styling and placement
- The estimated value / bid due layout

## What triggers an allowed change

Only a direct, explicit user instruction that names the specific card element
to change. Vague requests ("clean up the cards", "add more info",
"show why it was filtered") are NOT sufficient. Ask before touching the card.

## Allowed adjacent work

- Filtering logic that determines *which* cards render
- Data loading, error, and retry surfaces *outside* the card
- Page header, tabs, sort, and scan controls
- The "Filtered out" callout is a page-level surface (currently below the
  card body) and is governed separately; treat it as protected too.

## History

- 2026-07-13: Unauthorized diagnostic badges ("Not yet evaluated",
  "County not verified", qualification `reasons`) were added to the card
  during a qualification-jobs change. Removed on user directive; guardrail
  established.
