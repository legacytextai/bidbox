# Bug Report: Header Tagline Visibility Discrepancy

## Issue Summary
The tagline "Bid Better, Win More." appears under the BidBox header logo in the external preview window and published site, but may not be visible in the Lovable editor preview.

## Observed Behavior
- **External Preview / Published Site:** Tagline "Bid Better, Win More." is visible under the header logo
- **Lovable Editor Preview:** May show different/cached content

## Screenshot
![Header with tagline](../user-uploads/Screen_Shot_2025-12-01_at_1.45.46_PM.png)

## Affected File
`src/components/Layout.tsx` - PublicLayout component, lines 158-173

## Code Location
```tsx
<div className="flex flex-col">
  <Link
    to="/"
    className="flex items-center gap-2 text-xl sm:text-2xl font-bold text-foreground hover:text-[hsl(var(--bidbox-blue))] transition-colors"
  >
    <img 
      src={bidboxLogoHeader} 
      alt="BidBox Logo" 
      className="h-5 sm:h-6"
    />
    BidBox
  </Link>
  <span className="text-xs text-muted-foreground ml-7 sm:ml-8">
    Bid Better, Win More.
  </span>
</div>
```

## Root Cause
The tagline was intentionally added per user request. If this is unwanted, the `<span>` element with the tagline should be removed.

## Resolution Options
1. **Keep tagline:** No action needed - this is the intended behavior
2. **Remove tagline:** Delete lines 170-172 in Layout.tsx to remove the tagline span

## Status
Pending user clarification - was the tagline intentional or should it be removed?
