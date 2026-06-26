# F5 — Opportunity & Project Workspace

Status: Planned
Date: June 2026
Execution task list: `docs/initiatives/f5-opportunity-project-workspace-task-list.md`

## Executive Summary

This initiative redesigns BidBox around the real workflow of a public works estimating department.

Earlier Opportunity Intelligence work proved the AI and acquisition pipeline: discovery, source document acquisition, document processing, Project Intelligence reports, citations, and the first Project Workspace bridge. The next product step is to make that intelligence feel like an operating system rather than a collection of AI-generated reports.

The redesign introduces a clear separation between:

- Opportunity Discovery: browsing potential projects and deciding whether they belong on the bid calendar.
- Project Execution: managing active pursuits and preparing bids.

This separation keeps the first project experience clean and fast while preserving deeper AI-powered workspaces after the user chooses to track a project.

## Problem Statement

As BidBox has evolved, the application has become increasingly centered around AI-generated reports rather than estimator workflows.

Current pain points:

- Project pages are visually crowded.
- AI reports contain more information than is needed for initial project review.
- Information hierarchy is weak.
- Every project currently requires an explicit `Analyze Project` action before useful intelligence becomes available.
- Users can wait two to five minutes before seeing meaningful project context.
- Important facts compete with secondary intelligence.
- Users must scroll through long reports to decide whether a project is worth considering.
- Bid readiness, intelligence, documents, project metadata, and pursuit actions compete for space.
- AI capabilities are displayed as report sections instead of organized into dedicated workspaces.
- Bid line items are not yet treated as first-class project overview data, even though they are one of the fastest ways to understand scope.

The underlying intelligence is becoming more capable, but the user experience is becoming too complex. This initiative corrects that.

## Product Philosophy

Previous philosophy:

```text
AI generates reports for projects.
```

New philosophy:

```text
AI quietly prepares workspaces that help users make decisions.
```

Users should not feel like they are reading raw AI output. They should feel like they are working inside an operating system purpose-built for public works estimating.

## Core Mental Model

Estimating departments perform two fundamentally different jobs.

### Stage 1: Opportunity Discovery

Primary user: Estimating Coordinator
Primary objective: Fill the bid calendar with viable opportunities.
Core question: Is this project worth putting on our bid calendar?

This stage is intentionally lightweight. The user is browsing opportunities, not managing an active bid.

### Stage 2: Project Execution

Primary user: Lead Estimator
Primary objective: Prepare and execute a winning bid.
Core question: How do we win this project?

Once a project enters this stage, deeper intelligence, readiness, subcontractor, estimate, addenda, and proposal tools become available.

## New End-to-End Workflow

```text
Nightly Refresh / Refresh Now
-> Automatic Acquisition
-> Automatic Opportunity Intelligence
-> Opportunity Cards
-> User Clicks Project Card
-> Project Overview
-> Add to Calendar
-> My Projects
-> Project Workspace Activated
-> Estimator Reviews
-> Pursuit Decision
-> Bid Preparation
-> Proposal Submission
```

## Automated Opportunity Refresh

F5 should move BidBox from user-triggered discovery toward an automatically prepared opportunity pipeline.

Long-term default workflow:

```text
Nightly scheduled scan
-> Agency/source refresh
-> New opportunities discovered
-> Documents acquired
-> Bid items extracted
-> Opportunity Intelligence generated
-> Opportunities tab updated before the user starts work
```

The Opportunities page should feel like:

```text
Here are today's prepared opportunities.
```

not:

```text
Click Scan to begin finding work.
```

Manual scanning should become a secondary action such as `Refresh Now` or `Check For New Opportunities`. It should run the same refresh pipeline immediately instead of waiting for the next scheduled run.

### Phase 1 Implementation Note

The initial F5 foundation implements this as an additive lifecycle and refresh layer:

* scheduled refresh queues existing portal scan tasks through `agent_tasks`
* manual scan is reframed as `Refresh Now`
* scan tasks refresh portal-owned metadata for existing opportunities instead of behaving as insert-only
* new opportunities automatically queue Opportunity Intelligence preparation
* source and opportunity refresh diagnostics are persisted for operational visibility

## Opportunity Intelligence vs Project Intelligence

F5 separates intelligence into two tiers.

### Tier 1: Opportunity Intelligence

Opportunity Intelligence runs automatically for newly discovered or materially changed opportunities.

Purpose:

```text
Support Opportunity Discovery.
```

Core question:

```text
Is this project worth putting on the bid calendar?
```

Outputs:

- Project Snapshot
- Executive Summary
- Key Dates
- Bid Items / Line Items
- Important Requirements
- Quick Facts
- Document readiness
- Opportunity readiness status

This tier should be lightweight, uniform, and suitable for the Opportunities page and Opportunity Overview.

### Tier 2: Project Intelligence

Project Intelligence runs after the estimator adds an opportunity to the calendar.

Purpose:

```text
Support Project Execution.
```

Core question:

```text
How do we win this project?
```

Outputs:

- Full detailed intelligence report
- Deeper risk analysis
- Contract highlights
- Procurement notes
- Bid readiness extraction
- Compliance requirements
- Proposal preparation inputs
- Estimate preparation inputs
- Subcontractor / coverage inputs where applicable

`Add to Calendar` activates or enables this deeper project-level intelligence. Opportunity Intelligence prepares the opportunity for review. Project Intelligence prepares the project for pursuit.

## Future Architecture: Continuous Project Monitoring

While Opportunity Intelligence prepares opportunities for evaluation and Project Intelligence prepares projects for execution, BidBox is ultimately designed to become a continuously operating project assistant.

Once a project has been added to My Projects, the platform should continue working on behalf of the estimator without requiring manual intervention.

This introduces a third stage in the BidBox lifecycle:

```text
Opportunity Discovery
-> Project Execution
-> Continuous Project Monitoring
```

Unlike Opportunity Intelligence, which runs automatically during opportunity ingestion, or Project Intelligence, which activates when a project is added to the calendar, Continuous Project Monitoring operates throughout the life of an active pursuit.

The monitoring pipeline should periodically evaluate active projects for new information and trigger the appropriate agents as needed.

Potential responsibilities include:

- Detect newly issued addenda.
- Download and acquire new project documents.
- Update document indexes and knowledge.
- Re-run Bid Readiness when requirements change.
- Refresh Project Intelligence when significant project information changes.
- Notify estimators of meaningful changes requiring attention.
- Maintain an up-to-date view of project status throughout the pursuit.

Initially, the highest-value capability will be the Addenda Agent.

On a scheduled basis, for example nightly, the Addenda Agent should revisit active projects, determine whether new addenda have been published, acquire any new documents, and trigger downstream processing where appropriate.

A typical monitoring workflow may resemble:

```text
Scheduled Monitoring
-> Check Active Projects
-> Detect New Addenda
-> Acquire New Documents
-> Update Knowledge Layer
-> Refresh Project Intelligence
-> Refresh Bid Readiness
-> Notify Estimator
```

This capability is intentionally out of scope for the F5 MVP.

However, the F5 architecture should be designed so that Continuous Project Monitoring can be added without requiring significant changes to the Opportunity Discovery or Project Workspace models.

The long-term vision is for BidBox to evolve from a system that prepares projects once into a platform that continuously maintains project readiness throughout the entire bidding lifecycle.

## Product Area 1: Opportunity Discovery

The Opportunities page should become a lightweight project discovery experience.

Its responsibility is not to prepare bids. Its responsibility is to help users identify projects worth evaluating further.

### Opportunity Cards

Opportunity cards should provide enough information to encourage opening the project.

Suggested card fields:

- Project Name
- Agency
- Bid Date
- Location
- Estimated Value
- Trade / Category
- High-level Scope
- Document Status
- Intelligence Status

The card should answer:

```text
Should I open this project?
```

### Opportunity Project View

When the user clicks an opportunity card, they should land on a simple project dossier, not the full Project Workspace.

Suggested top-level layout:

```text
Project Name

Agency
Bid Date
Estimated Value
Location

[ Add to Calendar ]

Overview | Documents | Intelligence
```

Only three tabs should exist at the Opportunity stage:

- Overview
- Documents
- Intelligence

This keeps discovery simple while preserving access to source documents and deeper analysis.

## Opportunity Overview Tab

The default Opportunity tab should be `Overview`.

The page should feel spacious, calm, and predictable. It should be closer to a clean project fact sheet than a report.

Every project should follow the same structure:

1. Project Snapshot
2. Executive Summary
3. Key Dates
4. Bid Items / Line Items
5. Important Requirements
6. Quick Facts
7. Add to Calendar action

If something is unknown, display `N/A` or `Not identified`. Do not remove the section. Consistency is more important than cleverness.

### Project Snapshot

Suggested fields:

- Project Name
- Agency
- Solicitation ID
- Location
- County
- Estimated Value
- Bid Date
- Pre-Bid / Job Walk Date
- Pre-Bid Status
- Source Portal
- Status

This section should be concise and scannable.

### Executive Summary

The Executive Summary should be short.

Target length:

- 1 to 3 short paragraphs
- No long report-style analysis
- No citations visible on the main Overview unless needed
- No excessive AI explanation

Purpose:

```text
Help the user understand what the project is.
```

Not:

```text
Explain every project risk and contract nuance.
```

## Bid Items / Line Items

Bid items must become first-class project overview data.

Bid items help answer:

- What is the actual scope?
- What trades are involved?
- How large is the project?
- Is this our kind of work?
- Are there specialty items?
- Does the work align with our estimating capabilities?
- Is this a heavy civil, building, electrical, paving, utility, or specialty project?
- Are quantities meaningful enough to pursue?

For an estimating coordinator, bid items may be more useful than a long AI narrative. They are concrete, familiar, and fast to scan.

### Opportunity Overview Display

Recommended behavior:

- Show the first 8 to 15 bid items by default.
- Use one uniform display format across all portals.
- Recommended columns: Quantity, Unit, Item Description.
- Store Item Number and Item Code, but do not let each portal produce a different overview format.
- Preserve original source ordering.
- Group by section if the portal provides grouping.
- If no structured bid items are available, show `No structured bid items found.`
- If bid items are inferred from documents, label them as extracted from documents.

Suggested overview table:

```text
Bid Items

Qty        Unit        Item / Description
1          LS          Mobilization and Demobilization
45         LF          Sawcut and Remove Existing PCC Curb
290        SF          Remove and Reconstruct PCC Sidewalk
1          LS          Traffic Signal and Safety Lighting
```

### Project Workspace Display

Near-term approach:

- Keep bid items on the Project Workspace Overview.
- Also make them available inside the future Estimate tab.
- Do not hide them only in Intelligence.
- Do not bury them only inside Documents.

Bid items are core project data, not merely AI findings.

## Bid Item Acquisition Requirements

Portal drivers should attempt to collect bid line items during portal navigation.

### PlanetBids Line Item Extraction

For PlanetBids opportunities, the driver should:

1. Open the opportunity detail page.
2. Capture standard opportunity metadata.
3. Navigate to the Line Items tab.
4. Extract visible line item rows.
5. Preserve section grouping where applicable.
6. Store extracted line items in structured form.
7. Continue to document acquisition.
8. Continue to intelligence generation.

Expected fields:

- Source portal
- Source opportunity ID
- Section name / section number
- Item number
- Item code
- Description
- Unit of measure
- Quantity
- Reference
- Unit price, if available
- Raw row text
- Extraction source
- Extraction timestamp

### Caltrans / Other Portal Line Item Extraction

For portals such as Caltrans that expose structured bid item tables, each driver should map source-specific fields into a normalized BidBox line item structure.

## Suggested Data Model

Create a dedicated table for bid line items.

Suggested table:

```text
opportunity_bid_items
```

Suggested columns:

```text
id
opportunity_candidate_id
opportunity_document_id
source_portal
source_opportunity_id
section_name
section_number
item_number
item_code
description
unit_of_measure
quantity
reference
unit_price
raw_text
extraction_method
extraction_status
source_url
extracted_at
created_at
updated_at
```

Notes:

- `opportunity_candidate_id` ties line items to the opportunity before it becomes a project.
- `opportunity_document_id` can point to a source document when line items come from document extraction.
- `extraction_method` may be `portal_tab`, `document_ai`, `manual`, or `import`.
- `raw_text` preserves original source text for debugging.
- The model should not assume every portal has the same columns.
- The display layer should handle missing values gracefully.

## Line Item Extraction Priority

Priority order:

1. Portal-native structured line items
2. Structured tables inside bid documents
3. AI-extracted scope/bid items from documents
4. Summary-only fallback

Portal-native structured line items should be preferred because they are usually cleaner, more reliable, and closer to the official bid schedule.

## Eliminate Analyze Project Workflow

The current user-facing `Analyze Project` workflow should be removed over time.

Current:

```text
Open Project
-> Analyze Project
-> Wait
-> Read Report
```

Future:

```text
Nightly refresh or Refresh Now
-> Automatic Opportunity Intelligence
-> Open Project
-> Immediate Overview
```

Users should not need to wait for the first useful project summary. Opportunity Intelligence should be generated during automated refresh and ingestion.

## Automatic Opportunity Intelligence

When a project is scanned and acquired, BidBox should automatically generate:

- Project Snapshot
- Executive Summary
- Key Dates
- Bid Items / Line Items
- Important Requirements
- Basic scope classification
- Initial NAICS/trade classification where possible
- Document availability status
- Opportunity Intelligence status

This becomes the minimum viable opportunity review package. The deeper Project Intelligence package should activate after Add to Calendar.

## Add to Calendar

`Add to Calendar` becomes the transition between discovery and execution.

It represents:

```text
We believe this project is worth spending estimating resources on.
```

The Opportunity stage is mostly read-only and evaluative. The Project stage is operational.

Important distinction:

- `Add to Calendar` means the project is worth tracking.
- `Pursuing` means the estimator has greenlit the project as an active bid.

These are not the same decision.

## Product Area 2: My Projects

Projects added to the calendar appear within My Projects.

This area is no longer an opportunity browser. It becomes the estimator's operational workspace.

## Project Workspace

Suggested workspace tabs:

```text
Overview
Bid Readiness
Documents
Intelligence
Addenda
Activity
Subcontractors
Estimate
Proposal
```

Each tab is a dedicated workspace. No tab should become an all-purpose dumping ground.

## AI Architecture Mapping to Workspace Tabs

### Overview

Generated by: Opportunity Intelligence Agent
Purpose: Create the lightweight executive briefing that helps the user quickly understand the project.

Includes:

- Project Snapshot
- Executive Summary
- Key Dates
- Bid Items summary
- Important Requirements
- Quick Facts

### Documents

Managed by: Document Layer
Purpose: Store, organize, search, and display project documents.

Includes:

- Plans
- Specifications
- Addenda
- Bid forms
- Reference documents
- Download all
- Document status
- Document search
- Document viewer

### Intelligence

Produced by: Knowledge Layer
Purpose: Hold the full AI-generated intelligence report and supporting citations.

Includes:

- Full project analysis
- Risks
- Contract highlights
- Procurement notes
- Scope observations
- Agency notes
- Engineer notes
- Funding notes
- Citations
- Source references

### Bid Readiness

Owned by: Qualification / Bid Readiness Agents
Purpose: Determine whether the company is ready to submit a compliant bid.

Includes:

- Bid bond
- Performance bond
- Payment bond
- Insurance
- License requirements
- DIR / registration requirements
- Required forms
- Mandatory pre-bid meeting
- Addenda acknowledgment
- Submission checklist
- Readiness score
- Missing items

### Proposal

Owned by: Proposal Agent
Purpose: Assist with final bid package preparation.

### Estimate

Owned by: Estimating Agent
Purpose: Support quantity review, bid item preparation, and estimating workflows.

### Subcontractors

Owned by: Coverage Agent
Purpose: Help identify, organize, and track subcontractor coverage.

## Opportunity vs Project Tab Strategy

Opportunity stage tabs:

```text
Overview
Documents
Intelligence
```

Purpose: Evaluate.

Project stage tabs:

```text
Overview
Bid Readiness
Documents
Intelligence
Addenda
Activity
Subcontractors
Estimate
Proposal
```

Purpose: Execute.

## Overview Page Design Principles

The Overview page should be extremely simple.

Model inspiration:

- BidAmerica for layout density and simplicity.
- PlanetBids for tab-based navigation.
- BidBox's own AI architecture for workspace ownership.

Visual requirements:

- Generous whitespace
- Clear section headings
- Predictable section ordering
- Minimal badges
- Minimal color
- No crowded cards
- No long AI report blocks
- No excessive nested containers
- No side-by-side overload unless it improves clarity

## Intelligence Tab Design

The full intelligence report should move out of the main Overview.

The Intelligence tab can include:

- Full structured report
- Findings
- Citations
- Risk notes
- Contract requirements
- Source references
- Confidence warnings
- Missing information
- Document-derived reasoning

This keeps the Overview lightweight while preserving deeper value.

## Documents Tab Design

The Documents tab should include:

- List of acquired documents
- File type
- Source
- Upload/acquisition status
- Download/open action
- Document search
- Addenda identification
- Future document viewer

This tab is managed by the Document Layer. It should not become a second intelligence report.

## Bid Readiness Tab Design

Bid Readiness should answer:

```text
Are we ready to submit this bid?
```

Suggested sections:

- Required bid forms
- Bonds
- Insurance
- Contractor license
- DIR / public works registration
- Addenda acknowledgment
- Mandatory pre-bid/job walk
- Submission method
- Submission deadline
- Missing items
- Readiness status

Possible readiness states:

```text
Not Ready
Needs Review
Ready to Bid
```

## Pursuit Status

Within the Project Workspace, introduce a project-level pursuit control.

Possible states:

```text
Reviewing
Pursuing
Passed
```

or:

```text
Not Reviewed
Pursuing
Not Pursuing
```

This status should propagate to Calendar, Dashboard, My Projects, upcoming bids, notifications, pipeline reporting, and future subcontractor/proposal workflows.

## Data / State Model Changes

This initiative likely requires lifecycle state refinements.

Suggested conceptual states:

```text
discovered
opportunity_intelligence_ready
added_to_calendar
project_intelligence_ready
reviewing
pursuing
passed
submitted
```

Potential fields:

```text
opportunity_intelligence_status
opportunity_intelligence_ready_at
project_intelligence_status
project_intelligence_ready_at
added_to_calendar_at
added_to_calendar_by
pursuit_status
pursuit_status_updated_at
pursuit_status_updated_by
bid_items_status
bid_items_extracted_at
```

These may live on existing opportunity/project tables or new related tables depending on final implementation.

## Opportunity Intelligence vs Project Intelligence

### Opportunity Intelligence

Required before the user opens the project.

Supports:

- Opportunity card
- Opportunity Overview
- Add to Calendar decision

Includes:

- Snapshot
- Summary
- Dates
- Bid items
- Requirements
- Quick facts

### Project Intelligence

Runs after Add to Calendar and can be more thorough.

Supports:

- Intelligence tab
- Bid Readiness
- Estimator review
- Future proposal and estimating workflows

Includes:

- Detailed findings
- Citations
- Contract risks
- Procurement requirements
- Scope details
- Missing information
- Document-level references

## Implementation Phases

1. Documentation and product specification.
2. Remove Analyze Project from the user workflow.
3. Bid Line Item Extraction.
4. Opportunity Overview Redesign.
5. Add to Calendar Transition.
6. Project Workspace Tabs.
7. Bid Readiness MVP.
8. UI Polish and Visual Simplification.

The detailed engineering task list lives in `docs/initiatives/f5-opportunity-project-workspace-task-list.md`.

## Documentation Updates

This initiative should be referenced, not duplicated, from:

- `docs/masterplan.md`
- `docs/tasks.md`
- `docs/agent-architecture-task-list.md`
- `docs/initiatives/opportunity-intelligence-mvp.md`
- `docs/initiatives/opportunity-intelligence-implementation-plan.md`

Future data model documentation should include `opportunity_bid_items`, lifecycle fields, Opportunity Intelligence status, Project Intelligence status, pursuit status, and calendar transition metadata. Until a formal schema document exists, those concepts are documented here.

## Future Design System Document

Create later:

```text
docs/design-system.md
```

Purpose:

- Spacing
- Typography
- Card patterns
- Tabs
- Tables
- Badges
- Empty states
- Page hierarchy
- Visual density rules

## Success Criteria

This initiative is successful when:

- A first-time user can understand any project within 30 seconds.
- Users never need to click `Analyze Project` to get Opportunity Intelligence.
- Opportunity Discovery and Project Execution are clearly separated.
- The Overview page remains concise regardless of project complexity.
- Bid items are extracted and displayed as first-class project data.
- Advanced AI capabilities are available without cluttering the primary workflow.
- Every project follows an identical visual structure.
- Each major AI capability has a dedicated workspace tab.
- Bid Readiness is accessible as an operational tool, not buried in a report.
- Project pursuit status is clear and actionable.
- BidBox feels like a workflow operating system rather than a collection of AI-generated reports.

## Final Product Direction

BidBox should not compete by showing more AI on the screen.

BidBox should compete by using AI to make the estimating workflow simpler.

The product should feel calm, structured, and obvious. The user should open a project and immediately know:

- What the project is
- When it bids
- Where it is
- What the work includes
- What the major bid items are
- Whether it belongs on the calendar
- Where to go next

Everything else belongs in the right tab, at the right stage, for the right user.
