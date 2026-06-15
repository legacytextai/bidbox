# BidBox Initiative: Opportunity Intelligence MVP

Status: Proposed  
Date: June 2026

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

For the MVP, `Add to Calendar` is the only action needed after qualification.

If an estimator adds a project to the calendar, that is the signal that the project is worth tracking.

## MVP Success Criteria

A contractor can:

1. Discover relevant public works opportunities.
2. Select interesting opportunities.
3. Receive an AI-generated intelligence report.
4. Understand whether a project is worth pursuing.
5. Add selected opportunities to the calendar.

If BidBox accomplishes these five outcomes, the MVP has successfully validated the product.

All additional agents become future enhancements rather than MVP requirements.

## Strategic Implication

The next major development priority is not additional agent creation.

The next major development priority is Project Intelligence.

Opportunity Discovery -> Project Intelligence -> Qualification -> Add to Calendar is the core MVP loop.

Everything else is secondary.
