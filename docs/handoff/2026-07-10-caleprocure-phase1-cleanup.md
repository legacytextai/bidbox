# Cal eProcure Phase 1 Cleanup Notes

## Implemented in this pass

- Parser support for Cal eProcure `Event End Date` strings where PeopleSoft concatenates date and time, such as `07/21/20265:00PM PDT`.
- A guarded migration/backfill scoped to Cal eProcure source `75d7fa42-2302-4fce-ba0f-ba33ef6e9a82`.
- Existing Cal eProcure candidates with exact Caltrans `portal_bid_id` matches are marked `auto_status = red` and annotated with `duplicate_of_caltrans` metadata.
- Existing Cal eProcure rows matching the current non-public-works hygiene patterns are marked `auto_status = red`.
- Existing Cal eProcure rows with `portal_type IS NULL` are backfilled to `portal_type = 'caleprocure'`.

## Deferred: description, estimated value, and duration

Production evidence for Event `0000039627` shows the source page contains:

- estimated construction cost: approximately `$7,800,000.00`
- estimated contract duration: `440 days`

The current row has `crawl_data.description = null`, so estimated value and duration extraction should wait for a driver enhancement that first captures the Cal eProcure event description body reliably. Once description capture is in place, estimate/duration extraction can be added against that text and mapped into the existing normalized/value metadata surfaces.

## Deferred: placeholder `[Event Title]`

Production sampling found 17 rows with `[Event Title]`. The correct title is not present elsewhere in those stored rows, so this pass does not invent titles.

Recommended driver fix:

- wait for the detail event-name selector to resolve to a non-placeholder value;
- treat `[Event Title]` as invalid detail text;
- fall back to the listing row title when the detail title is placeholder or times out;
- only persist the Event ID as a last resort.

The cleanup migration marks placeholder title rows red/incomplete so they leave the main feed until a future refresh can repair them.
