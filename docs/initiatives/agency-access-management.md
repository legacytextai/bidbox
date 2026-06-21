# BidBox Initiative: Agency Access Management

Status: Planned  
Priority: Strategic Scaling Initiative  
Phase: F2A, post-MVP / future roadmap  
Date: June 2026

## Executive Summary

Agency Access Management is BidBox's future system for tracking, maintaining, and automating access to agency procurement portals and gated bid documents.

During F2 Document Acquisition, BidBox discovered that portal login alone is often not enough. Agencies may require vendor registration, prospective bidder registration, plan holder registration, communication preferences, or agency-specific form answers before documents can be downloaded.

BidBox implemented enough PlanetBids-specific prospective bidder automation to validate the core F2 document acquisition path. It did not implement durable agency registration tracking, registration memory, contractor-owned portal credentials, a coverage dashboard, or a human escalation system.

Those capabilities are intentionally deferred into F2A — Agency Access Management. They are strategically important, but they are not required to validate the current Opportunity Intelligence MVP hypothesis:

> Can BidBox help contractors find better projects and understand them faster?

## Cross-References

- F2 Document Acquisition: `docs/agent-architecture-task-list.md`, section `7.2. F2 — Document Acquisition`
- F2A Agency Access Management: `docs/agent-architecture-task-list.md`, section `7.2A. F2A — Agency Access Management`
- Opportunity Intelligence MVP: `docs/initiatives/opportunity-intelligence-mvp.md`
- Opportunity Intelligence Implementation Plan: `docs/initiatives/opportunity-intelligence-implementation-plan.md`
- Master Plan: `docs/masterplan.md`, section `Agency Access Management`

## Background

The original document acquisition objective was simple:

```text
Opportunity Found
↓
Download Documents
↓
Generate Intelligence
```

Testing showed that many public agencies add another access layer:

```text
Opportunity
↓
Registration Requirement
↓
Document Access
```

The team needed to determine whether BidBox could automate this access layer well enough to acquire source bid packages for Project Intelligence.

## Discovery Process

Multiple PlanetBids agencies were tested manually.

Examples included:

- City of Newport Beach
- City of Santa Ana
- Various additional PlanetBids agencies

The investigation focused on:

1. Whether registration was required.
2. Whether registration could be automated.
3. Whether registration was standardized across agencies.
4. Whether BidBox or the contractor should be the registered entity.

## What We Found

### Registration Flows Are Not Uniform

Even when agencies use the same platform, registration requirements vary significantly.

Observed examples:

Agency A required:

- Company name
- Email address

Agency B required:

- Company information
- Vendor categories
- Terms acceptance

Agency C required:

- User information
- Phone number
- Alternate email
- Referral source
- Categories
- Terms acceptance

Other agencies required:

- Bidder classification
- Status selection
- Communication preferences
- Custom agency-specific questions

Result:

```text
PlanetBids
+
Agency Customizations
=
Non-Uniform Registration Experience
```

There is no universal registration form.

### Registration Is Often Durable

Registration appears to be generally a one-time event:

```text
Agency
↓
Register Once
↓
Future Access Works
```

The primary friction is first-time access. Once an account is registered for an agency or solicitation, future document acquisition becomes easier.

This discovery is the foundation for a future registration memory and agency access coverage system.

## Current Implemented Behavior

BidBox implemented a practical PlanetBids document-access solution as part of F2 Document Acquisition.

Current behavior:

```text
Document Request
↓
Manifest Access Attempt
↓
403 Response or Prospective Bidder Gate
↓
Become Prospective Bidder
↓
Retry Manifest
↓
Download Documents
```

The PlanetBids acquisition driver currently:

- Detects prospective bidder requirements.
- Opens the prospective bidder workflow.
- Selects known safe values when needed:
  - `Classification = Other`
  - `Status = Non-Bidder, receive communications`
- Submits the prospective bidder registration.
- Retries document manifest retrieval.
- Continues acquisition automatically.

This capability exists today and is part of F2 Document Acquisition.

## Current Registration Strategy

When solicitation-level registration is required, the shared BidBox automation account currently uses:

```text
Classification: Other

Status:
Non-Bidder, receive communications
```

The intent is to:

- Gain document access.
- Receive project communications.
- Avoid representing BidBox as an actual bidding contractor.
- Minimize pollution of prospective bidder lists.

This strategy successfully enabled F2 production validation.

However, the actual public visibility implications remain unverified.

Open question:

```text
Does "Non-Bidder, receive communications"
prevent BidBox from appearing on public
prospective bidder lists?
```

This should be researched later.

## Deferred Functionality

BidBox has not implemented:

- Agency registration memory.
- Agency access records.
- Registration status tracking.
- Coverage dashboard.
- Human escalation workflow.
- Contractor-specific registration.
- Registered-agency cache.
- Registration verification system.
- Bidder visibility management.
- Customer-owned portal credential storage.

These are future Agency Access Management capabilities, not current F2 functionality.

## Why This Was Deferred

The Opportunity Intelligence MVP is currently focused on validating whether BidBox can help contractors:

1. Discover relevant public works opportunities.
2. Select interesting opportunities for analysis.
3. Acquire and process project documents.
4. Generate useful Project Intelligence.
5. Decide faster whether a project deserves attention.

The core product hypothesis is:

> Can BidBox help contractors find better projects and understand them faster?

Agency Access Management improves scale, reliability, and long-term portal coverage, but it is not required to validate that hypothesis.

F2 production validation proved that BidBox can acquire documents through the PlanetBids path using a shared automation account and solicitation-level prospective bidder registration. That is sufficient for the current MVP path:

```text
Opportunity Discovery
→ Analyze Project
→ Document Acquisition
→ Document Processing
→ Project Intelligence
```

Building full agency access management now would add:

- New persistent state models.
- Human escalation workflows.
- Customer-specific credential security.
- Registration memory logic.
- Agency coverage UI.
- More portal-specific edge cases.

Those are valuable, but they would slow validation of F4 Project Intelligence and beta-user learning.

Therefore:

```text
Registration automation beyond basic document access
is intentionally deferred.
```

## Strategic Question: Who Should Be Registered?

### Option A — BidBox Registers

```text
BidBox
↓
Registers
↓
Downloads Documents
```

Benefits:

- Easier automation.
- Shared infrastructure.
- Faster onboarding.
- Consistent acquisition workflow.

Drawbacks:

- BidBox may appear on bidder lists.
- Contractor may not appear.
- Potential confusion regarding bidder identity.

### Option B — Contractor Registers

```text
Contractor
↓
Registers
↓
Downloads Documents
```

Benefits:

- Contractor receives agency notifications.
- Contractor appears as actual interested bidder.
- Better alignment with procurement workflow.

Drawbacks:

- Registration complexity increases dramatically.
- Agency-specific forms must be handled.
- Customer-specific data becomes required.
- Automation becomes substantially harder.

## Future F2A Roadmap

Future scope may include:

```text
Agency Access Management
├── Registration Agent
├── Registration Memory
├── Agency Access Records
├── Coverage Dashboard
├── Human Escalation
├── Contractor Registration
├── Registration Verification
└── Bidder Visibility Management
```

### Registration Agent

Purpose: automate agency/vendor/prospective-bidder registration where confidence is high.

Future behavior:

- Detect agency/vendor registration gates.
- Detect prospective bidder or plan holder gates.
- Complete known fields from BidBox internal data or, later, contractor Bid Profile data.
- Select known dropdown values and communication preferences.
- Submit forms only when confidence is sufficient.
- Keep portal-specific registration logic inside the relevant driver.

### Registration Memory System

Purpose: store non-secret answers and field metadata so future registrations become easier.

Future behavior:

- Store agency/portal ID, field labels, field types, selected answers, confidence, and source.
- Reuse prior answers for similar agency workflows.
- Distinguish deterministic answers, human-supplied answers, and agent inferences.

### Human Escalation Workflow

Purpose: pause automation when a required field cannot be answered confidently.

Future behavior:

- Create internal registration tasks.
- Show agency name, portal type, field requiring input, available options, and suggested answer.
- Resume registration after a human supplies the answer.
- Persist the answer into registration memory.

### Agency Access Coverage Dashboard

Purpose: show where BidBox has, lacks, or cannot verify agency access.

Future behavior:

- Track registered agencies.
- Track unregistered agencies.
- Track agencies requiring registration.
- Track blocked registrations.
- Track human-input-required states.
- Track last access verification.
- Track document acquisition success/failure by agency.

Example:

```text
Agency Access Coverage
72 / 104 agencies registered
```

### Bid Profile Agency Registration Management

Purpose: eventually allow customers to manage contractor-specific portal access and registration preferences.

Future settings may include:

- Register as Bidder.
- Register as Non-Bidder.
- Receive Communications.
- Do Not Receive Communications.
- Prime Contractor.
- Subcontractor.
- Supplier.
- Other.

This should remain Phase 2+ until contractor-owned portal credential architecture is secure.

### BidBox Internal Agency Registration Network

Purpose: treat each successful BidBox agency registration as durable internal platform coverage.

Each successful registration improves:

- Document coverage.
- Project Intelligence success rates.
- Addenda monitoring.
- Customer onboarding speed.
- Future portal reliability.

## Potential Future Schema

These are future concepts only. They are not implemented in the current database schema.

### `agency_access_records`

Purpose: durable record of BidBox or contractor access status for an agency portal.

Potential fields:

- `id`
- `agency_id` or `opportunity_source_id`
- `portal_type`
- `portal_url`
- `access_status`
- `registration_status`
- `last_checked_at`
- `last_successful_access_at`
- `blocker_reason`
- `owner_type` such as `bidbox_internal` or contractor account
- `registered_at`
- `last_verified_at`
- `registration_method`
- `notes`

Potential statuses:

```text
registered
not_registered
needs_registration
registration_failed
blocked
unknown
verified_document_access
```

### `agency_registration_memory`

Purpose: reusable non-secret memory for agency registration fields and answers.

Potential fields:

- `id`
- `agency_id` or `portal_id`
- `field_label`
- `field_type`
- `selected_answer`
- `confidence_score`
- `source` such as `bid_profile`, `human_response`, or `agent_inference`
- `created_at`
- `updated_at`

Security boundary:

- Do not store portal passwords.
- Do not store bearer tokens.
- Do not store sensitive credential material.

### `agency_registration_tasks`

Purpose: human escalation queue for ambiguous or blocked registration flows.

Potential fields:

- `id`
- `agency_id` or `opportunity_source_id`
- `portal_type`
- `field_label`
- `field_type`
- `available_options`
- `suggested_answer`
- `status`
- `resolution`
- `resolved_by`
- `created_at`
- `resolved_at`

## Potential Long-Term Workflow

```text
Opportunity Found
↓
Agency Access Check
↓
Already Registered?
       ↓
      Yes
       ↓
Acquire Documents

      No
       ↓
Register
       ↓
Store Registration Memory
       ↓
Acquire Documents
```

## Open Research Questions

### Prospective Bidder Visibility

1. Should BidBox appear on prospective bidder lists at all?
2. Does `Non-Bidder, receive communications` suppress public visibility?
3. Do agencies treat `Non-Bidder` differently in public bidder or plan holder lists?
4. Are there portal-specific differences in how registration status is displayed?

### Contractor vs BidBox Registration

1. Should contractor-specific registration eventually be supported?
2. Should BidBox continue using an internal automation account for early document acquisition?
3. Is there a hybrid approach where BidBox acquires documents while contractors separately maintain bidder status?
4. When should contractor-owned portal credentials become part of onboarding?

### Registration Memory

1. Is registration memory valuable enough to justify dedicated infrastructure?
2. Which form answers can be safely reused across agencies?
3. Which answers must remain contractor-specific?
4. How should confidence and human-reviewed answers be represented?

### Agency Coverage Tracking

1. Should BidBox maintain durable agency registration records?
2. Should Agency Access Management become a standalone subsystem?
3. What coverage threshold matters for beta customers?
4. Should agency access status appear in source ledgers, internal dashboards, or customer-facing UI?

## Current Conclusion

BidBox has already solved the document access problem sufficiently for MVP validation.

Agency Access Management is not currently blocking:

- F4 Project Intelligence.
- F5 Qualification.
- Beta testing.
- Customer validation.

Therefore:

**F2A — Agency Access Management remains a strategic future initiative, not an MVP dependency.**
