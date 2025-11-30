# Bug Report: Duplicate Text in HeroMvp Component

## Summary
The phrase "Send one link and watch the quotes roll in." appears three times in the hero section instead of once.

## Environment
- **Route**: `/` (Landing page)
- **Component**: `src/components/HeroMvp.tsx`
- **Line**: 37

## Steps to Reproduce
1. Navigate to the homepage (`/`)
2. View the hero section subtitle text

## Expected Behavior
The subtitle should display:
> "Save hours on bid day. **Send one link and watch the quotes roll in.**"

With only the bold portion appearing once.

## Actual Behavior
The text displays:
> "Save hours on bid day. Send one link and watch the quotes roll in. Send one link and watch the quotes roll in.Send one link and watch the quotes roll in."

The phrase repeats 3 times (2 plain + 1 bold).

## Root Cause
Line 37 in `HeroMvp.tsx` contains duplicate text:
```tsx
<p className="text-xl leading-relaxed text-foreground">Save hours on bid day. Send one link and watch the quotes roll in. Send one link and watch the quotes roll in.<span className="font-semibold">Send one link and watch the quotes roll in.</span></p>
```

## Fix
Remove the duplicate plain text, keeping only:
```tsx
<p className="text-xl leading-relaxed text-foreground">Save hours on bid day. <span className="font-semibold">Send one link and watch the quotes roll in.</span></p>
```

## Status
- [x] Bug identified
- [x] Fix applied
