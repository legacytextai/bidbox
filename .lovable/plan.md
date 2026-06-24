Change the Bid Due date display on the Opportunities page from the current long-form datetime (e.g., "July 1, 2025 at 2:00 PM PDT") to a compact `MM/DD/YYYY` format.

1. Update the `formatBidDate` helper in `src/pages/Opportunities.tsx` to output `MM/DD/YYYY` using `date-fns` `format` or `Intl.DateTimeFormat`.
2. Scope: opportunities card list only (`/opportunities`). Other pages and detail views remain unchanged.
3. No other UI or logic changes.