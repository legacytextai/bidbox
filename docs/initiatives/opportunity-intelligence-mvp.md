# BidBox Initiative: Opportunity Intelligence MVP

Status: [SUPERSEDED by OML] — trigger wiring superseded 2026-06-30  
Date: June 2026  
Superseded by: `docs/initiatives/completed/oml-opportunity-metadata-layer.md`  
Workspace evolution: `docs/initiatives/f5-opportunity-project-workspace.md`

> **Note:** The F2/F3/F4 pipeline design in this document remains valid.
> What changed: scanning no longer auto-triggers the pipeline. See OML doc.

## Context

The original BidBox vision included a Qualification Agent immediately after opportunity discovery.

After reviewing the repository audit and evaluating real estimator workflows, we determined that meaningful qualification cannot occur using opportunity metadata alone.

Most critical qualification data is not available on portal listing pages.

Examples include:

- Detailed project scope
- Trade requirements
- License requirements
- Bond requirements
- Insurance requirements
- Labor compliance requirements
- Mandatory job walks
- Special provisions
- Addenda impacts

This information typically resides inside project documents rather than opportunity listings.

As a result, the current Qualification Agent can only provide lightweight triage using:

- Project title
- Agency
- County
- Due date
- Estimated value, when available

This is insufficient to answer the contractor's primary question:

> Is this project worth pursuing?

## Revised MVP Philosophy

The MVP does not need to automate the entire bidding lifecycle.

The MVP only needs to solve three problems:

### Problem #1

I don't know what to bid.

### Problem #2

I waste hours digging through portals.

### Problem #3

I don't know if this project is worth chasing.

## Revised Workflow

### Stage 1: Opportunity Discovery

BidBox continuously scans supported public works portals.

The objective is comprehensive project visibility.

Displayed information includes:

- Project title
- Agency
- County
- Due date
- Portal source
- Estimated value, if available

At this stage BidBox is not attempting deep qualification.

The objective is simply:

> Show me opportunities I may care about.

### Stage 2: Human Interest Signal

The estimator reviews opportunities.

For each opportunity:

- Ignore
- Save for Later
- Analyze Project

The `Analyze Project` action acts as an explicit signal that the estimator wants deeper intelligence.

This prevents unnecessary document processing and AI costs.

### Stage 3: Project Intelligence Agent

When an estimator requests analysis, BidBox:

1. Verifies agency access and resolves registration blockers where possible
2. Downloads project documents
3. Stores source files
4. Extracts text
5. Processes plans, specs, and addenda
6. Generates a structured intelligence report

Agency Access Management is a supporting capability for this stage.

Public agencies may require vendor registration, prospective bidder registration, plan holder registration, or other access steps before documents and addenda are available. BidBox should treat this as an access-management layer, not as a one-off scraper edge case.

Initial Agency Access Management should focus on BidBox's internal agency access network so the product can validate document acquisition and Project Intelligence. Future customer-facing versions should allow contractors to manage their own portal credentials and agency registration preferences through Bid Profile.

F2 Document Acquisition has now been validated in production for the PlanetBids path. Two Newport Beach projects successfully completed the chain from authenticated PlanetBids access through manifest retrieval, document download, private Supabase Storage upload, and `opportunity_documents` metadata persistence.

Validated examples:

- `Holiday Decor Rental and Installation Services 26-53`: 3 documents acquired, 3 stored, 0 failures.
- `PAVEMENT RESTORATION PARK AVENUE & S BAY FRONT ALLEY 9451-3`: 9 documents acquired, 9 stored, 0 failures, including `Plans.pdf`, addenda, bidder lists, and supporting documents.

F3 Document Processing has now been validated in production for text-native PDFs. `San Miguel Drive Pavement Rehabilitation 9855-2` for City of Newport Beach completed the chain from PDF through `document_processing`, PDF text extraction, `opportunity_document_pages`, `opportunity_document_chunks`, and citation metadata.

F3 validation results:

- 5 PDFs processed
- 178 pages extracted
- 106 chunks created
- 0 failures
- 0 OCR-required documents
- Document → page → chunk citation chain verified

Current platform status:

```text
F1 Opportunity Discovery / Analyze Project
✅ Complete

F2 Document Acquisition
✅ Complete

F3 Document Processing
✅ Complete

F4 Project Intelligence
✅ Complete

Phase G Pursuit Management & Project Workspace
🔄 Next active task

F5 Qualification Agent
⏸ Paused until the Project Workspace bridge is stable
```

F3 remains an evidence-processing layer only. It classifies, extracts, organizes, chunks, cites, and tracks status. It does not interpret requirements, generate intelligence reports, answer estimator questions, resolve precedence conflicts, or make pursuit recommendations. Those responsibilities belong to F4 Project Intelligence and F5 Qualification.

F4 Project Intelligence is now MVP complete. BidBox has validated document-backed report generation on real PlanetBids projects across multiple agencies. Reports include source-backed citations, executive summaries with project context, project snapshot metadata, scope summaries, trade breakdowns, key dates, bid requirements, addenda summaries, risk flags, and source document references. Portal metadata now flows into reports where available, including engineer estimates and license requirements. Bid due date/time conflict safeguards and corrected Opportunity → Intelligence Report navigation are complete.

The next active task is Phase G: Pursuit Management & Project Workspace. Phase G should harden the transition from Intelligence Report to active pursuit by treating `Add to Calendar` as create/reuse project, preserving Opportunity Intelligence as the evaluation source of truth, separating legacy One Link projects from Opportunity Intelligence projects, and building a lightweight Project Workspace for active pursuits.

Outputs may include:

#### Executive Summary

- Project description
- Agency
- Estimated value
- Bid date

#### Scope Summary

- Work description
- Major scopes
- Key deliverables

#### Trade Breakdown

- Required trades
- Self-perform opportunities
- Coverage requirements

#### Requirements

- License requirements
- Bond requirements
- Insurance requirements
- Labor compliance requirements

#### Bid Events

- Mandatory job walks
- Pre-bid meetings
- Key deadlines

#### Risks

- Complexity flags
- Long lead items
- Special provisions
- High-risk language

### Stage 4: Qualification Agent

Only after project intelligence exists.

The Qualification Agent evaluates:

- Geographic fit
- Contract size fit
- License fit
- Scope fit
- Historical fit
- Risk profile

Outputs:

- Strong Match
- Review Carefully
- Poor Match

Qualification becomes evidence-based rather than metadata-based.

### Stage 5: Pursuit Management

The estimator's pursuit signal is:

- Add to Calendar

For the MVP, `Add to Calendar` creates or reuses a `projects` record because Projects remain the Calendar anchor model.

If an estimator adds a project to the calendar, that is the signal that the project is worth tracking.

The Intelligence Report and Project Workspace are separate concepts:

- The Intelligence Report remains the source of truth for project evaluation, citations, source documents, requirements, risks, and trade breakdown.
- The Project Workspace is the operational shell for an active pursuit after the estimator decides to track the project.

Opportunity Intelligence projects should not re-enter legacy One Link crawl or re-analysis flows after F2/F3/F4 are complete.

## MVP Success Criteria

A contractor can:

1. Discover relevant public works opportunities.
2. Select interesting opportunities.
3. Receive an AI-generated intelligence report.
4. Understand whether a project is worth pursuing.
5. Add selected opportunities to the calendar and open a Project Workspace that preserves access to the Intelligence Report.

If BidBox accomplishes these five outcomes, the MVP has successfully validated the product.

All additional agents become future enhancements rather than MVP requirements.

## Strategic Implication

The next major development priority is not additional agent creation.

F4 Project Intelligence is complete. The next major development priority is Phase G: Pursuit Management & Project Workspace.

Opportunity Discovery -> Project Intelligence -> Qualification -> Add to Calendar -> Project Workspace is the core MVP loop.

Everything else is secondary.

## Forward UX Direction

The next product architecture layer is documented in `docs/initiatives/f5-opportunity-project-workspace.md`.

That initiative keeps the validated Opportunity Intelligence pipeline but changes the user-facing workflow over time:

- Baseline intelligence should be prepared automatically during ingestion.
- Users should no longer need to click `Analyze Project` to see a useful first project overview.
- Opportunity Discovery and Project Execution should be clearly separated.
- Opportunity pages should use `Overview`, `Documents`, and `Intelligence` tabs.
- Project Workspaces should use operational tabs such as `Overview`, `Bid Readiness`, `Documents`, `Intelligence`, `Addenda`, `Activity`, `Subcontractors`, `Estimate`, and `Proposal`.
- Bid line items should become first-class project data rather than being buried in narrative intelligence.

The MVP document remains the historical strategy source for the F1-F4 validation loop. F5 — Opportunity & Project Workspace is the forward product experience built on top of that foundation.
