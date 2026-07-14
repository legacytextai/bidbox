# Opportunity Lifecycle and Historical Archive Initiative

**Status:** Planned  
**Scope:** Opportunity lifecycle, closed-project handling, historical archiving, ingestion cost control, and Coverage dashboard reconciliation  
**Primary Goal:** Preserve the long-term intelligence value of closed opportunities while removing them from the active operational path and reducing unnecessary compute, browser, document, AI, and qualification costs.

---

## Executive Summary

BidBox currently treats all stored opportunities as one large inventory even though many are already closed. This creates three problems:

1. The Coverage dashboard reports total records in a way that can be mistaken for live opportunity coverage.
2. Closed opportunities continue to clutter the user experience, especially as the Closed tab grows indefinitely.
3. Historical opportunities may continue to consume refresh, qualification, document-processing, and AI resources even though they are no longer bid-able.

Closed opportunities should not be deleted by default. They can become valuable historical intelligence for estimating, agency analysis, comparable-project search, bid pricing, rebid detection, and future contractor knowledge.

The correct strategy is to introduce an explicit lifecycle policy:

- Keep active opportunities fully operational.
- Keep recently closed opportunities visible and lightly monitored.
- Archive older closed opportunities so they remain searchable but no longer consume recurring processing.
- Retain selected historical projects and existing intelligence as long-term strategic data.

This initiative should begin with count reconciliation and lifecycle definitions before changing ingestion, refresh, or retention behavior.

---

## Problem Statement

The current system can report numbers such as:

- Total system opportunities: 1,785
- Open/live opportunities: approximately 600
- Closed opportunities: approximately 1,076
- Filtered or globally excluded opportunities: approximately 100

These numbers do not represent the same concepts, and they are not clearly reconciled across the Coverage dashboard and Opportunities page.

As the system continues scanning portals, the closed population will grow permanently unless BidBox establishes:

- A lifecycle state model
- A recent-closed window
- An archive policy
- Processing rules by lifecycle
- Historical retention rules
- Clear dashboard metrics
- A user-facing historical-search strategy

Without this policy, closed records will increasingly dominate counts, operational queries, and potentially processing costs.

---

## Product Objective

Create a lifecycle system that makes BidBox’s active opportunity inventory trustworthy, keeps closed opportunities useful, and prevents historical records from consuming the same resources as live bids.

The system should answer these questions clearly:

- How many opportunities are currently bid-able?
- How many recently closed?
- How many are archived?
- How many are globally filtered or invalid?
- How many total records exist?
- Which closed records should still be monitored?
- Which records should remain searchable?
- Which records should receive no further processing?
- Which historical records are valuable enough to retain deeply?

---

## Product Principles

### 1. Do not delete valuable history by default

Closed opportunities may support future features such as:

- Historical bid pricing
- Engineer’s-estimate comparisons
- Comparable-project search
- Agency procurement patterns
- Repeat-scope detection
- Likely rebids
- Winning bidder and award intelligence
- Contractor competition analysis
- Estimating benchmarks
- Scope and specification reuse
- Historical natural-language search

### 2. Closed opportunities must become cheap

The database row itself is not the main cost. The expensive activities are:

- Browser scanning
- Repeated portal refreshes
- Document downloads
- Document parsing and chunking
- AI summaries and intelligence reports
- Embedding generation
- Qualification fanout
- Repeated downstream task creation

Once a project closes, BidBox should reduce or stop these activities according to its lifecycle tier.

### 3. Active inventory and historical inventory are different products

The main Opportunities experience is operational. Historical records are analytical and archival.

They should not share the same default visibility, processing policy, or dashboard presentation.

### 4. Preserve data already paid for

If BidBox has already acquired documents, generated intelligence, or analyzed a closed project, preserve that work unless a separate retention policy explicitly removes it.

### 5. Prefer reversible policy changes

The first implementation should use lifecycle fields, status rules, and query behavior. It should not require physically moving records into separate tables unless later scale proves that necessary.

---

## Proposed Lifecycle Model

### Open

An opportunity is still bid-able.

**Behavior:**

- Visible in active opportunity views
- Fully refreshed according to portal policy
- Eligible for qualification
- Eligible for document acquisition
- Eligible for intelligence generation
- Eligible for embeddings and search indexing
- Monitored for addenda, due-date changes, cancellations, and revisions

### Recently Closed

An opportunity closed within the recent-retention window.

**Recommended initial window:** 60 days

**Behavior:**

- Visible in the Closed tab
- No normal qualification reruns
- No new intelligence generation by default
- No automatic document processing unless explicitly needed
- Light monitoring only for:
  - Bid-date extensions
  - Reopening
  - Rebids
  - Cancellations
  - Award information
  - Addenda or final notices
- Existing documents and intelligence remain accessible

### Archived

An opportunity has been closed longer than the recent-closed window.

**Recommended initial threshold:** More than 60 days closed

**Behavior:**

- Removed from the default Closed view
- Searchable through an Archived or historical view
- No recurring portal refresh by default
- No qualification fanout
- No automatic document acquisition
- No new AI processing
- No routine embedding refresh unless the search index changes
- Core metadata retained

### Historical Intelligence

A selected archived opportunity is retained as a high-value historical record.

This may be an explicit lifecycle tier or a flag layered onto archived records.

**Possible selection signals:**

- Documents were already acquired
- Intelligence report already exists
- Engineer’s estimate is known
- Bid tabulation or award data exists
- Project has strong estimating-comparable value
- User saved, analyzed, or converted the project
- Project belongs to a strategically important agency
- Project represents a repeatable scope
- Project has strong historical pricing value

**Behavior:**

- Searchable in historical intelligence
- Existing documents and derived intelligence preserved
- Eligible for future award, comparable-project, and pricing enrichment
- Not treated as an active bidding opportunity

---

## Recommended Initial Policy

| Lifecycle | Age / Condition | User Visibility | Refresh Policy | Documents / AI | Qualification |
|---|---|---|---|---|---|
| Open | Due date has not passed | Active opportunity views | Full | Normal policy | Normal policy |
| Recently Closed | Closed less than 60 days | Default Closed tab | Light monitoring | Preserve; no new processing by default | No recurring reruns |
| Archived | Closed 60–365 days | Historical/archive view | None by default | Preserve existing; no new work | None |
| Long-Term Historical | Closed more than 365 days | Historical search only | None | Metadata retained; artifacts retained selectively | None |
| Very Old Newly Discovered | Already old when first discovered | Usually hidden from operational views | None | Metadata-only or skip | None |

The exact windows should be configurable rather than permanently hard-coded.

---

## Coverage Dashboard Reconciliation

The Coverage dashboard should stop presenting one total count as though it represents active inventory.

### Recommended top-level metrics

- **Active Opportunities**
- **Recently Closed**
- **Archived**
- **Globally Filtered / Excluded**
- **Quarantined / Invalid**
- **Total Records**

### Required count definitions

Every metric must have a documented query definition.

Examples:

**Active Opportunities**

- Open
- Globally valid
- Canonical record if duplicated
- Not quarantined
- Not globally excluded

**Recently Closed**

- Closed
- Closed date within configured recent window
- Globally valid

**Archived**

- Closed before recent window
- Not deleted
- Historical record retained

**Filtered / Excluded**

- Globally excluded as non-public-works
- Duplicate of canonical opportunity
- Invalid category
- Other system-level exclusion

**Total Records**

- Every candidate record in the underlying table
- Clearly labeled as storage inventory, not active coverage

### Reconciliation requirement

The initiative must produce a count-reconciliation report that explains why:

`Total records ≠ Active + Recently Closed + Archived`

when quarantined, duplicate, converted, deleted, or other special states exist.

There should be no unexplained population.

---

## Closed Tab Experience

### Current problem

Displaying every closed opportunity ever collected causes the Closed count to grow indefinitely and makes the view less useful.

### Recommended behavior

The Closed tab should default to recently closed opportunities only.

**Recommended default:** Last 60 days

The user should be able to access older records through:

- An `Archived` filter
- A historical-search view
- A date-range filter
- A link such as `View archived opportunities`

### Count behavior

Instead of showing all-time closed inventory, the primary Closed badge should show the recent window.

Example:

- `Closed 112`

not:

- `Closed 1,076`

A secondary label can show:

- `964 archived`

### Sorting

Recently closed opportunities should default to:

1. Most recently closed
2. Most recently updated
3. Reopened or extended opportunities surfaced first

### Search

Archived opportunities should remain searchable by:

- Title
- Agency
- Scope
- Location
- Estimated value
- Due date
- Portal
- Historical intelligence
- Future semantic-search index

### Protected card rule

This initiative must not modify opportunity-card markup unless explicitly approved.

Lifecycle work should occur through:

- Query selection
- Tabs
- Filters
- Page-level notices
- Counts
- Archive views
- Background processing policies

---

## Ingestion and Processing Policy

### Open opportunity

Use full ingestion and processing policy.

### Recently closed opportunity

Use lightweight monitoring.

Allowed follow-up events:

- Reopened
- Extended
- Cancelled
- Awarded
- Rebidding
- New final addendum
- Bid results posted

Disallowed by default:

- Re-running qualification
- Re-generating an unchanged intelligence report
- Re-downloading unchanged documents
- Re-embedding unchanged content
- Re-running expensive portal detail acquisition without a meaningful change signal

### Archived opportunity

Do not schedule recurring work.

The candidate should be excluded from:

- Normal refresh queues
- Qualification fanout
- Document-prefetch queues
- Intelligence-generation queues
- Routine embedding refresh
- Operational dashboard activity

### Old opportunities discovered for the first time

The scanner should classify the opportunity before deep processing.

**Recommended rules:**

- Open → full ingestion
- Closed less than 60 days → lightweight metadata plus selective detail
- Closed 60–365 days → metadata-only unless historically valuable
- Closed more than one year → skip or metadata-only according to portal and strategic value

A 2018 listing discovered in 2026 should never receive the same processing budget as an open 2026 bid.

---

## Data Retention Strategy

### Always retain

- Candidate UUID
- Portal and source identifiers
- Source URL
- Title
- Agency
- Department
- Solicitation number
- Due date
- Closed date or lifecycle transition date
- Estimated value when known
- County and location
- Global exclusion status
- Canonical-duplicate relationship
- Lifecycle state
- Created and updated timestamps

### Retain when already available or strategically valuable

- Documents
- Document manifests
- Intelligence reports
- Citations and findings
- Embeddings
- Engineer’s estimate
- Bid items
- Award information
- Bid tabulations
- User saves, notes, or project conversions

### Future retention review

A later storage-retention policy may decide whether to remove:

- Duplicate downloaded files
- Superseded document versions
- Low-value historical embeddings
- Temporary extraction artifacts
- Browser screenshots
- Failed processing artifacts
- Reconstructable caches

This initiative should not delete these artifacts in its first phase.

---

## Technical Design Direction

### Preferred initial approach

Add lifecycle fields and centralized lifecycle policy rather than creating separate active and archive tables.

Potential fields:

- `lifecycle_status`
- `closed_at`
- `archived_at`
- `historical_intelligence`
- `last_lifecycle_evaluated_at`
- `lifecycle_reason`
- `light_monitor_until`
- `processing_tier`

Possible lifecycle values:

- `open`
- `recently_closed`
- `archived`
- `historical`

Possible processing tiers:

- `full`
- `light`
- `metadata_only`
- `none`

### Central lifecycle resolver

Create one shared lifecycle resolver used by:

- Opportunity ingestion
- Candidate refresh
- Opportunities-page queries
- Coverage dashboard
- Qualification fanout
- Document acquisition
- Intelligence task creation
- Search indexing
- Scheduled maintenance jobs

Do not duplicate lifecycle logic independently across frontend, Edge Functions, and Railway.

### Idempotency

Lifecycle transitions must be idempotent.

Examples:

- An archived project whose due date is extended should safely return to Open.
- A reopened project should re-enter normal processing.
- A project should not generate duplicate archive tasks.
- Repeated lifecycle evaluation should not rewrite unchanged rows unnecessarily.

---

## Implementation Plan

### Phase 1 — Inventory and Count Reconciliation

**Objective:** Establish the current truth before changing behavior.

Actions:

- Define exact counts for active, closed, filtered, quarantined, duplicate, converted, and total records.
- Reconcile the Coverage dashboard against the Opportunities page.
- Identify any records counted in multiple buckets.
- Identify any records counted in no bucket.
- Produce a portal-by-portal age distribution.
- Measure how many closed records still receive refreshes or downstream tasks.
- Estimate current document, AI, qualification, and browser activity spent on closed opportunities.

Deliverable:

- Production reconciliation report
- Approved lifecycle definitions
- Approved count-query definitions

### Phase 2 — Lifecycle Schema and Resolver

**Objective:** Introduce explicit lifecycle and processing-tier policy.

Actions:

- Add additive lifecycle fields.
- Implement a centralized lifecycle resolver.
- Backfill lifecycle state for current records in shadow mode.
- Compare derived lifecycle counts against existing page behavior.
- Validate reopening and due-date-extension transitions.
- Keep lifecycle activation disabled until reconciliation passes.

Deliverable:

- Shadow lifecycle classification
- Backfill report
- Transition tests

### Phase 3 — Coverage Dashboard Metrics

**Objective:** Make dashboard counts operationally meaningful.

Actions:

- Replace or supplement the current total-opportunity card.
- Add active, recently closed, archived, excluded, and total metrics.
- Document each metric definition.
- Add reconciliation diagnostics for administrators.
- Preserve portal-family and county reporting while clarifying whether counts are active or all-time.

Deliverable:

- Reconciled Coverage dashboard
- Zero unexplained records

### Phase 4 — Closed and Archived User Experience

**Objective:** Keep recent closures useful without exposing all historical records by default.

Actions:

- Limit the default Closed tab to the configured recent window.
- Add an Archived or historical-access path.
- Add date-range controls.
- Preserve existing cards.
- Keep archived records searchable.
- Ensure Saved and converted projects remain accessible regardless of age.

Deliverable:

- Recent Closed experience
- Historical archive access
- Updated count behavior

### Phase 5 — Processing Suppression

**Objective:** Stop unnecessary work on closed and archived projects.

Actions:

- Suppress qualification fanout for non-open projects.
- Suppress routine document-prefetch tasks.
- Suppress new intelligence generation unless explicitly requested.
- Suppress routine embedding refresh.
- Replace full refresh with light monitoring for recently closed projects.
- Stop recurring refresh for archived projects.
- Preserve award/rebid/reopening signals where supported.

Deliverable:

- Lifecycle-aware task routing
- Measured reduction in processing volume

### Phase 6 — Historical Ingestion Policy

**Objective:** Prevent deep processing of old listings discovered for the first time.

Actions:

- Evaluate lifecycle before downstream work is scheduled.
- Apply full, light, metadata-only, or skip policy.
- Add portal-specific safeguards where portals expose large historical catalogs.
- Measure historical records skipped or downgraded.
- Confirm no currently open opportunity is incorrectly downgraded.

Deliverable:

- Age-aware ingestion
- Historical-processing cost report

### Phase 7 — Historical Intelligence Foundation

**Objective:** Preserve and expose strategic value from archived records.

Actions:

- Define historical-intelligence selection rules.
- Preserve analyzed and user-engaged records.
- Add future hooks for awards, bid pricing, comparable projects, and agency patterns.
- Integrate archived records into semantic search when appropriate.
- Keep historical analytics separate from operational opportunity counts.

Deliverable:

- Historical-intelligence eligibility policy
- Search and analytics integration plan

### Phase 8 — Rollout and Monitoring

**Objective:** Activate safely and measure results.

Actions:

- Activate lifecycle policy in stages.
- Start with dashboard counts.
- Then change Closed-tab visibility.
- Then activate downstream-task suppression.
- Then activate historical-ingestion policy.
- Monitor missed reopenings, extensions, or rebids.
- Add rollback controls for each phase.

Deliverable:

- Production rollout
- Lifecycle-health dashboard
- Documented rollback procedures

---

## Task List

## Task 1 - Reconcile Current Opportunity Counts

Subtasks:

### 1.1. Define every current visibility bucket

- Active
- Closed
- Saved
- Converted
- Filtered
- Quarantined
- Duplicate
- Invalid
- Total

### 1.2. Reconstruct Opportunities-page counts from production data

### 1.3. Reconstruct Coverage-dashboard counts from production data

### 1.4. Identify overlapping and orphaned populations

### 1.5. Produce a reconciliation table by portal family

### 1.6. Document authoritative query definitions

---

## Task 2 - Measure Closed-Opportunity Processing Cost

Subtasks:

### 2.1. Count refresh tasks created for closed opportunities

### 2.2. Count qualification tasks created for closed opportunities

### 2.3. Count document-prefetch and processing tasks

### 2.4. Count intelligence and embedding tasks

### 2.5. Estimate Browserbase and worker runtime

### 2.6. Estimate storage used by historical documents and derived artifacts

### 2.7. Establish the baseline before optimization

---

## Task 3 - Define Lifecycle Policy

Subtasks:

### 3.1. Approve lifecycle states

### 3.2. Approve lifecycle time windows

### 3.3. Define transition rules

### 3.4. Define reopening and due-date-extension behavior

### 3.5. Define lifecycle processing tiers

### 3.6. Define historical-intelligence eligibility

### 3.7. Document non-goals and deletion policy

---

## Task 4 - Add Lifecycle Schema

Subtasks:

### 4.1. Design additive lifecycle fields

### 4.2. Add processing-tier fields

### 4.3. Add lifecycle timestamps and reason fields

### 4.4. Add indexes for active and recent-closed queries

### 4.5. Add lifecycle audit support if needed

### 4.6. Keep migration backward-compatible

---

## Task 5 - Build Central Lifecycle Resolver

Subtasks:

### 5.1. Resolve lifecycle from due date and opportunity status

### 5.2. Handle missing or conflicting dates

### 5.3. Handle reopened opportunities

### 5.4. Handle bid-date extensions

### 5.5. Handle cancellations and rebids

### 5.6. Resolve processing tier

### 5.7. Make evaluation idempotent

### 5.8. Add unit tests

---

## Task 6 - Backfill Lifecycle in Shadow Mode

Subtasks:

### 6.1. Classify all existing candidates

### 6.2. Persist shadow lifecycle results

### 6.3. Compare shadow results to current UI buckets

### 6.4. Audit open projects classified as closed

### 6.5. Audit closed projects classified as open

### 6.6. Audit old portal listings

### 6.7. Approve activation thresholds

---

## Task 7 - Reconcile Coverage Dashboard

Subtasks:

### 7.1. Add active-opportunity metric

### 7.2. Add recently-closed metric

### 7.3. Add archived metric

### 7.4. Add excluded and quarantined metrics

### 7.5. Preserve total-record metric with clear labeling

### 7.6. Update portal-family counts to declare active versus all-time basis

### 7.7. Add administrator reconciliation diagnostics

### 7.8. Validate counts against production queries

---

## Task 8 - Update Closed and Archived Views

Subtasks:

### 8.1. Limit Closed default to the recent window

### 8.2. Add archived access

### 8.3. Add date-range filtering

### 8.4. Preserve Saved and converted historical projects

### 8.5. Preserve existing opportunity cards

### 8.6. Add URL state for lifecycle and date filters

### 8.7. Test pagination and performance

---

## Task 9 - Suppress Closed-Project Qualification

Subtasks:

### 9.1. Prevent normal qualification fanout for recently closed records

### 9.2. Prevent qualification fanout for archived records

### 9.3. Preserve explicit user-triggered evaluation where appropriate

### 9.4. Confirm reopened projects re-enter qualification

### 9.5. Add regression tests

---

## Task 10 - Suppress Closed-Project Document and AI Processing

Subtasks:

### 10.1. Prevent automatic document-prefetch for archived records

### 10.2. Prevent automatic intelligence generation

### 10.3. Prevent routine embedding refresh

### 10.4. Preserve existing documents and intelligence

### 10.5. Permit explicit user-triggered historical analysis

### 10.6. Add task-routing tests

---

## Task 11 - Add Recently Closed Light Monitoring

Subtasks:

### 11.1. Define supported change signals

### 11.2. Monitor bid-date extensions

### 11.3. Monitor reopening

### 11.4. Monitor cancellations

### 11.5. Monitor rebids

### 11.6. Monitor awards where supported

### 11.7. Prevent full downstream task fanout for unchanged records

---

## Task 12 - Add Historical Ingestion Controls

Subtasks:

### 12.1. Classify age before deep processing

### 12.2. Add metadata-only persistence path

### 12.3. Add skip policy for very old low-value listings

### 12.4. Add portal-specific historical-catalog handling

### 12.5. Prevent old records from triggering full downstream pipelines

### 12.6. Validate that open projects are never downgraded because of parsing errors

---

## Task 13 - Define Historical Intelligence

Subtasks:

### 13.1. Define high-value historical criteria

### 13.2. Preserve analyzed projects

### 13.3. Preserve user-saved and converted projects

### 13.4. Preserve projects with estimates, bid tabs, or awards

### 13.5. Plan comparable-project search

### 13.6. Plan historical pricing and agency analytics

### 13.7. Define future enrichment policy

---

## Task 14 - Add Lifecycle Monitoring and Rollback

Subtasks:

### 14.1. Add lifecycle count monitoring

### 14.2. Add task-suppression metrics

### 14.3. Add reopening and extension alerts

### 14.4. Detect lifecycle-classification drift

### 14.5. Add feature flags for each rollout phase

### 14.6. Document rollback procedures

---

## Acceptance Criteria

The initiative is complete when:

- Coverage dashboard counts reconcile with Opportunities-page populations.
- Active, recently closed, archived, excluded, and total counts are explicitly defined.
- There are no unexplained records.
- Closed opportunities older than the configured window no longer clutter the default Closed view.
- Archived opportunities remain searchable.
- Closed and archived records do not receive routine qualification.
- Archived records do not receive routine refresh, document, AI, or embedding tasks.
- Recently closed records receive only approved light monitoring.
- Old newly discovered listings do not enter the full processing pipeline.
- Existing documents and intelligence are preserved.
- Reopened or extended projects return safely to Open.
- Opportunity cards remain unchanged.
- Processing-volume reduction is measured against the baseline.
- Rollback controls exist.

---

## Risks

### Missed reopening or bid-date extension

Mitigation:

- Keep recently closed opportunities in light monitoring.
- Support explicit lifecycle reversal.
- Preserve portal-specific change signals.

### Premature archiving caused by bad due dates

Mitigation:

- Use authoritative bid-date rules.
- Quarantine ambiguous dates.
- Audit transitions before activation.

### Historical search degradation

Mitigation:

- Preserve metadata and existing embeddings initially.
- Do not delete historical records in the first release.

### User confusion about counts

Mitigation:

- Document metric definitions.
- Separate active coverage from total stored records.
- Show recent Closed and Archived as distinct concepts.

### Accidental card redesign

Mitigation:

- Treat opportunity cards as protected.
- Keep lifecycle presentation outside card internals unless explicitly approved.

### Portal-specific lifecycle inconsistency

Mitigation:

- Use a central lifecycle resolver.
- Allow portal-specific evidence adapters without duplicating policy.

---

## Non-Goals

This initiative does not initially include:

- Deleting closed opportunities
- Deleting historical documents
- Rewriting opportunity cards
- Building full award intelligence
- Building historical pricing analytics
- Building comparable-project AI
- Moving archived records into a separate physical database
- Implementing the full Opportunities Page Facelift
- Activating unrelated geography work
- Reprocessing all historical documents

---

## Open Questions

- Should the recent-closed window be 30, 60, or 90 days?
- Should archived opportunities remain a tab, a filter, or a separate page?
- Should user-saved projects remain in Closed indefinitely regardless of age?
- How should converted calendar projects be treated?
- Which portals can reliably detect awards or rebids?
- Should archived records remain embedded for semantic search?
- When, if ever, should low-value historical documents be deleted?
- Should the system ingest very old listings at all?
- Should historical intelligence be a lifecycle state or a separate flag?
- Which metrics should be visible to normal users versus administrators?

---

## Recommended First Move

Do not begin by changing the Closed tab.

Begin with a read-only production reconciliation that answers:

1. Exactly how the 1,785 total records divide into active, recently closed, archived, filtered, duplicate, quarantined, converted, and other populations.
2. How many closed records are still generating worker, Browserbase, document, qualification, embedding, or AI activity.
3. Which portals are introducing large historical inventories.
4. What processing savings would result from each lifecycle threshold.

Only after that report is approved should schema or behavior change.
