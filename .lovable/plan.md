## Preview all 4 agency-separation options live

Apply each of the 4 proposed agency-separation treatments to the first 4 opportunity cards on `/opportunities`, in order, so you can compare them side-by-side in the real UI. After you pick one, I'll remove the per-card variants and apply the winner universally to all cards.

### Implementation

In `src/pages/Opportunities.tsx`, inside the card `.map()` render, use the card's index to switch the agency styling:

- **Card 1 (index 0) — Option A: Left Accent Bar**
  Agency line gets a 3px `bg-[hsl(var(--bidbox-blue))]` left border with `pl-2`, normal-case text, `text-sm font-medium text-foreground`.

- **Card 2 (index 1) — Option B: Subtle Background Pill**
  Agency rendered as an inline-block `bg-muted` rounded pill with `px-2 py-0.5 text-xs font-medium text-foreground`, normal case.

- **Card 3 (index 2) — Option C: Thin Horizontal Rule**
  A `border-t border-border` divider between title and agency, with `pt-2 mt-2`. Agency in `text-sm text-muted-foreground`, normal case, no uppercase.

- **Card 4 (index 3) — Option D: Icon Prefix + Spacing**
  `Building2` lucide icon (14px, muted) prefixed before the agency name, with `mt-2 flex items-center gap-1.5`, `text-sm font-medium text-foreground`, normal case.

- **Cards 5+** keep the current uppercase-bold treatment as a neutral baseline so the 4 options stand out.

### Scope

- Pure presentational change to `src/pages/Opportunities.tsx`.
- No data, schema, or logic changes.
- Temporary — once you pick a winner, I'll strip the index-based switch and apply the chosen style to every card.

### Step 2 (after your selection)

Replace the per-index variants with the chosen treatment applied uniformly to all opportunity cards.