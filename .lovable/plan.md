## Problem

Saving the Bid Profile runs two sequential operations:
1. Upsert the profile row (fast)
2. Invoke `qualify-candidates` edge function to re-evaluate every opportunity against the new profile (can take several seconds)

Today the button just shows a static, greyed-out "Saving…" the whole time, so the user has no idea why it's slow or whether anything is happening.

## Proposed Solution

Replace the single-state button with a **two-phase progress indicator** that tells the user exactly what stage they're in.

### Phase 1 — Button states
Track a `saveStage` state with values: `idle | saving | requalifying | done`.

- `idle` → "Save Profile"
- `saving` → spinner + "Saving profile…"
- `requalifying` → spinner + "Re-evaluating opportunities…"
- `done` → checkmark + "Saved" (auto-revert to `idle` after ~1.5s)

Use a `Loader2` icon from `lucide-react` with `animate-spin` for live motion (replaces the static greyed-out feel), and `Check` for the done state.

### Phase 2 — Inline status line below button
While `requalifying`, show a small helper line under the button:

> "Re-checking your opportunities against the new profile. This usually takes a few seconds…"

Plus an indeterminate progress bar (`<Progress />` with no value, or a thin animated bar) so the user sees continuous motion rather than a frozen UI.

### Phase 3 — Result toast (unchanged)
Keep the existing toast that reports how many opportunities were re-evaluated.

## Technical Details

Single-file change: `src/pages/QualificationProfile.tsx`

1. Replace `const [saving, setSaving] = useState(false)` with `const [saveStage, setSaveStage] = useState<"idle" | "saving" | "requalifying" | "done">("idle")`.
2. In `handleSave`:
   - `setSaveStage("saving")` before the upsert
   - `setSaveStage("requalifying")` before `supabase.functions.invoke("qualify-candidates", …)`
   - `setSaveStage("done")` on success, then `setTimeout(() => setSaveStage("idle"), 1500)`
   - On any error, `setSaveStage("idle")` immediately
3. Update the Button JSX to render icon + label per stage, keep `disabled={saveStage !== "idle"}`.
4. Conditionally render a helper paragraph + indeterminate `Progress` component beneath the button when `saveStage === "requalifying"`.

No backend, edge-function, or business-logic changes. Purely a UX/presentation improvement on the existing save flow.
