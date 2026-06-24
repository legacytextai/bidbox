I'm using knowledge.

## Goal

On `/opportunities`, add (1) a simple sort control above the cards and (2) collapsible time-bucket sections that group cards by when the bid is due.

All changes are presentation-only inside `src/pages/Opportunities.tsx`. No DB, RLS, or edge-function work.

---

## 1. Sort control

A single dropdown (shadcn `Select`) placed on the right side of the existing filter-tabs row.

Options:
- **Bid Due — Soonest first** (default)
- **Bid Due — Latest first**
- **Newest added** (created_at DESC)
- **Oldest added** (created_at ASC)
- **County (A–Z)**
- **Agency (A–Z)**

Notes:
- Candidates with no `bid_due_at` are pushed to the end on Bid-Due sorts.
- "County" is read from `crawl_data?.county` (One Link metadata). When missing, the card sorts to the end of the County sort. Today's `Candidate` interface has no top-level county field, so we read it from `crawl_data` only — no schema change.
- Sort applies to every bucket independently and to the Filtered Out section.

## 2. Time-bucket dividers

Replace the single grid with collapsible sections in this fixed order. Buckets are computed from `bid_due_at` evaluated in America/Los_Angeles (matches `formatBidDate`/`isBidClosed` already used in this file).

1. **Overdue** — bid_due_at is in the past but not yet closed-out / still in list. Collapsed by default.
2. **Due Today** — due before end of today (PT). Expanded.
3. **This Week** — due after today and on/before end of Sunday (PT). Expanded.
4. **Next Week** — due in the following Mon–Sun window. Expanded.
5. **Later This Month** — due after Next Week's Sunday but on/before the last day of the current month. Collapsed.
6. **Next Month** — due within the following calendar month. Collapsed.
7. **Future** — anything beyond Next Month. Collapsed.
8. **No Bid Date** — `bid_due_at` is null. Collapsed.

Week boundary = Sunday 23:59:59 PT (matches public-works convention of Mon–Fri bid days clustering within a week).

Each section renders:
- A header row with chevron, title, count badge, and a thin `<Separator />` line beneath.
- Click anywhere on the header to collapse/expand (using existing `Collapsible` primitive).
- Empty buckets are hidden entirely.
- The "Filtered Out" collapsible at the bottom remains unchanged, but its cards are also bucketed by the same rules inside it (single flat grid, like today — to keep scope tight).

Tabs (`All` / `Analyzed`) still gate which candidates are eligible; bucketing and sorting happen after that filter.

---

## Technical details

File: `src/pages/Opportunities.tsx` only.

1. Add `sortBy` state (`useState<SortKey>("due_asc")`).
2. Add a `getBucket(bid_due_at: string | null): BucketKey` helper using `date-fns-tz` (`toZonedTime` for PT) — already a project dependency.
3. Replace the current `visibleCards`/`filteredOutCards` `useMemo` with one that returns:
   ```ts
   { buckets: Record<BucketKey, Candidate[]>, filteredOutCards: Candidate[] }
   ```
   Apply `sortBy` comparator inside each bucket.
4. Add a `<Select>` next to the filter tabs (same row, `justify-between` on the flex wrapper).
5. Render buckets in fixed order via a `BUCKETS` array of `{ key, label, defaultOpen }`. Each section uses `Collapsible` + `Separator` + count badge. Persist open/closed state in a `Record<BucketKey, boolean>` in component state (not localStorage — scope tight).
6. Reuse the existing `renderCard` function untouched.
7. Empty state (no candidates at all) keeps current behavior.

ASCII of the new layout:

```text
[ All (12) ] [ Analyzed (4) ]            Sort: [ Bid Due — Soonest ▾ ]
────────────────────────────────────────────────────────────────────
▾ Due Today (2)
   ┌────────┐ ┌────────┐
   │ card   │ │ card   │
   └────────┘ └────────┘
▾ This Week (3)
   ...
▸ Next Week (1)
▸ Later This Month (4)
▸ Next Month (0)   ← hidden
▸ Future (2)
▸ No Bid Date (1)

▸ Filtered Out (5)
```

## Out of scope

- No new DB columns, migrations, or edge-function changes.
- No persistence of sort/expand prefs across reloads.
- County sort uses whatever `crawl_data.county` exists; we won't backfill missing counties.
- The "Filtered Out" cards stay in a single grid (not bucketed) to limit visual complexity.
