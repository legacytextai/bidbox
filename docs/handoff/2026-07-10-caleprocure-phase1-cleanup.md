# Cal eProcure Phase 1 Cleanup Notes

## Implemented in this pass

- Parser support for Cal eProcure `Event End Date` strings where PeopleSoft concatenates date and time, such as `07/21/20265:00PM PDT`.
- A guarded migration/backfill scoped to Cal eProcure source `75d7fa42-2302-4fce-ba0f-ba33ef6e9a82`.
- Existing Cal eProcure candidates with exact Caltrans `portal_bid_id` matches are marked `auto_status = red` and annotated with `duplicate_of_caltrans` metadata.
- Existing Cal eProcure rows matching the current non-public-works hygiene patterns are marked `auto_status = red`.
- Existing Cal eProcure rows with `portal_type IS NULL` are backfilled to `portal_type = 'caleprocure'`.

## Follow-up implemented: description, estimated value, and duration

Production evidence for Event `0000039627` shows the source page contains:

- estimated construction cost: approximately `$7,800,000.00`
- estimated contract duration: `440 days`

The follow-up driver work on 2026-07-11 now captures the visible detail description/body text and extracts estimated construction value and contract duration when the source text explicitly states them. `Event End Date` remains the normalized `bid_due_at` source; estimate fields are promoted only when parsed from source evidence, and duration remains in `crawl_data.contract_duration_raw` unless/until a first-class column exists.

## Follow-up implemented: Event Package manifest and document acquisition

Cal eProcure now has an explicit document acquisition path for selected candidates:

- opens the candidate detail page;
- clicks `View Event Package`;
- signs in with `CALEPROCURE_USERNAME`/`CALEPROCURE_PASSWORD` only if Cal eProcure presents a login page;
- captures Comments and Attachments page comments;
- captures attachment manifest rows into `crawl_data.documents[]` with stable `caleprocure://event/{event_id}/attachment/{source_order}/{filename}` keys;
- downloads supported Event Package files on explicit `document_prefetch`/Analyze only;
- stores files in the shared `opportunity-documents` bucket and idempotent `opportunity_documents` rows;
- keeps Cal eProcure excluded from scan-time auto-prefetch.

Controlled production validation of a single candidate plus idempotency rerun is still required before calling the portal complete.

## Deferred: placeholder `[Event Title]`

Production sampling found 17 rows with `[Event Title]`. The correct title is not present elsewhere in those stored rows, so this pass does not invent titles.

Recommended driver fix:

- wait for the detail event-name selector to resolve to a non-placeholder value;
- treat `[Event Title]` as invalid detail text;
- fall back to the listing row title when the detail title is placeholder or times out;
- only persist the Event ID as a last resort.

The later placeholder-title policy reversal keeps these rows visible/yellow unless another valid rejection reason applies. Placeholder title is low-confidence metadata, not automatic suppression.
