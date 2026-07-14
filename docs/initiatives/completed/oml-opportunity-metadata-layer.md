# OML — Opportunity Metadata Layer

**Status:** [CURRENT] — implementation complete as of 2026-06-30  
**Branch:** phase1-opportunity-intelligence  
**Replaces / supersedes:** [v1 auto-analysis pipeline](../../archive/v1-auto-analysis-pipeline.md)

---

## Problem

BidBox v1 wired scanning and AI intelligence together unconditionally.
Every time a portal driver discovered or refreshed an opportunity
candidate, the worker immediately queued the full F2→F3→F4 chain
(document acquisition → document processing → project intelligence
report generation).

This caused three compounding problems:

1. **Cost and latency waste.** AI intelligence was generated for every
   opportunity the portal surfaced, including ones a GC would reject
   in two seconds on the listing page alone.

2. **Noise.** Estimating coordinators received AI reports for work they
   hadn't asked about, creating confusion about what "Analyze Project"
   actually meant.

3. **Fragility.** Auto-triggering on refresh meant a metadata change
   (e.g. a bid extension) would re-run the entire intelligence pipeline
   for an already-analyzed opportunity.

## Insight

Manual walkthroughs of PlanetBids, Caltrans, LA County DPW, LACDA,
and RAMPLA confirmed that the information visible on a portal detail
page — title, agency, bid due date, estimated value, county, scope
text — is sufficient for a human estimating coordinator to decide
whether to spend an hour pursuing a project.

AI intelligence adds value **after** that decision, not before.

## Solution

Establish the **Opportunity Metadata Layer (OML)** as a hard
architectural boundary:

```
Portal → [ OML boundary ] → Opportunity Record
                                    ↓
                             Human reviews metadata
                             and clicks "Analyze Project"
                                    ↓
                             F2 → F3 → F4  (unchanged)
```

**Left of the boundary (OML responsibility):**
- Portal drivers scrape listing/detail pages
- Candidates are persisted with normalized portal metadata
- No intelligence pipeline is triggered

**Right of the boundary (unchanged):**
- F2 document acquisition, F3 processing, F4 report generation
- Triggered exclusively by a human via the `analyze-project` edge function

---

## What Changed

### 1. Decoupled scan → analysis trigger (`bidbox-worker/index.js`)

`persistScannedCandidate` no longer calls `queueOpportunityPreparation`.
Removed dead code: `queueOpportunityPreparation`, `shouldQueueOpportunityPreparation`,
`hasActivePreparationTask`, `PREPARATION_TASK_TYPES`, and all associated
status-set constants.

`analyze-project` (edge function) remains the sole entry point for
triggering the intelligence pipeline. Its internal logic is unchanged.

### 2. Normalized typed columns on `opportunity_candidates`

Migration `20260630200000_oml_normalized_opportunity_columns.sql` adds:

| Column | Type | Source |
|---|---|---|
| `estimated_value` | numeric | `crawl_data.estimated_value` |
| `estimated_value_low` | numeric | `crawl_data.estimated_value_low` |
| `estimated_value_high` | numeric | `crawl_data.estimated_value_high` |
| `county` | text | `crawl_data.county` |
| `project_address` | text | `crawl_data.project_address` |
| `required_licenses` | text[] | `crawl_data.required_licenses` |
| `required_naics` | text[] | `crawl_data.required_naics` |
| `portal_bid_id` | text | `crawl_data.bid_id` |
| `portal_department` | text | `crawl_data.department` |

Existing rows are backfilled. Indexes on `estimated_value` and `county`.

**`crawl_data` is NOT renamed.** It remains the authoritative JSONB
overflow blob for portal-specific fields. Writing both the typed columns
and `crawl_data` is intentional — typed columns serve queries; `crawl_data`
preserves the full portal record without loss. See *crawl_data note* below.

### 3. Portal drivers return OML fields

`planetbids.js` and `caltrans.js` now include the normalized fields
directly on each candidate object. `persistScannedCandidate` writes them
to the new typed columns on every insert and refresh.

### 4. `qualify-candidates` reads typed columns

The edge function now reads `estimated_value`, `county`,
`required_licenses`, and `required_naics` from their typed columns
instead of casting from `crawl_data` JSON. Faster and type-safe.

---

## crawl_data note

> `crawl_data` is intentionally left as-is. It is NOT renamed to
> `portal_metadata` and no compatibility aliases are created.
> Renaming it carries migration risk with no immediate business value.
> The architectural separation OML cares about is the **trigger
> boundary**, not the column name.
>
> If, months from now, all high-value fields have been promoted to
> typed columns and `crawl_data` usage has shrunk to near-zero, a
> rename can be evaluated at that time. A `TODO` comment in the
> migration marks this for future consideration.

---

## Driver Contract (simplified)

Portal drivers return candidate objects with this shape (all fields optional
except `source_url`):

```js
{
  source_url:           string,       // required — deduplication key
  raw_title:            string|null,
  bid_due_at:           string|null,  // ISO 8601

  // OML normalized fields
  estimated_value:      number|null,
  estimated_value_low:  number|null,
  estimated_value_high: number|null,
  county:               string|null,
  project_address:      string|null,
  required_licenses:    string[]|null,
  required_naics:       string[]|null,
  portal_bid_id:        string|null,
  portal_department:    string|null,

  // Portal-specific overflow — everything else goes here
  crawl_data:           object|null,
}
```

Drivers are pure functions: no DB writes, no side effects, no task queuing.
All persistence is handled by `persistScannedCandidate` in `index.js`.

---

## Future Compatibility — Global Opportunity Repository [DEFERRED]

> **This section describes a future initiative, not something being
> built now.** No tables are being moved. No DB ownership changes.
> OML is designed to avoid *precluding* this future architecture.

### What GOR would look like

Eventually BidBox should scan California once — not once per customer.
One scan produces one canonical opportunity record, one document
acquisition pass, one document processing pass, one intelligence report.
Every customer organization references the same canonical project.
User/org-specific data (saved opportunities, pursuit status, notes,
calendar entries, assignments) stays in org-scoped tables and is never
duplicated.

Target pipeline:

```
Portal → OML → Global Opportunity Repository [DEFERRED]
                         ↓
                  Organization Workspace
                         ↓
                  Analyze Project → F2 → F3 → F4
```

### How OML's choices avoid making GOR harder

1. **Drivers are pure functions.** They return data; they don't write to DB.
   Moving the persistence layer later (from per-org to shared) requires
   only changing `persistScannedCandidate`, not the drivers themselves.

2. **Typed normalized columns.** The new columns represent canonical portal
   metadata facts (value, county, due date) that are shared across all orgs
   about the same opportunity. When GOR separates shared metadata from
   org-specific data, these columns move cleanly to the shared table.

3. **No org-specific data in the scan path.** `persistScannedCandidate`
   does not write any user/org identifiers to the canonical opportunity
   record. This means a shared repository could adopt the same write path
   without cleanup.

4. **`analyze-project` as the human-signal boundary.** GOR's per-org
   intelligence model requires a clear signal for "org X wants intelligence
   on project Y." That signal already exists and is already exclusive:
   the user clicking "Analyze Project." No architectural work needed here
   when GOR is eventually built.

### What GOR would still require (deferred)

- A shared `opportunities` table (or equivalent) that is not scoped to
  any organization
- Migration of `opportunity_candidates` ownership from per-org to global
- Per-org join tables for saved/pursued/dismissed opportunities
- Multi-tenant deduplication logic for the scan path
- Shared document storage (one acquisition per opportunity, not one per org)

None of this is being designed or built now.
