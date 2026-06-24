## Goal

Replace the Sort dropdown on `/opportunities` with **filter** controls. Time buckets remain; cards inside each bucket sort by Bid Due ascending (soonest first) — which is the natural reading order for a deadline-driven view.

All changes are presentation-only in `src/pages/Opportunities.tsx`.

---

## Filter controls (top of cards, where Sort lived)

Two multi-select filter dropdowns + a clear button, on the right side of the filter-tabs row:

1. **County** — multi-select. Options are the distinct, non-empty `crawl_data.county` values present in the loaded candidates, sorted A–Z. Cards with no county are matched by an explicit "(No county)" option at the bottom of the list.
2. **Agency** — multi-select. Options are the distinct, non-empty `agency` values present in the loaded candidates, sorted A–Z. Cards with no agency match a "(No agency)" option.

Behavior:
- If a filter has no selections, it is inactive (everything passes).
- Filters combine with AND across the two facets; within a facet, selected values combine with OR.
- The trigger button shows: facet name, plus a count badge when any value is selected (e.g. "County · 2").
- A small "Clear filters" link appears next to the dropdowns when any filter is active.
- Filters apply to both the bucketed cards and the "Filtered Out" section.

Implementation uses shadcn `Popover` + `Command` (same pattern as `CountySelect`) with checkbox items, so multi-select fits cleanly. No new dependencies.

## Sort

- Remove the Sort `<Select>` and the `sortBy` state / `SORT_OPTIONS` / `compareCandidates` plumbing.
- Inside each bucket, cards sort by `bid_due_at` ascending; nulls last; `created_at` DESC as tiebreaker.

## Time buckets

Unchanged — same 8 buckets, same collapsible behavior, same default open/closed state.

---

## Technical details

File: `src/pages/Opportunities.tsx` only.

1. Replace `sortBy` state with:
   ```ts
   const [countyFilter, setCountyFilter] = useState<string[]>([]);
   const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
   ```
2. Derive options from `candidates` via `useMemo`:
   - `countyOptions`: distinct trimmed `crawl_data?.county` values, sorted; flag for whether any candidate has none.
   - `agencyOptions`: same shape for `agency`.
3. Apply filters when computing `filtered` (the existing tab-filtered list) — chain a county+agency predicate after the analyzed-tab check. Use the sentinel string `"__none__"` to mean "(No county)" / "(No agency)".
4. Replace `compareCandidates(sortBy)` calls with a fixed comparator: bid-due-asc, nulls-last, created_at DESC tiebreaker.
5. Build a small inline `FacetMultiSelect` component (or two parallel JSX blocks) using `Popover` + `Command` + `CommandInput` + `CommandItem` with a check icon.
6. Render "Clear filters" as a `Button variant="ghost" size="sm"` that only mounts when either array is non-empty.
7. Delete the now-unused `SortKey`, `SORT_OPTIONS`, `compareCandidates`, and the `Select`/`SelectContent`/`SelectItem`/`SelectTrigger`/`SelectValue` imports if nothing else uses them.

## Out of scope

- No persistence of filter selections across reloads.
- No filter on portal type, analysis status, or other facets — the user asked for county and agency.
- No change to bucket boundaries or the time-zone math.
