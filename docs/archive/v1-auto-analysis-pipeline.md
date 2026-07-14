# [SUPERSEDED] V1 Auto-Analysis Pipeline

**Status:** [SUPERSEDED by OML] — archived 2026-06-30  
**Superseded by:** [OML — Opportunity Metadata Layer](../initiatives/completed/oml-opportunity-metadata-layer.md)

This document preserves the v1 architecture for historical context.
Do not implement from this document. See the OML initiative for current design.

---

## Architecture Summary (v1)

In v1, scanning and AI intelligence were a single pipeline:

```
Scan Worker
  → portal driver scrapes listing
  → persistScannedCandidate()
      → INSERT/UPDATE opportunity_candidates
      → queueOpportunityPreparation()          ← auto-trigger
          → INSERT project_analysis task
          → UPDATE opportunity_intelligence_status = 'queued'

Worker picks up project_analysis task
  → F2: acquirePlanetBidsDocuments / acquireCaltransDocuments
  → F3: runDocumentProcessing
  → F4: runProjectIntelligence
  → opportunity_intelligence_status = 'ready'
```

The `analyze-project` edge function existed but was redundant: it
could trigger the same pipeline, but the scan worker had already
triggered it automatically for every new or refreshed candidate.

## Key Functions (removed in OML pivot)

All of the following were removed from `bidbox-worker/index.js` as
dead code when OML decoupled the trigger:

- `queueOpportunityPreparation({ supabase, candidate, ... })` — inserted
  a `project_analysis` task and set `opportunity_intelligence_status = 'queued'`

- `shouldQueueOpportunityPreparation(candidate, metadataChanged)` — eligibility
  check: skipped converted projects, skipped bids already in active/ready states,
  queued on new discovery or metadata change

- `hasActivePreparationTask(supabase, candidateId)` — dedup guard: checked
  `agent_tasks` for any existing `pending/running/retrying` task of type
  `project_analysis`, `document_processing`, or `project_intelligence`

- Constants: `PREPARATION_TASK_TYPES`, `ACTIVE_TASK_STATUSES`, all `OI_*_STATUSES`
  and `LEGACY_*_STATUSES` sets

## Why It Was Replaced

Manual portal walkthroughs confirmed that estimating coordinators can
make pursue/pass decisions from portal metadata alone (title, agency,
bid date, estimated value, county) — well before any documents need to
be fetched. Auto-triggering the full AI pipeline on every discovered
opportunity generated AI reports for work the GC would never bid, wasting
compute and creating noise.

The OML initiative established a clean boundary: scanning stops at metadata
persistence. AI intelligence starts only when a human explicitly clicks
"Analyze Project." The F2/F3/F4 pipeline itself is unchanged.

## Migration Note

No data was lost in this transition. `crawl_data` was not renamed.
The `analyze-project` edge function continued to work without changes —
it was already the correct trigger mechanism; v1 simply had a competing
auto-trigger that OML removed.
