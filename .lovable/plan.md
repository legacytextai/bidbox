
## Opportunities card cleanup

Single file change: `src/pages/Opportunities.tsx` (card renderer only, ~lines 600–820).

### Remove
1. **"System: yellow/green/red" pill** (lines 634–653) — gone.
2. **"Filtered" pill** (lines 654–669) — gone (same yellow-style noise under title).
3. **Analysis status pill** ("Generating report", "Ready", "Failed") (lines 670–692) — gone.
4. **Document acquisition pill** ("Documents acquired", "Acquiring documents", etc.) (lines 693–717) — gone.
5. **Document processing pill** ("Documents processed", "Documents partially processed", etc.) (lines 718–744) — gone.
6. **"Add review notes…" input** (lines 761–772) — gone.

Keep in the badge row: portal pill (Caltrans/PlanetBids/etc.) and "Converted" pill only. If the badge row ends up empty, the row collapses (no whitespace gap).

Related cleanup (no behavior change elsewhere): drop now-unused imports/constants tied only to the removed pills (`ANALYSIS_STYLES`, `ANALYSIS_LABELS`, `DOCUMENT_ACQUISITION_STYLES/LABELS`, `DOCUMENT_PROCESSING_STYLES/LABELS`, `AUTO_STATUS_DOT`, `RotateCcw`/`Loader2`/`Clock` icons if unused, `Tooltip*` if unused, `classifyOpportunityTitle` + `titleFilterLabel` if only used by the removed Filtered pill, `notes` state + `handleNotesSave` + `setNotes` initialization). Polling/realtime logic stays untouched.

### Emphasize agency
In the meta block (lines 748–758), promote agency from small muted text to a prominent line directly under the title:

- Move `{candidate.agency}` out of the muted meta block into its own line right under the `<h3>` title.
- Style: `text-sm font-semibold uppercase tracking-wide text-foreground` (or `text-[hsl(var(--bidbox-blue))]` for color pop — pick foreground bold for now, matches existing design tokens).
- Bid Due / Estimated Value / Source stay in the muted meta block below.

### Orange "View Intelligence Report" CTA
For analyzed candidates (lines 775–783), swap the blue classes for an orange tone using existing Tailwind utilities (no new tokens needed):

```
className="w-full bg-orange-500 text-white hover:bg-orange-600"
```

All other action buttons (Analyze Project, View Analysis Progress, View Project) stay as-is.

### Out of scope
No data layer, realtime, polling, filters, or backend changes. Pure presentational edit to the card.
