# PlanetBids Driver-Owned Listing Discovery Through `/papi/bids`

**Status:** Deferred, high-priority technical debt
**Evidence:** [PlanetBids instrumented production wave — 2026-07-20](../analysis/planetbids-instrumented-production-wave-2026-07-20.md)

## Problem

PlanetBids listing discovery currently depends on the third-party Ember SPA completing anonymous bootstrap and rendering its bid table. The controlled production wave confirmed that the SPA can fail during anonymous bootstrap before `/papi/bids` is requested, leaving the worker with no authoritative listing data or rendered rows to discover.

## Interim mitigation

The immediate mitigation detects the confirmed poisoned-bootstrap signature, closes and explicitly releases that Browserbase session, and retries the normal listing flow once in a fresh session. This should reduce intermittent failures without weakening empty, invalid-portal, or ordinary-timeout semantics.

Fresh-session recovery is a bounded recovery mechanism. It is not the durable listing architecture and remains dependent on the PlanetBids SPA successfully bootstrapping at least once.

## Proposed durable architecture

Move listing discovery into the BidBox PlanetBids driver using the structured `/papi/bids` JSON:API response. The driver should:

- establish or obtain valid anonymous session state;
- reproduce the authoritative listing-request contract;
- parse structured listing records and complete pagination;
- derive stable bid and detail identifiers;
- preserve existing candidate UUIDs and deduplication behavior;
- retain explicit-empty and retryable-failure semantics; and
- use browser/DOM navigation only for detail information unavailable through the listing API.

Raw portal responses remain evidence and must not be destructively rewritten by the new path. Candidate mapping and persistence should continue through the existing ingestion boundary.

## Open technical questions

- Which cookies, anonymous tokens, request headers, and bootstrap calls are required?
- Can the request use Playwright context request APIs and inherit the browser session safely?
- What are the exact query parameters and portal/agency identifier requirements?
- How do pagination, page size, sorting, filters, and total counts behave?
- What is the complete JSON:API schema, including nested title and due-date fields?
- What rate limits apply, and what backoff is appropriate?
- How should 401, 403, 429, and 5xx responses be classified and retried?
- What response is the authoritative explicit-empty state?
- Does API-derived candidate identity and metadata match current DOM extraction?
- Which detail fields and documents still require browser navigation?
- Are direct API calls permitted only after a healthy SPA bootstrap?
- Is a separate non-browser HTTP flow viable and supportable?

## Risks

- The driver would depend on an undocumented third-party API whose schema or authentication can change.
- Incorrect pagination or filtering could miss candidates or over-fetch and trigger rate limits.
- Identity mapping errors could create duplicates or detach updates from existing candidates.
- API data can diverge from the rendered portal.
- Moving too much extraction away from detail navigation could lose fields available only in the rendered detail view.

## Acceptance criteria

- API-derived listing counts match representative rendered portals.
- Existing candidate UUIDs remain stable and no duplicate candidates are created.
- Pagination is complete.
- Explicit-empty sources complete cleanly.
- Failed API/auth states are retryable, bounded, and observable.
- Representative 5-, 30-, and 60-row portals pass API-to-rendered parity checks.
- Candidate fields and detail links match the current extraction path within approved tolerances.
- Two consecutive midnight waves complete without SPA-render-dependent listing failures.

## Priority and scheduling trigger

This is deferred but high-priority technical debt. Schedule it after fresh-session recovery is deployed and production-validated, or immediately if fresh-session recovery does not reduce the PlanetBids failure rate sufficiently.
