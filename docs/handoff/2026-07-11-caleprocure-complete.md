# Cal eProcure Full Driver Handoff

## Status

Implementation is in place for rich Cal eProcure metadata extraction, Event Package manifest capture, explicit document acquisition, and F2-lite/F2-full routing.

Do not call Cal eProcure complete until one controlled production `document_prefetch` and one idempotency rerun validate the browser download flow against a single candidate.

## Implemented

- Rich Event Details extraction now captures description body text, contact fields, pre-bid details, service areas/counties, license rows, UNSPSC rows, estimated construction value, and contract duration when the source text states them.
- `Event End Date` remains mapped to `bid_due_at`.
- Event Package extraction captures comments and attachment rows from `/pages/Events-BS3/event-bid-comments.aspx`.
- Attachment manifests are persisted to `crawl_data.documents[]` with stable Cal eProcure source keys:

```text
caleprocure://event/{event_id}/attachment/{source_order}/{normalized_filename}
```

- Cal eProcure document acquisition is routed through `document_prefetch` and project analysis only. Scan-time auto-prefetch remains disabled.
- F2-lite `download-opportunity-document` supports Cal eProcure candidates when a manifest row has a stable `source_key`.
- F2-full project analysis can acquire all supported Event Package documents before continuing to document processing/intelligence.

## Credential Handling

The worker signs in only when Cal eProcure presents a login page. Supported env vars:

```text
CALEPROCURE_USERNAME
CALEPROCURE_PASSWORD
```

Fallback username aliases are supported for deployment compatibility:

```text
CALEPROCURE_USER
CALEPROCURE_EMAIL
```

Credentials are never logged. Missing credentials fail with `missing_caleprocure_credentials`.

## Document Classes

Simple filename/description classification is used:

- Invitation for Bid / bid package: `source_document`
- Plans: `plans`
- Specifications: `specifications`
- Addendum N: `addendum`
- Public Works Rate Sheet: `wage_rates`

Supported extensions:

```text
pdf, xlsx, xls, doc, docx, csv, txt, zip
```

Zip files reuse the existing archive extraction path.

## Validation Needed

Use one controlled candidate, preferably Event ID `0000039265` from the user-provided Comments and Attachments evidence.

1. Confirm queue pending/running is zero.
2. Enqueue one `document_prefetch` for that candidate only.
3. Verify:
   - comments captured;
   - 7 attachment manifest rows discovered;
   - supported files acquired/uploaded;
   - `opportunity_documents` rows created with stable `source_url` keys;
   - no downstream `document_processing`, `project_analysis`, or `project_intelligence` from F2-lite;
   - queue returns clean.
4. Rerun the same single-candidate `document_prefetch`.
5. Verify existing documents are skipped, no duplicates are inserted, and no files are reuploaded.

## Guardrails

- No broad Cal eProcure scans.
- No broad document acquisition.
- No scan-time auto-prefetch.
- No Railway scaling changes.
- No unrelated portal changes.
- No manual production DB mutation outside approved controlled validation.
