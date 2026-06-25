# C1A - Refresh Existing Opportunities

**Status:** Backlog  
**Phase:** C1A Opportunity Discovery Reliability  
**Created:** June 2026

## Executive Summary

BidBox discovery currently behaves as insert-only for known opportunities. When a scanner finds a duplicate `source_url`, the worker logs `Already known` and skips the row. That is safe for avoiding duplicate cards, but it prevents parser improvements and updated portal metadata from reaching existing `opportunity_candidates`.

C1A should make discovery refresh existing opportunities by updating only portal-owned metadata while preserving user-owned workflow state.

## Current Behavior

```text
Scan source
-> parse opportunity
-> INSERT opportunity_candidates
-> duplicate source_url?
-> log Already known
-> skip
```

This affects PlanetBids, Caltrans, and future drivers. A newly improved parser may populate richer `crawl_data`, but existing rows do not receive that improvement unless they are manually backfilled or rediscovered under a new URL.

## Desired Behavior

```text
Scan source
-> parse opportunity
-> upsert/refresh by source_url
-> if new: insert candidate
-> if existing: refresh portal-owned metadata only
-> preserve user-owned workflow state
```

## Portal-Owned Fields

These fields may be refreshed by scanners because the source portal owns them:

- `raw_title`
- `agency`
- `bid_due_at`
- `source_url`
- `portal_type`
- `crawl_data`
- estimate metadata such as `crawl_data.estimated_value`
- location/county/district metadata
- license requirement metadata
- document counts and manifest hints
- parser version / extraction metadata

## User-Owned Fields

These fields must not be overwritten by discovery refreshes:

- `analysis_status`
- `analysis_error`
- `document_acquisition_status`
- `document_processing_status`
- qualification and triage decisions
- `converted_project_id`
- calendar/project linkage
- estimator notes
- tags
- pursuit state
- any future manual override fields

## Proposed Architecture

Create a shared discovery persistence helper used by all worker scan paths:

```text
persistDiscoveredOpportunity(candidate)
```

The helper should:

1. Lookup by a stable portal identity, initially `source_url`.
2. Insert if no row exists.
3. Update only a defined allowlist of portal-owned fields if a row exists.
4. Merge `crawl_data` carefully.
5. Preserve user-owned fields by default.
6. Log whether the result was `inserted`, `refreshed`, or `unchanged`.

## Safe `crawl_data` Merge Strategy

`crawl_data` should be treated as portal-owned, but it may eventually contain user-adjacent or derived fields. C1A should start with a driver-owned namespace/allowlist strategy:

- Refresh known portal keys such as `estimated_value`, `county`, `district`, `license_requirements`, `document_count`, `bid_due_raw`.
- Preserve unknown keys unless explicitly owned by the driver.
- Store parser metadata such as `extraction_method`, `parser_version`, and `extracted_at`.

Recommended pattern:

```text
existing.crawl_data
 + refreshed portal-owned keys
 - no deletion of unknown existing keys
```

## Affected Files

Likely implementation files:

- `bidbox-worker/index.js`
- `bidbox-worker/drivers/planetbids.js`
- `bidbox-worker/drivers/caltrans.js`
- future portal drivers
- `docs/agent-architecture-task-list.md`
- `docs/initiatives/opportunity-intelligence-implementation-plan.md`

Potential database/index review:

- `opportunity_candidates`
- unique index on candidate identity, currently source URL based

## Safety Requirements

- Do not update analyzed reports automatically.
- Do not re-trigger F2/F3/F4 solely because metadata refreshed.
- Do not clear failures or status fields during discovery refresh.
- Do not change `converted_project_id` or project/calendar linkage.
- Do not overwrite manual user overrides.
- Store refresh metrics in task result/logs.

## Open Design Questions

- Should identity remain `source_url`, or should each driver expose a stable `external_id`?
- Should stale opportunities be marked inactive/closed if they disappear from the portal?
- Should refreshes trigger lightweight requalification after F5 exists?
- Which `crawl_data` keys should be explicitly portal-owned for each driver?

## Recommended MVP Implementation

Start with Caltrans and PlanetBids worker scans:

1. Extract a common persistence helper.
2. Refresh `raw_title`, `agency`, `bid_due_at`, and allowlisted `crawl_data` portal keys.
3. Preserve all workflow/status fields.
4. Add task result counts:
   - inserted
   - refreshed
   - unchanged
   - skipped
5. Add a targeted backfill for known historical metadata gaps only when needed.

