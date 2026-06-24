## Fix Today Bucket Visibility on Opportunities Page

### Problem
1. The `getBucket()` function treats any bid whose time has already passed today as "overdue" instead of "today". A bid due at 9 AM today shows in Overdue when it is now 3 PM.
2. Empty buckets are skipped entirely (`if (items.length === 0) return null`), so users never see a "Due Today" section when there are no bids due today — making it unclear whether the section is missing due to a bug or simply empty.

### Changes

**File:** `src/pages/Opportunities.tsx`

#### 1. Update `getBucket()` logic
- Define "overdue" as strictly **before today's calendar date** in PT (yesterday or earlier).
- Define "today" as any bid whose **calendar date equals today** in PT, regardless of whether the clock time has passed.
- All downstream week/month buckets remain unchanged.

#### 2. Always render "Due Today" and "This Week" buckets
- Remove the `items.length === 0` early-return for the `today` and `this_week` buckets.
- Show a count badge with `(0)` when empty.
- Render a small placeholder line (e.g., "—") inside the collapsible content when the bucket is empty, so the user can confirm at a glance there is nothing due.
- Other buckets (`overdue`, `next_week`, `later_this_month`, `next_month`, `future`, `no_date`) continue to be hidden when empty to avoid clutter.

### Technical Details
- Uses existing `toZonedTime` and `PT_TZ = "America/Los_Angeles"` utilities.
- No new dependencies or UI components.
- Minimal surface area: ~15 lines changed in `getBucket()` and the render loop.

### Out of Scope
- No changes to filters, sorting, or card rendering.
- No changes to bucket labels or collapsible open/close defaults.