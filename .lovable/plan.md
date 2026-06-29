## Goal
Add subtle, sleek previous/next navigation arrows on the OpportunityReport page (`/opportunities/:id`) so the user can flip between analyzed opportunities in chronological order (by bid due date) without going back to the list.

## Confirmed understanding
- Left arrow → previous opportunity (earlier bid due date)
- Right arrow → next opportunity (later bid due date)
- Visual style: very subtle, sleek, **not** chunky buttons. No filled background, no border-box. Just a faint chevron icon with low-opacity muted color, gentle hover (slight opacity boost + small translate-x nudge), and a circular focus ring for accessibility.
- Placement: directly under the "Back to Opportunities" button, above the H1 title. Arrows sit at the **far left and far right edges** of the page content column, so they frame the title without crowding it.

## Scope
Frontend-only edit to `src/pages/OpportunityReport.tsx`. No schema, no API, no business logic changes.

## Implementation

### 1. Build the sibling list
Inside `OpportunityReport`, add a `useEffect` that fetches a lightweight ordered list of analyzed candidate IDs the same way `Opportunities.tsx` does:

```ts
const [siblingIds, setSiblingIds] = useState<string[]>([]);

useEffect(() => {
  supabase
    .from("opportunity_candidates")
    .select("id, bid_due_at")
    .eq("analysis_status", "ready")          // only analyzed/ready ones
    .order("bid_due_at", { ascending: true, nullsFirst: false })
    .then(({ data }) => setSiblingIds((data ?? []).map(r => r.id)));
}, []);
```

Compute prev/next:
```ts
const idx = siblingIds.indexOf(id!);
const prevId = idx > 0 ? siblingIds[idx - 1] : null;
const nextId = idx >= 0 && idx < siblingIds.length - 1 ? siblingIds[idx + 1] : null;
```

(If the current candidate isn't in the list yet — e.g. still loading — both arrows render disabled.)

### 2. Render the sleek arrows
Between the `Back to Opportunities` button (line 535–537) and the title row (line 539), insert a flex row that spans the content width:

```tsx
<div className="flex items-center justify-between mb-3">
  <button
    onClick={() => prevId && navigate(`/opportunities/${prevId}`)}
    disabled={!prevId}
    aria-label="Previous opportunity"
    className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground/60
               hover:text-foreground transition-all disabled:opacity-20
               disabled:cursor-not-allowed"
  >
    <ChevronLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
    <span className="opacity-0 group-hover:opacity-100 transition-opacity">Previous</span>
  </button>

  <button
    onClick={() => nextId && navigate(`/opportunities/${nextId}`)}
    disabled={!nextId}
    aria-label="Next opportunity"
    className="group inline-flex items-center gap-1.5 text-xs text-muted-foreground/60
               hover:text-foreground transition-all disabled:opacity-20
               disabled:cursor-not-allowed"
  >
    <span className="opacity-0 group-hover:opacity-100 transition-opacity">Next</span>
    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
  </button>
</div>
```

Design notes:
- No border, no background — just chevron + hidden label that fades in on hover.
- Default state is whisper-quiet (`text-muted-foreground/60`), darkens to `text-foreground` on hover.
- Chevron nudges 2px outward on hover for tactile feel.
- Disabled state drops to 20% opacity (still visible so user knows it's the boundary).

### 3. Imports
Add `ChevronLeft, ChevronRight` to the existing `lucide-react` import block.

## Out of scope
- No keyboard shortcuts (← / →) — can add later if desired.
- No prefetching of neighboring reports.
- No change to the "Back to Opportunities" button itself.

## Testing
1. Open any analyzed opportunity. Arrows render under the back button, at far left/right.
2. Click right chevron — navigates to the next opportunity in bid-due order; URL updates; report reloads.
3. Click left chevron — navigates to previous.
4. On the earliest/latest opportunity, the respective arrow shows disabled at 20% opacity.
5. Hover reveals the "Previous"/"Next" label and the chevron nudges outward.