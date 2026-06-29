## Goal
Simplify Opportunity cards: one universal "View Project" CTA, subtle "On Calendar" indicator, full-card clickability, and a more prominent Estimated Value above the bid due date.

## Changes (scope: `src/pages/Opportunities.tsx` only)

### 1. Single, unified CTA
Replace the 4 conditional buttons (View Intelligence Report orange, Retry Analysis blue, View Analysis Progress, View Opportunity) with **one** button on every card:

- Label: **View Project**
- Style: faint light-blue — `bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100` (no icon, no orange, no outline variants)
- All cards navigate to `/opportunities/:id` (the report/workspace already handles state — queued, analyzing, ready, failed, converted — so a single destination is safe). Converted candidates still resolve through that route's existing redirect to the linked project.

### 2. "Added to Calendar" indicator (subtle but recognizable)
For candidates where `status === "converted"` and `converted_project_id` is present, add a small inline marker next to the title:

```text
┌ Calendar (lucide) icon, 12px, muted blue (`text-blue-600`)
└ tiny label "On Calendar" — `text-[10px] uppercase tracking-wide font-medium text-blue-600`
```

Placement: directly under the agency line, before the portal pill. No pill background, no border — just icon + tiny label. Keeps cards clean while making converted ones instantly scannable.

### 3. Full-card click
Wrap the card `<div>` with `role="button"`, `tabIndex={0}`, `onClick={() => navigate(\`/opportunities/${candidate.id}\`)}`, plus keyboard handler (Enter/Space). Add `cursor-pointer hover:border-blue-300 hover:shadow-sm transition` to the card classes. The external-link `<a>` already calls `stopPropagation`; the button will also `stopPropagation` (though its action is the same nav, so this just avoids double-navigation).

### 4. Prominent Estimated Value
Restructure the meta block so order under the portal pill is:

```text
PLANETBIDS                          ← existing pill
$9.1M                               ← NEW: text-2xl font-bold text-foreground
Bid Due: 06/24/2026 at 2:00 PM PDT  ← existing, unchanged
Source: Long Beach Unified ...      ← existing, unchanged
```

Only render the large value line when `formatEstimatedValue(candidate.crawl_data)` returns a value. Remove the old "Estimated Value: $X" line from the meta paragraph block.

## Out of scope
- No DB or business-logic changes.
- No changes to `/opportunities/:id` routing target — already exists and handles all lifecycle states.
- No changes to other pages.

## Verification
- TS/build passes.
- Visual check: All cards show identical light-blue "View Project" button; only converted ones display the small "On Calendar" marker; clicking anywhere on the card navigates; cards with estimated value show it large above bid due.
