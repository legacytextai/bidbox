# Bug Report: RECURRING Duplicate Text in HeroMvp Component

## ⚠️ RECURRING ISSUE ALERT
This bug has occurred **3+ times** in this codebase. Pay special attention to the prevention notes.

## Summary
The phrase "Send one link and watch the quotes roll in." appears multiple times in the hero section subtitle instead of once (bold only).

## Environment
- **Route**: `/` (Landing page)
- **Component**: `src/components/HeroMvp.tsx`
- **Lines**: 37-38

## Steps to Reproduce
1. Navigate to the homepage (`/`)
2. View the hero section subtitle text below the main headline

## Expected Behavior
The subtitle should display:
> "Save hours on bid day. **Send one link and watch the quotes roll in.**"

Only the **bold** portion should exist - no plain text version.

## Actual Behavior (When Bug Occurs)
```tsx
<p className="text-xl leading-relaxed text-foreground">Save hours on bid day.
Send one link and watch the quotes roll in.<span className="font-semibold">Send one link and watch the quotes roll in.</span></p>
```

The phrase appears twice:
1. Plain text before the span
2. Bold inside the `<span>`

## Root Cause
When editing or regenerating this section, the bold `<span>` content gets **appended** instead of **replacing** the plain text. This creates duplication.

## ✅ CORRECT CODE (Copy exactly)
```tsx
<p className="text-xl leading-relaxed text-foreground">
  Save hours on bid day. <span className="font-semibold">Send one link and watch the quotes roll in.</span>
</p>
```

## ❌ INCORRECT PATTERNS (What to avoid)
```tsx
// WRONG: Plain text + bold span (duplication)
<p>Save hours on bid day. Send one link and watch the quotes roll in.<span className="font-semibold">Send one link and watch the quotes roll in.</span></p>

// WRONG: Missing space before span
<p>Save hours on bid day.<span className="font-semibold">Send one link...</span></p>

// WRONG: Line break causing issues
<p>Save hours on bid day.
Send one link...<span>...</span></p>
```

## 🔒 PREVENTION CHECKLIST
When editing HeroMvp.tsx subtitle:
- [ ] Only ONE instance of "Send one link and watch the quotes roll in." should exist
- [ ] That instance must be inside `<span className="font-semibold">`
- [ ] Add a space between intro text and the span
- [ ] Keep everything on same line or use proper formatting

## Fix History
| Date | Status | Notes |
|------|--------|-------|
| 2025-11-30 | Fixed | First occurrence - removed duplicate |
| 2025-11-30 | Recurred | Bug reappeared after other edits |
| 2025-11-30 | Fixed | Second fix applied |
| 2025-11-30 | Recurred | Bug reappeared AGAIN |
| 2025-11-30 | Fixed | Third fix with recurring bug documentation |

## Status
- [x] Bug identified
- [x] Root cause documented
- [x] Fix applied
- [x] Prevention measures documented
