# BidBox Complete Documentation

> **Generated**: 2025-12-21  
> **Purpose**: Single-file reference for AI agents and external tools  
> **Usage**: Download and paste into ChatGPT, Claude, or other AI assistants for full project context

---

## Table of Contents

1. [Masterplan](#masterplan)
2. [Tasks](#tasks)
3. [GC Control Center PRD](#gc-control-center-prd)
4. [Implementation Plan](#implementation-plan)
5. [Design Guidelines](#design-guidelines)
6. [App Flow - Pages and Roles](#app-flow-pages-and-roles)
7. [BidBox BrandScript](#bidbox-brandscript)
8. [CSLB License Types](#cslb-license-types)
9. [Admin KPI Panel Plan](#admin-kpi-panel-plan)
10. [Admin KPI Tasks](#admin-kpi-tasks)
11. [Stripe Integration Steps](#stripe-integration-steps)
12. [Stripe Tasks](#stripe-tasks)
13. [Bug Prompt Template](#bug-prompt-template)
14. [Bug Reports](#bug-reports)

---

# Masterplan

## BidBox – Master Plan

---

### 🚀 30-Second Elevator Pitch

BidBox is the **GC Control Center** — a fast, no-fluff operating system for preconstruction.  
Create a project, upload plans, select required trades, share a public link, and generate call lists from two subcontractor pools — all designed for bid day urgency.  
No bloat. No sub logins. Just clarity, organization, and action.

---

### 🔧 Problem & Mission

**Problem:**    
Small GCs and public works estimators waste hours chasing subcontractor bids using Dropbox, email, and spreadsheets.    
Procore and BuildingConnected are overbuilt and overpriced. Subs ignore logins.  
The real pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, coverage, and compliance**.

**Mission:**    
Give GCs a fast, no-login tool that makes them more informed, organized, and effective on bid day — not by replacing phone calls, but by making them smarter.

---

### ⭐ GC Control Center Direction (NEW)

BidBox is evolving from a "simple bid room" into the **GC Control Center**:

**Guiding Principles:**
1. **Do not replace phone calls — empower them.** GCs close gaps by calling subs. BidBox surfaces insights that make calls more efficient.
2. **Subs must experience zero friction.** No logins. No portals. Just: Click link → View plans → Upload quote.
3. **Clarity beats features.** Immediate visibility into trades needed, sub coverage, engagement status, and gaps.
4. **Local specialization is the wedge.** California public works, license-type filtering, curated SoCal directories.

**Four Pillars:**
- **Trade Intelligence**: Select required trades, view coverage heatmap, know where risks are
- **Subcontractor Organization**: Two-pool architecture (Private + Network), map subs to trades
- **Engagement Visibility**: Track views, downloads, submissions, follow-up needs
- **Bid-Day Command Center**: Auto-generated call lists, coverage meters, compliance reminders

See `docs/gc-control-center-prd.md` for full strategic PRD.

---

### 🎯 Target Audience

- Small to mid-size general contractors    
- Public works estimators    
- Subs responding to GC bid rooms (no login, no accounts)

---

### 🧩 Core Features

**MVP Features (Current):**
- GC login + dashboard  
- Create new bid project  
- Upload plans/specs (PDFs)  
- Auto-generate public bid link (`/bid/[token]`)  
- Public bid page with project info + countdown + upload form  
- GC project admin panel with:  
  - Edit metadata  
  - Upload/delete documents  
  - View/download bids  
- All file storage via Supabase (not Lovable file system)

**Control Center Features (New):**
- **Trade Selection**: Select required license types when creating projects (C-10 Electrical, C-20 HVAC, etc.)
- **Two-Pool Subcontractor Architecture**:
  - GC's Private Pool: Subs the GC has personally added
  - BidBox Network Pool: Curated, verified subcontractors
- **Call List Generator**: Excel export grouped by trade, sorted by engagement priority
- **Engagement Tracking**: Views, downloads, submissions per subcontractor
- **Coverage Intelligence**: Visual indicators showing which trades have coverage

---

### 🛠️ High-Level Tech Stack

- **Frontend:** React + TypeScript + shadcn/ui + Tailwind CSS    
- **Backend:** Supabase (Postgres + Storage + Auth)    
- **Auth:** Email/password for GCs only    
- **File Storage:** Supabase Storage    
- **Public Links:** Secure `/bid/[token]` pages for subs    
- **Export:** Download all bids (ZIP or CSV)    
- **No sub accounts, no email/SMS invites in v0**

Why this stack?    
Fast to scaffold, secure by default, and matches Lovable's strengths.

---

### 📊 Conceptual Data Model (ERD in words)

**users**    
- id    
- email    
- password_hash    
- company_name  

**projects**    
- id    
- gc_id (FK → users)    
- name    
- location    
- agency    
- bid_due_at    
- instructions    
- public_token    
- status ("live" or "dead")  

**project_files**    
- id    
- project_id    
- file_name    
- file_url  

**bids**    
- id    
- project_id    
- submitted_at    
- file_url    
- bidder_name    
- company_name    
- email    
- division (optional)

**trade_types** (NEW - State-Agnostic Architecture)
- id (uuid, PK)
- state_code (nullable — "CA", "TX", "FL", null for national)
- code (text — "C-10", "Roofing", etc.)
- name (text — "Electrical")
- category (text — "Mechanical", "Civil", etc.)
- source (text — "CSLB", "TDLR", "DBPR", "CUSTOM")
- is_default (boolean)
- created_at

**project_trades** (NEW)
- id (uuid, PK)
- project_id (FK → projects)
- trade_type_id (FK → trade_types)
- created_at

> **⚠️ ARCHITECTURAL NOTE**: The licensing system is designed to be **state-agnostic**. California CSLB license types are the initial seed data, but the system supports nationwide expansion without code changes. All trade references use `trade_type_id` foreign keys, never hard-coded license codes.

---

### 🎨 UI Design Principles

- Clarity first, then speed  
- Public bid page: **minimal, deadline-driven, excruciatingly clear**  
- GC dashboard: clean tile layout, clear status indicators  
- **Brand Color**: Vibrant blue (#1D4ED8) for all CTAs, buttons, links, and key accents  
- Sharp, high-contrast UI with white headers and blue accents  
- Public form shows countdown (black digits) + drag-and-drop upload + instant confirmation  
- Layout follows an 8pt grid with generous white space  
- Sidebar uses "BB" logo mark in blue — avoid duplicate "BidBox" text

(Krug's law: "Don't make me think.")

---

### 🔐 Security & Compliance Notes

- All uploaded files stored in Supabase Storage (never on Lovable servers)    
- Public pages scoped via secure random `token`    
- Row-level security ensures users only access their own projects/bids    
- Public upload form: rate-limited to prevent spam    
- File size limit: 25MB (configurable)  

---

### 🔒 Security Decisions (Audit Reference)

> **Last Reviewed**: 2025-12-15

#### SD-001: Two-Pool Subcontractor Access Model

**Decision**: The `subcontractors` table (BidBox Network Pool) is intentionally readable by ALL authenticated users. This is NOT a security vulnerability.

**Rationale**:
- The Network Pool is a **shared, BidBox-owned directory** populated via CSLB scraping and admin curation
- Cross-GC visibility is a **designed feature**, not a bug — it enables the Call List Generator to provide instant coverage
- The table has **no ownership column** (`gc_id`, `owner_id`, `created_by`) by design
- Competitor intelligence concerns are a business decision, not a security flaw

**Correct Access Model**:
| Table | Ownership | Authenticated Access | Public Access |
|-------|-----------|---------------------|---------------|
| `subcontractors` | BidBox (shared) | ✅ All authenticated | ❌ Blocked |
| `gc_subcontractors` | Per-GC (`gc_id`) | ✅ Own rows only | ❌ Blocked |

**Do NOT**:
- Add ownership columns to `subcontractors`
- Restrict `subcontractors` to admin-only without product decision
- Merge the two-pool model into a single table
- Flag authenticated network pool access as a vulnerability

**References**: `docs/gc-control-center-prd.md` Section 6, `docs/tasks.md` Security Decisions, Lovable memory `architecture/two-pool-subcontractor-model`

---

### 🗺️ Phased Roadmap

**MVP (v0)** ✅ Complete  
- GC login + dashboard    
- Create project    
- Upload files    
- View public bid page    
- Accept uploads    
- View/manage bids  

**v1** 🔄 In Progress  
- Download all bids (ZIP/CSV)    
- Responsive mobile layout polish    
- PDF preview viewer    
- Countdown component  

**Phase 3.5: Trade Selection Layer** ✅ Database Complete  
- ✅ Create `trade_types` table (state-agnostic reference table)
- ✅ Create `project_trades` table (FK to trade_types)
- ✅ Seed California CSLB license types (43 trade types)
- 📋 Add trade multi-select to `/projects/new`
- 📋 Display selected trades on project admin page

> **Architecture Note**: Phase 3.5 uses a future-proof, state-agnostic trade taxonomy. California CSLB is the initial seed data, but the system supports multi-state expansion via the `trade_types.state_code` column.

**Phase 4: Subcontractor Directory** 📋 Planned  
- Create `subcontractors` table with `trade_type_id` FK (BidBox Network Pool)
- Create `gc_subcontractors` table with `trade_type_id` FK (GC's Private Pool)
- Build directory management UI
- Map subs to project trades via `trade_type_id`
- (Future) Seed BidBox Network with real data

**Phase 5: Engagement Tracking** 📋 Planned  
- Track plan views (enhance existing)
- Track file downloads
- Display engagement status per sub

**Phase 6: Call List Generator** 📋 Planned  
- Build ranking logic (Not opened → Viewed → Downloaded → Submitted)
- Merge two pools for project coverage
- Generate Excel (.xlsx) grouped by trade
- Add "Generate Call List (Excel)" button

**v2+ (future)**    
- Sub invite batching (email/SMS)    
- Bid status tracking    
- Bid analytics + coverage map    
- AI bid diff tools    
- Multi-user GC orgs
- Compliance tracking (COIs, license expirations)

---

### ⚠️ Risks & Mitigations

| Risk | Mitigation |  
|------|------------|  
| Subs upload junk files or spam | Add file type validation + upload rate limits |  
| GCs forget their links | Add copyable links in dashboard; regenerate token option |  
| File size too big | Enforce Supabase upload limits (25MB) |  
| Confusion between GC/public views | Use visual headers + URL structure (`/projects/[id]` vs `/bid/[token]`) |

---

### 🌱 Future Expansion Ideas

- Invite-only bid rooms with tracking    
- Bidder analytics (viewed/not viewed)    
- "Bid received" email to GC    
- Integrate bid forms by division    
- Optional contractor registry    
- Public works bid log export format

---

### 💳 Pricing & Stripe Integration (Implemented 2025-11-30)

**Current Pricing Tiers:**
| Tier | Price | Bid Rooms | Status |
|------|-------|-----------|--------|
| Free | $0 | 3 projects | ✅ Active |
| Early Access Lifetime | $199 (one-time) | Unlimited | ✅ Active (Featured) |
| Tier 1 | $49/month | Unlimited | 🔮 Future (Commented out) |

**Implementation Status:**
- ✅ Stripe account & product setup (Price ID: `price_1SZFudHGNQLTHcjYQs0m5Jq6`)
- ✅ Database schema: `stripe_customer_id` in profiles, `subscriptions` table
- ✅ Edge functions: `create-checkout`, `stripe-webhook`
- ✅ Frontend: `useSubscription` hook, PricingMvp checkout, Settings display
- ✅ Free tier enforcement (3 project limit with upgrade prompt)
- ⚠️ PENDING: Register webhook endpoint in Stripe Dashboard

**Documentation:**
- `docs/stripe-tasks.md` - Detailed task breakdown with status
- `docs/stripe-steps.md` - Implementation guide

---

### 🤖 Future AI Roadmap

These features represent high-leverage, high-value AI capabilities that will differentiate BidBox after the MVP and v1 are stable. AI is not required for initial launch but is intended to be a major competitive advantage as the platform grows.

**🔥 AI Feature #1 — Bid Scope Comparison (Leveling Assistant)**

The killer feature.
GCs HATE manually comparing bids.
- Subs exclude random items.
- People miss huge scope gaps.
- Bid day becomes chaos.

AI would:
- Read all uploaded bid PDFs
- Extract line items, scope notes, exclusions, inclusions, unit costs
- Normalize the text (every sub uses different format)
- Highlight:
  - Missing scope
  - Suspicious exclusions
  - Outlier prices
  - Major differences between subs

**🔥 AI Feature #2 — Auto-Build CSI Trade Breakdown from Plans**

GC uploads plans/specs → AI automatically generates:
- CSI trade list
- Suggested subcategories
- Quantities or takeoff notes
- Risks and high-cost areas
- List of subcontractors needed

**🔥 AI Feature #3 — Subcontractor Quote Risk Scoring**

AI evaluates each sub's proposal for:
- Ambiguity in scope
- Missing required items
- High-risk exclusions
- Possible underbidding
- Past bid patterns (local DB)
- Language indicating change order risk

---

**Note:** AI features are not part of MVP or v1. These capabilities will be developed only after core workflows are stable and validated with early GCs and subcontractors.

---

### 🏔️ BidBox Network Pool Moat Strategy

> **Strategic Initiative: CSLB Network Directory Seeding**

BidBox is building a long-term competitive moat by populating the Network Pool with verified California subcontractors sourced from the CSLB database.

**Why This Matters:**

1. **Central Directory for California Public Works**
   - BidBox becomes THE go-to directory for California subcontractors
   - GCs get instant coverage even with an empty private pool
   - Local specialization is our wedge against PlanHub and Dodge

2. **Organic + Systematic Growth**
   - Network grows through: (1) Admin seeding, (2) CSLB harvesting, (3) GC Excel imports
   - Each GC import potentially enriches the network
   - Flywheel effect: more subs → more value → more GCs → more subs

3. **Future Revenue Enablers**
   - **Compliance Monitoring**: Paid feature for license expiration alerts
   - **Lead Generation**: Connect verified subs with GCs (future marketplace)
   - **Call List Automation**: Premium feature for ranked, enriched call sheets
   - **AI Bid Matching**: Auto-suggest subs based on project scope

4. **Defensibility Against Competitors**
   - 290,000+ contractor database requires months of scraping effort
   - Classification-to-trade mapping is non-trivial intellectual property
   - Local California focus creates expertise moat
   - GC trust and sub relationships compound over time

**Phased Approach:**

| Phase | Focus | Outcome |
|-------|-------|---------|
| **7.1** | Architecture | Foundation for seeding |
| **7.2** | Hot Trades (Tier 1) | ~50,000 subs, top 15 trades |
| **7.3** | Full Harvest (Tier 2) | 290,000+ subs, statewide |
| **7.4** | Enrichment (Tier 3) | Emails, websites, phones |
| **7.5** | GC Excel Import | Accelerate private pool growth |
| **7.6** | Compliance Jobs | Keep data fresh |

See `docs/tasks.md` Phase 7 for detailed implementation tasks.

---

# Tasks

## BidBox Implementation Tasks

**Source of Truth for Feature Implementation**  
Last Updated: 2025-12-14

---

## 🏗️ Architecture Note: State-Agnostic Licensing

> **CRITICAL**: BidBox uses a **future-proof, state-agnostic trade taxonomy**.
> 
> - `trade_types` table stores all license/trade types with `state_code` column
> - California CSLB is the **initial seed data**, not a permanent constraint
> - All tables (project_trades, subcontractors, gc_subcontractors) use `trade_type_id` FK
> - **NEVER** hard-code license codes like "C-10" in components or logic
> - Multi-state expansion requires only adding rows to `trade_types`, no code changes

---

## 📋 Task Status Legend

- [ ] Not Started
- [x] Completed
- [🔄] In Progress
- [⚠️] Blocked/Needs Review

---

## 🔐 Security Decisions (Audit Reference)

> **Purpose**: Document intentional security architecture decisions to prevent false-positive vulnerability reports.

---

### SD-001: Two-Pool Subcontractor Access Model [FINAL]

**Date**: 2025-12-15  
**Status**: Reviewed and closed — Do not reopen without product decision

**Summary**: BidBox uses two distinct subcontractor tables with different access models:

1. **`subcontractors`** (Network Pool)
   - Shared, BidBox-owned directory
   - Readable by ALL authenticated users (intentional)
   - No `gc_id` or ownership column (by design)
   - Populated via CSLB scraping, admin curation

2. **`gc_subcontractors`** (Private Pool)
   - Per-GC private directory
   - Readable ONLY by owning GC (strict RLS via `gc_id`)
   - Populated via Excel import, manual entry

**RLS Policies**:
- `subcontractors`: `auth.uid() IS NOT NULL` (authenticated access)
- `gc_subcontractors`: `gc_id = auth.uid()` (owner-only access)

**Why NOT a vulnerability**:
- Network Pool shared access is a **product feature**, not a security flaw
- Competitor intelligence concerns are business decisions
- Unauthenticated/public access is blocked
- Private Pool remains strictly isolated

**Future audits**: If flagged as "PUBLIC_SENSITIVE_DATA" or similar, reference this decision before implementing restrictions.

---

## 🔴 Phase 0: CRITICAL SECURITY FIXES (DO FIRST)

> **BLOCKER**: These vulnerabilities expose ALL project data to the public internet. Must fix before any new features.

### Task 0.1: Fix Projects Table RLS Policy [✅ COMPLETED]
### Task 0.2: Fix Project Files Table RLS Policy [✅ COMPLETED]
### Task 0.3: Fix Storage Bucket Policies [✅ COMPLETED]
### Task 0.4: Add File Upload Validation [✅ COMPLETED]
### Task 0.5: Enable Leaked Password Protection [✅ COMPLETED]
### Task 0.6: Implement Drag-and-Drop File Upload [✅ COMPLETED]

---

## ✅ Phase 1: MVP Foundation

### Task 1.1: Authentication System [✅ COMPLETED]
### Task 1.2: Projects Dashboard [✅ COMPLETED]
### Task 1.3: New Project Creation [✅ COMPLETED]
### Task 1.4: Project Detail View [✅ COMPLETED]
### Task 1.5: Public Bid Room Page [✅ COMPLETED]

---

## 🎯 Phase 2: MVP Polish & Core Features

### Task 2.1: Add Countdown Timer to Bid Room [MVP] - Pending
### Task 2.2: Late Bid Handling [MVP] - Pending
### Task 2.3: Make Location/Agency Fields Optional [✅ COMPLETED]
### Task 2.3.5: Update PRD with Final Branding [✅ COMPLETED]
### Task 2.3.6: Enhance Bid Room UI [✅ COMPLETED]
### Task 2.3.7: Fix Datetime Timezone Bug [✅ COMPLETED]
### Task 2.4: Token Regeneration Feature [MVP] - Pending
### Task 2.5: Settings Page Basic Structure [MVP] - Pending

---

## 🚀 Phase 3: v1 Features (Post-MVP)

### Task 3.1: Download All Bids as ZIP [v1] - Pending
### Task 3.2: Email Notifications [v1] - Pending
### Task 3.3: CSV Export of Bids [v1] - Pending
### Task 3.4: PDF Preview [v1] - Pending
### Task 3.5: Basic Analytics Dashboard [v1] - Pending

---

## 💳 Phase 4: Stripe Integration [✅ COMPLETED]

> **Status**: Phase 4 is complete. Stripe integration is now in **LIVE MODE**.

### Task 4.1: Stripe Account & Product Setup [✅ COMPLETED]
### Task 4.2: Enable Stripe Integration [✅ COMPLETED]
### Task 4.3: Database Schema Updates [✅ COMPLETED]
### Task 4.4: Create `create-checkout` Edge Function [✅ COMPLETED]
### Task 4.5: Create `stripe-webhook` Edge Function [✅ COMPLETED]
### Task 4.6: Register Webhook in Stripe Dashboard [✅ COMPLETED]
### Task 4.7: Frontend Integration [✅ COMPLETED]

---

## 🎯 Phase 3.5: Trade Selection Layer [✅ COMPLETED]

### Task 3.5.0: Create `trade_types` Reference Table [✅ COMPLETED]
### Task 3.5.1: Create `project_trades` Table [✅ COMPLETED]
### Task 3.5.2: Seed California CSLB License Types [✅ COMPLETED]
### Task 3.5.3: Add Trade Multi-Select to `/projects/new` [✅ COMPLETED]
### Task 3.5.4: Update Project Creation Logic [✅ COMPLETED]
### Task 3.5.5: Display Trades on Project Admin Page [✅ COMPLETED]

---

## ✅ Phase 4: Subcontractor Directory

### Task 4.1: Create `subcontractors` Table [✅ COMPLETED]
### Task 4.2: Create `gc_subcontractors` Table [✅ COMPLETED]
### Task 4.3: Build Directory Management UI [✅ COMPLETED]
### Task 4.4: Map Subs to Project Trades [✅ COMPLETED]
### Task 4.5: Seed BidBox Network Pool - FUTURE

---

## 🎯 Phase 5: Engagement Tracking (Planned)

### Task 5.1: Track Plan Views - Pending
### Task 5.2: Track File Downloads - Pending
### Task 5.3: Display Engagement Status - Pending

---

## 🎯 Phase 6: Call List Generator (Planned)

### Task 6.1: Build Ranking Logic - Pending
### Task 6.2: Merge Two Pools - Pending
### Task 6.3: Generate Excel (.xlsx) Output - Pending
### Task 6.4: Add "Generate Call List (Excel)" Button - Pending

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: 📋 Planned (Multi-month strategic initiative)

### Phase 7.0: Initiative Overview
### Phase 7.1: Foundational Architecture [✅ MOSTLY COMPLETE]
### Phase 7.2: Tier 1 — Hot Trade Seeding - Pending
### Phase 7.3: Tier 2 — Full CSLB Harvest - Pending
### Phase 7.4: Tier 3 — Network Enrichment - Pending
### Phase 7.5: Excel Import (GC Bulk Upload) - Pending
### Phase 7.6: Compliance & Nightly Jobs - Pending

---

# GC Control Center PRD

## BidBox GC Control Center PRD

**Strategic Product Requirements Document**  
Last Updated: 2025-12-07

---

## Executive Summary

BidBox is evolving from a "simple bid room" into the **GC Control Center** — a single, frictionless operating system for preconstruction that makes General Contractors more informed, organized, effective, and confident on bid day.

---

## 1. Updated Understanding of GC Workflows

Based on real Reddit conversations, estimator interviews, and field experience, we now have clarity on the *true* problems small-to-mid GCs face:

- Bidding workflows are scattered across email, spreadsheets, Drive links, text messages, and whiteboards.
- Chasing subcontractors is **not** a problem to eliminate — it is a required and valuable part of the job.
- The REAL pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, compliance, and bid coverage**.
- Subcontractors will *ignore login systems* and *avoid portals*. No GC software wins by forcing subs to adopt a system.
- GCs want a **simple hub** that gives them clarity, organization, and control — not automation gimmicks.

---

## 2. The GC Control Center Vision

A single, frictionless operating system for preconstruction — one that makes GCs:

- **More informed** — Know which trades are covered and where gaps exist
- **More organized** — All subs, files, and quotes in one place
- **More effective** — Action-ready call lists ranked by priority
- **More confident on bid day** — Clear visibility into bid coverage

---

## 3. Guiding Principles

### Principle 1: Do Not Replace Phone Calls — Empower Them
GCs close gaps by calling subs. BidBox must surface insights that make these calls more efficient and targeted.

### Principle 2: Subs Must Experience Zero Friction
No logins. No portals. No data entry. Just simple:  
**Click link → View plans → Upload quote.**

### Principle 3: Clarity Beats Features
Our UI should provide the GC with immediate clarity into:
- Which trades are needed
- Which subs fit those trades
- Who has viewed the plans
- Who has downloaded the plans
- Who has not engaged
- Where bid coverage is thin

### Principle 4: Local Specialization Is the Wedge
We specialize in **California public works**, **license-type filtering**, and **curated SoCal subcontractor directories**.  
This is something PlanHub and Dodge *cannot do*.

---

## 4. Why "Select Trades for Your Job" Is Foundational

Selecting trades (by license type) when creating a project becomes a **core system primitive**.

It enables:
- Mapping GC needs → Required subcontractor categories
- Generating trade-specific call sheets
- Surfacing trade-specific coverage gaps
- Attaching the correct subs from the curated directory
- Tracking compliance (COIs, license expirations) per trade
- Enabling future AI features (scope generation, bid leveling)

It is now the **first step in the Control Center workflow**.

---

## 5. Four Pillars of the Control Center

### Pillar 1 — Trade Intelligence
- Select required trades (license-type dropdown + multi-select)
- View trade coverage heatmap
- Know instantly where your risks are

### Pillar 2 — Subcontractor Organization
- For each trade, BidBox recommends vetted subs
- GC can add custom subs to their private pool
- Directory grows into a local advantage

### Pillar 3 — Engagement Visibility
- See who viewed the plans
- See who downloaded documents
- See who submitted quotes
- See who requires follow-up

### Pillar 4 — Bid-Day Command Center
- Auto-generated call list by trade
- Coverage meter per trade
- Compliance reminders (COIs, license expirations)
- Live quote intake

---

## 6. Two-Pool Subcontractor Architecture

### Overview
The Call List Generator pulls from **two distinct pools**:

1. **GC's Private Pool** — Subcontractors the GC has personally added and worked with
2. **BidBox Network Pool** — Curated, verified subcontractors maintained by BidBox

### Benefits
- GCs get instant coverage even with an empty private pool
- Network pool provides California public works specialists
- GCs build their own trusted sub relationships over time
- Combined pools maximize bid coverage

### Target User Flow
1. GC creates project → uploads plans
2. GC selects required trades (license types)
3. BidBox maps subs from **both pools** to selected trades
4. GC clicks **"Generate Call List (Excel)"**
5. BidBox outputs `.xlsx` with:
   - Grouped by trade
   - Sorted by engagement priority
   - Contains: Name, Company, Phone, Email, Engagement Status

**Result:** GC has an actionable call sheet ready immediately.

### Security Model (Audit Reference)

> **Decision ID**: SD-001  
> **Last Reviewed**: 2025-12-15  
> **Status**: Final — Do not reopen without product review

The two-pool architecture has **intentionally different access rules**:

| Pool | Table | Access Rule | Rationale |
|------|-------|-------------|-----------|
| Network Pool | `subcontractors` | All authenticated users | Shared directory, BidBox-owned, no GC ownership |
| Private Pool | `gc_subcontractors` | GC's own rows only | Proprietary contact list, strict RLS via `gc_id` |

---

## 7. Queen Bee Features

### Primary: Trade Selection + Curated Sub Mapping
This backbone feature unlocks:
- Coverage intelligence
- Directory-driven subcontractor matching
- Engagement analytics
- Bid-day call prioritization
- Compliance tracking
- Future AI workflows

### Secondary: Call List Generator
The GC's primary "action layer" during bid-day operations.

**Purpose:** Give GCs a real-time, ranked call sheet that tells them: **Who to call next, and why.**

**Output Format:** Downloadable Excel (.xlsx) file
- Sorted by trade
- Sorted by engagement priority
- Contains: Name, Phone, Email, Engagement Status

**Ranking Logic:**
1. Not opened → highest priority (needs outreach)
2. Viewed but not downloaded (interested but stalled)
3. Downloaded but no quote (engaged, needs follow-up)
4. Submitted a quote → lowest priority (complete)

---

# Implementation Plan

## BidBox – Implementation Plan

---

### 🧱 Step-by-Step Build Sequence

**Phase 1 – Foundations: Data Model + Storage** ✅ Complete
**Phase 2 – GC Internal Pages (Private)** ✅ Complete
**Phase 3 – Public Bid Page (No Login)** ✅ Complete
**Phase 4 – Polish + Export** 🔄 In Progress

---

## 🎯 GC Control Center Phases (NEW)

### **Phase 3.5 – Trade Selection Layer** ✅ Database Complete
### **Phase 4 – Subcontractor Directory** ✅ Complete (Phase 4.0)
### **Phase 5 – Engagement Tracking** 📋 Planned
### **Phase 6 – Call List Generator** 📋 Planned

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: 📋 Planned (Documentation Only)

### Objective
Transform BidBox into the central directory for California public works subcontractors by systematically harvesting and enriching CSLB license data.

### Why This Builds Defensibility
- **Curated California directory** = local specialization wedge
- **Competitors need months of scraping effort** to replicate
- **Network grows organically** via GC imports + systematic seeding
- **Enables future revenue features**: compliance monitoring, lead gen, AI matching

### Scraping Pipeline Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    CSLB Scraping Pipeline                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Scheduler│───▶│ Firecrawl│───▶│ Parser   │───▶│ Store │ │
│  │ (Cron)   │    │ /Browser │    │ /Mapper  │    │ (DB)  │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│  Rate: 1 req/sec    Batch: 100-500    Resumable: Yes       │
└─────────────────────────────────────────────────────────────┘
```

### Legal & Operational Considerations
- CSLB data is **publicly available** on cslb.ca.gov
- Scraping must be **rate-limited** (1 req/sec) to avoid IP blocks
- BidBox is **NOT** a licensed contractor verification authority
- We provide **convenience + pre-classification**, not official verification
- Data is for **internal GC use**, not public redistribution
- Subs can **request removal** if desired

---

# Design Guidelines

## design-guidelines.md

## Emotional Thesis  
Feels like a contractor's war room — sharp, no-frills, deadline-driven. Every UI decision should scream: *"Don't screw this up on bid day."*

## Typography

- **H1** – Project titles: `Inter, Bold, 28px`, 1.5 line-height  
- **H2** – Section headers: `Inter, Semibold, 22px`  
- **H3** – Labels: `Inter, Medium, 16px`  
- **Body** – General text: `Inter, Regular, 14px`, 1.6 line-height  
- **Caption** – Metadata or timestamps: `Inter, Light, 12px`  
- System font fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`

> Tone: confident, no-nonsense, readable on jobsite iPads and office monitors alike.

## Color System

| Purpose              | Hex       | RGB             | Usage |  
|----------------------|-----------|------------------|-------|  
| **Primary** (black)  | `#121212` | `18, 18, 18`     | Text, backgrounds |  
| **BidBox Blue**      | `#1D4ED8` | `29, 78, 216`    | **PRIMARY BRAND COLOR** - CTA buttons, links, accents, icons, sidebar logo |  
| **Accent Orange**    | `#D92D20` | `217, 45, 32`    | Urgent badges only |  
| **Soft Gray**        | `#F4F4F5` | `244, 244, 245`  | Backgrounds |  
| **Outline**          | `#E4E4E7` | `228, 228, 231`  | Borders |  
| **Success Green**    | `#12B76A` | `18, 183, 106`   | Success states |

- Contrast: WCAG AA+ minimum 4.5:1  
- Light & dark mode: use Tailwind's `dark:` variant support  
- Mood: urgent but not chaotic

## Layout & Spacing

- **Grid**: 8pt system  
- **Container Widths**:  
  - GC dashboard: `max-width: 1200px`, centered  
  - Public bid page: `max-width: 800px`, centered  
- **Padding**:  
  - Form fields: `px-4 py-3`  
  - File cards: `px-6 py-5`  
- **Breakpoint Logic**:  
  - `sm`: stack elements vertically  
  - `md`: two-column layout  
  - `lg+`: maintain centered max-width

## Motion & Interaction

- **File upload success**: 250ms fade-in with checkmark  
- **Copy link**: 200ms glow on hover, ease-in-out  
- **Countdown timer**: ticks in real-time using smooth JS transitions (no jank)  
  - **CRITICAL**: Countdown digits remain **black**, not blue  
- **Button behavior**:  
  - Hover = soft background fill  
  - Tap = compress 1px + subtle shadow

> Follow "Kindness in Design" → motion should confirm, never distract.

## Header & Branding

- **Landing Page Header**: White background with blue accents  
- **Authenticated Pages Header**: White background  
- **Sidebar Logo**: "BB" in vibrant blue (#1D4ED8)  
- **Logo Strategy**: Use "BB" mark only — avoid duplicate "BidBox" text in desktop views  
- **Profile Button**: Blue circular avatar with white text

## Voice & Tone

- Personality: Direct, helpful, focused  
- Avoid humor, over-friendly nudges, or techy jargon  
- **Examples**:  
  - Onboarding: "Start a new project to generate your bid room."  
  - Success: "Bid uploaded. You'll get a confirmation email shortly."  
  - Error: "Something went wrong — try again or contact support."

## System Consistency

- Use `shadcn/ui` component patterns  
- Buttons = same radius, padding, font size  
- File upload = consistent drag-drop zone across GC and public views  
- Form styling = shared components (`<Label>`, `<Input>`, `<TextArea>`)

## Accessibility

- All form fields = labeled  
- Buttons = `aria-pressed` and focus indicators  
- Countdown timer = `aria-live="polite"` for screen readers  
- File lists = screen-reader readable, role `list` with `listitem`

## Emotional Audit Checklist

✅ Does this layout evoke clarity under time pressure?    
✅ Does motion confirm user action without distraction?    
✅ Would a 55-year-old estimator feel confident and supported?

## Technical QA Checklist

- Typography adheres to 8pt grid  
- Color contrast ≥ AA+  
- Interactive states visually distinct  
- All motion durations: 150–300ms

## Design Snapshot

### 🎨 Color Palette  
```txt  
Primary (Black): #121212  
BidBox Blue (PRIMARY BRAND): #1D4ED8 ← Use for CTAs, links, accents, icons  
Accent Orange: #D92D20 (urgent badges only)  
Soft Gray: #F4F4F5  
Outline: #E4E4E7  
Success Green: #12B76A
```

### 🔤 Typographic Scale  
| Element | Size | Weight |
|---------|------|--------|
| H1 | 28px | Bold |
| H2 | 22px | Semibold |
| H3 / Labels | 16px | Medium |
| Body | 14px | Regular |
| Caption | 12px | Light |

### 📐 Spacing System

- 8pt grid baseline
- Buttons: px-4 py-2
- Cards: px-6 py-5
- Inputs: px-4 py-3

### 🧠 Emotional Thesis

Feels like a contractor's war room — sharp, no-frills, deadline-driven.

---

# App Flow Pages and Roles

## 🧭 Overview

BidBox is a two-role system (GC and anonymous Subcontractor) with a minimal page flow optimized for speed, clarity, and trust. All flows revolve around core actions: create project, upload plans, share public link, receive quotes.

---

## 👤 User Roles

### 1. General Contractor (GC)  
- Requires login (email/password)  
- Can create and manage projects  
- Can view bid submissions  
- Has private access to GC dashboard and admin tools

### 2. Subcontractor (Sub)  
- No login  
- Accesses public `/bid/[token]` link  
- Can view plans and submit bid  
- Can optionally enter name, company, email

---

## 📄 Core Pages

### 1. `/auth/*`  
- Register / Login for GCs only  
- Auth via Supabase email/password

### 2. `/projects`  
- GC home dashboard  
- View all created projects in tile layout  
- Each tile: project name, due date, status, submission count, copy link  
- CTA: "+ New Project"

### 3. `/projects/new`  
- Form to create a project  
- Fields: name, location, agency, bid date/time, instructions  
- Upload multiple files (PDFs)  
- On submit:  
  - Save project to DB  
  - Upload files to Supabase Storage  
  - Generate public token and links  
  - Redirect to `/projects/[id]`

### 4. `/projects/[id]`  
- GC admin view for individual project  
- View/edit project metadata  
- View/delete/add files  
- See list of bids with timestamps and filenames  
- "Download All" ZIP button  
- Delete project option

### 5. `/bid/[token]`  
- Public page with no login  
- Accessed by subs via shared link  
- Shows:  
  - Project info  
  - File list  
  - Red countdown timer  
  - Submit Quote button  
- Upload modal allows:  
  - File upload  
  - Optional fields: name, company, email, bid item  
  - Confirmation on success

---

## 🔄 End-to-End Flows

### GC Flow  
1. Logs in    
2. Goes to `/projects`    
3. Clicks "New Project"    
4. Completes form and uploads files    
5. Gets public bid link    
6. Shares it with subs    
7. Receives bids in real-time    
8. Manages project via `/projects/[id]`

### Sub Flow  
1. Receives link to `/bid/[token]`    
2. Opens public bid room (no login)    
3. Views plans and deadline    
4. Clicks "Submit Your Quote"    
5. Uploads file (with optional details)    
6. Gets confirmation    
7. Done

---

## 🔐 Access Rules

| Page               | GC | Sub | Auth Required |  
|--------------------|----|-----|----------------|  
| `/projects`        | ✅ | ❌  | Yes            |  
| `/projects/new`    | ✅ | ❌  | Yes            |  
| `/projects/[id]`   | ✅ | ❌  | Yes            |  
| `/bid/[token]`     | ❌ | ✅  | No             |

---

## 📱 Mobile Considerations

- Public bid room is optimized for mobile subs  
- File uploads and forms stack vertically on small screens  
- Countdown timer and submit button are pinned near top

---

# BidBox BrandScript

## 🔵 BidBox MVP — Full StoryBrand Framework (Based on Reddit Pain Points)

*(Clear, powerful, customer-language narrative)*

---

## 1. The Character (Hero)

### **The hero is the GC estimator.**

He's juggling:
* Subcontractors who don't respond
* Dropbox links scattered across email
* Files too big to email
* Bid day chaos
* SmartBid / BuildingConnected that are bloated, slow, expensive, or require logins
* Last-minute addenda confusion
* "Did the sub get my plans?" uncertainty

He desperately wants **simplicity and control**.

---

## 2. The Problem

### **External Problem — "Bidding is chaos."**
Estimators waste hours managing files, chasing subs, and uploading everything *manually*.

### **Internal Problem — "This shouldn't be this hard."**
They feel frustrated, overwhelmed, slowed, and embarrassed by inefficiency.

### **Philosophical Problem — "A modern GC shouldn't need enterprise software just to share files."**

Reddit posts confirm it:  
**"Why is bidding so painful?"**  
**"Why does everything require a login?"**  
**"Why are bid platforms so bloated?"**

---

## 3. The Guide (You / BidBox)

You understand the workflow because **you work in construction**.  
You aren't a SaaS outsider — you've lived bid day stress.

You empathize with this reality:
"You don't need a giant platform. You just need subs to download plans and send bids. Fast."

You bring **credibility** through simplicity, reliability, and GC-first design.

---

## 4. The Plan

### **Process Plan (How It Works)**

**1. Create a bid room**  
Upload plans → set due date → generate a link.

**2. Share with subs**  
Send the public link — no logins, no passwords.

**3. Collect bids cleanly**  
Subs upload quotes → you receive everything in one place.

### **Agreement Plan (Your Promise)**
* Zero friction
* Zero logins for subs
* Zero bloat
* Always works
* Files handled instantly

You're not trying to replace the entire precon stack — you're fixing the first, most painful part of it.

---

## 5. The Call to Action

### **Direct CTA**
**Start Free**

### **Transitional CTA**
**See a Sample Bid Room**

---

## 6. Failure (What They're Avoiding)

If they continue using their current process:
* Subs miss files
* Bids arrive late
* Team looks disorganized
* Hours wasted chasing emails
* Bid coverage suffers
* Money is lost

Bid day becomes misery.

---

## 7. Success (The Transformation)

With BidBox:
* Estimators feel *in control*
* Subs respond faster
* Files never get lost
* Bid rooms look professional
* Everything becomes clear, predictable, trackable
* Bids come in earlier and more reliably

The estimator transforms into a **calm, confident, organized leader**.

---

## ⭐ Your One-Liner (StoryBrand Sentence)

**"BidBox helps general contractors share bid files instantly and collect subcontractor quotes without logins, confusion, or chaos — so you can win more bids with less stress."**

---

# CSLB License Types

## California CSLB License Types Reference

**For BidBox Trade Selection Feature**  
Last Updated: 2025-12-07

---

## ⚠️ State-Agnostic Architecture Note

> **IMPORTANT**: This document describes the **initial seed data** for the `trade_types` table. California CSLB is NOT the only supported licensing system.
> 
> The BidBox architecture is **state-agnostic** and supports nationwide expansion:
> - `trade_types` table has `state_code` column ("CA", "TX", "FL", null for national)
> - All tables use `trade_type_id` FK references, NOT hard-coded license strings
> - Adding new states requires only inserting rows into `trade_types`, no code changes
> - California data is seeded with `state_code='CA'` and `source='CSLB'`

---

## Overview

This document defines the California Contractors State License Board (CSLB) license types seeded into BidBox's `trade_types` database table. GCs select from this list when creating projects to indicate which trades/subcontractors they need.

**Status:** ✅ 43 trade types seeded into `trade_types` table

---

## License Type Format

Each license type has:
- **Code**: Official CSLB classification code (e.g., "C-10")
- **Name**: Human-readable trade name (e.g., "Electrical")
- **Category**: Grouping for UI display (e.g., "Mechanical", "Civil")
- **Source**: Origin of license type ("CSLB" for California)

---

## Class A — General Engineering

| Code | Name | Description |
|------|------|-------------|
| A | General Engineering | Highways, bridges, utilities, infrastructure |

## Class B — General Building

| Code | Name | Description |
|------|------|-------------|
| B | General Building | Commercial and residential buildings |

## Class C — Specialty Contractors

### Commonly Used in Public Works

| Code | Name | Description |
|------|------|-------------|
| C-4 | Boiler, Hot Water Heating & Steam Fitting | Boiler systems, steam piping |
| C-7 | Low Voltage Systems | Alarm, communication, sound systems |
| C-8 | Concrete | Foundations, flatwork, structural concrete |
| C-10 | Electrical | Power, lighting, electrical systems |
| C-12 | Earthwork and Paving | Grading, excavation, asphalt paving |
| C-13 | Fencing | Chain link, wood, metal fencing |
| C-15 | Flooring and Floor Covering | Carpet, tile, hardwood, vinyl |
| C-16 | Fire Protection | Sprinkler systems, fire suppression |
| C-17 | Glazing | Windows, glass, storefronts |
| C-20 | Warm-Air Heating, Ventilating, Air Conditioning (HVAC) | HVAC systems |
| C-21 | Building Moving/Demolition | Demolition, structure relocation |
| C-23 | Ornamental Metal | Railings, decorative metalwork |
| C-27 | Landscaping | Planting, irrigation, hardscape |
| C-29 | Masonry | Brick, block, stone work |
| C-33 | Painting and Decorating | Interior/exterior painting, coatings |
| C-34 | Pipeline | Water, gas, sewer pipelines |
| C-35 | Lathing and Plastering | Stucco, plaster systems |
| C-36 | Plumbing | Plumbing systems, fixtures |
| C-38 | Refrigeration | Commercial refrigeration systems |
| C-39 | Roofing | Roof systems, waterproofing |
| C-42 | Sanitation System | Septic, waste systems |
| C-43 | Sheet Metal | Ductwork, metal fabrication |
| C-45 | Electrical Sign | Neon, LED signage |
| C-46 | Solar | Solar panel installation |
| C-47 | General Manufactured Housing | Mobile home setup |
| C-50 | Reinforcing Steel | Rebar installation |
| C-51 | Structural Steel | Steel erection, framing |
| C-53 | Swimming Pool | Pool construction, repair |
| C-54 | Ceramic and Mosaic Tile | Tile installation |
| C-55 | Water Conditioning | Water treatment systems |
| C-57 | Well Drilling | Water well drilling |
| C-60 | Welding | General welding services |
| C-61 | Limited Specialty | Various specialty trades |

---

# Admin KPI Panel Plan

## Admin KPI Analytics Panel — Plan

**BidBox Platform Analytics for Admins**  
Last Updated: 2025-11-30

---

## 1. Purpose & Goals

### Why Platform KPIs Matter Now
BidBox is in early growth stage with 3 GCs and 5 projects. Tracking platform-level metrics enables:

- **Growth Monitoring**: Track GC acquisition and retention trends
- **Engagement Validation**: Measure if bid rooms are actually being used
- **Product-Market Fit**: Identify power users vs. one-time users
- **Feature Prioritization**: Data-driven decisions on what to build next

### Success Metrics
| Goal | Target | Measurement |
|------|--------|-------------|
| GC Growth | +5 GCs/month | Total Registered GCs trend |
| Engagement | 60%+ projects receive bids | Conversion Rate KPI |
| Retention | 40%+ GCs active in 30d | Active GCs (30d) KPI |

---

## 2. KPI Specifications (8 Metrics)

| # | KPI Name | Description | Data Source | Calculation |
|---|----------|-------------|-------------|-------------|
| 1 | **Total Registered GCs** | All GC accounts on platform | `profiles` | `COUNT(*)` |
| 2 | **Active GCs (30d)** | GCs who created a project OR received a bid in last 30 days | `projects`, `bids` | Complex join with 30-day filter |
| 3 | **Total Projects Created** | All projects platform-wide | `projects` | `COUNT(*)` |
| 4 | **Projects per GC** | Average projects created per GC | `projects` | `COUNT(*) / COUNT(DISTINCT gc_id)` |
| 5 | **Total Bid Submissions** | All bids received across platform | `bids` | `COUNT(*)` |
| 6 | **Avg Bids per Project** | Average number of bids per project | `bids`, `projects` | `COUNT(bids) / COUNT(projects)` |
| 7 | **Conversion Rate** | % of projects that received at least 1 bid | `bids`, `projects` | `(Projects with ≥1 bid / Total projects) × 100` |
| 8 | **Bid Room Views** | Total anonymous page views of bid rooms | `projects.view_count` | `SUM(view_count)` |

---

# Admin KPI Tasks

## Admin KPI Analytics Panel — Implementation Tasks

**Task Breakdown for Admin Dashboard**  
Last Updated: 2025-11-30

---

## Phase 1 — Data Model Adjustments ✅ COMPLETED
## Phase 2 — Backend KPI Functions (RPC) ✅ COMPLETED
## Phase 3 — Anonymous View Tracking ✅ COMPLETED
## Phase 4 — Admin Dashboard UI ✅ COMPLETED
## Phase 5 — QA & Validation ✅ COMPLETED

---

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 | 6 tasks | ✅ Completed |
| Phase 2 | 10 tasks | ✅ Completed |
| Phase 3 | 3 tasks | ✅ Completed |
| Phase 4 | 7 tasks | ✅ Completed |
| Phase 5 | 5 tasks | ✅ Completed |
| **Total** | **31 tasks** | **✅ All Complete** |

---

# Stripe Integration Steps

## Stripe Integration Guide (React + Supabase + Edge Functions)

This guide documents a full Stripe integration using React as the frontend and Supabase (Edge Functions) as the backend. It supports both **one-time payments** and **subscriptions**, with secure webhook handling and data syncing.

---

## ✅ Step 1: Stripe Dashboard Setup

1. Go to Stripe Dashboard – Products.
2. **Create One-Time Product** (BidBox Early Access):
   - Product name: "Early Access Lifetime"
   - Pricing: One-time ($199.00)
   - Save and copy the **Price ID**
3. **Create Subscription Product** (Future - Tier 1):
   - Product name: "Tier 1"
   - Pricing: Recurring → Monthly ($49.00)
   - Status: Currently disabled in code
   - Save and copy the **Price ID**

**Note**: The Free tier (3 bid rooms) does not require a Stripe product.

---

## ✅ Step 2: Supabase Database Schema

### `profiles` table (if not already exists):
- Add `stripe_customer_id TEXT` column

### `subscriptions` table:
- id, profile_id, stripe_customer_id, stripe_subscription_id
- subscription_type, status, valid_until
- created_at, updated_at

---

## ✅ Step 3: Environment Variables

In Supabase dashboard → Functions → Settings, set:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET` (after webhook setup)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## ✅ Step 4: Create Checkout Session Edge Function
Location: `supabase/functions/create-checkout/index.ts`

## ✅ Step 5: React Integration
## ✅ Step 6: Stripe Webhook Edge Function
## ✅ Step 7: Testing & Going Live

---

# Stripe Tasks

## 📋 Stripe Integration Task Breakdown

---

## Task 1 - STRIPE ACCOUNT & PRODUCT SETUP ✅ COMPLETED
## Task 2 - ENABLE STRIPE IN LOVABLE ✅ COMPLETED
## Task 3 - DATABASE SCHEMA UPDATES ✅ COMPLETED
## Task 4 - CREATE create-checkout EDGE FUNCTION ✅ COMPLETED
## Task 5 - CREATE stripe-webhook EDGE FUNCTION ✅ COMPLETED
## Task 6 - STRIPE WEBHOOK ENDPOINT SETUP ⚠️ PENDING
## Task 7 - FRONTEND: UPDATE PRICING COMPONENT ✅ COMPLETED
## Task 8 - FRONTEND: CREATE CHECKOUT RESULT PAGES ~ MODIFIED
## Task 9 - FRONTEND: CREATE useSubscription HOOK ✅ COMPLETED
## Task 10 - FRONTEND: ENFORCE FREE TIER LIMIT ✅ COMPLETED
## Task 11 - FRONTEND: ADD SUBSCRIPTION STATUS DISPLAY ✅ COMPLETED
## Task 12 - TESTING IN STRIPE TEST MODE ⬜ NOT STARTED
## Task 13 - GO-LIVE CHECKLIST ⬜ NOT STARTED

---

# Bug Prompt Template

## BidBox Bug Report Template

*A structured approach to single-pass bug fixes*

---

## Phase 1: Evidence Gathering

Before reporting a bug, collect these exact artifacts:

### Environment & Route
- **Environment**: Production or Preview
- **Exact URL**
- **Route/Page**: (e.g., `/projects`, `/bid/[token]`, `/projects/new`)
- **Browser & Mode**: (e.g., Chrome 131 incognito, Safari)

### Reproduction Steps
- Step 1-4 detailed reproduction

### Expected vs Actual Behavior
- **Expected**: What should happen
- **Actual**: What actually happens

### Visual Evidence
- Screenshot of the issue
- Console errors (if any)
- Network tab failures (if any)

---

## Phase 2: Root-Cause Analysis Checklist

Systematically check each layer:
- UI Layer
- RLS Policies (Database Access)
- Storage Buckets
- Edge Functions
- Client-Side Logic

---

## Phase 3: One Coherent Solution Plan

**DO NOT** propose incremental patches. Propose a complete fix with:
- Root Cause
- Files to Modify
- Specific Changes
- Side Effects
- Rollback Plan

---

## Phase 4: Verify & Test Matrix

After fix is applied, verify:
- Core Functionality
- Edge Cases
- Regression Tests

---

## What NOT to Do

- ❌ Incremental Guessing
- ❌ Environment Confusion
- ❌ Vague Descriptions
- ❌ Missing User Context
- ❌ Skipping Verification

---

# Bug Reports

## Bug Report: Header Tagline Visibility Discrepancy

### Issue Summary
The tagline "Bid Better, Win More." appears under the BidBox header logo in the external preview window and published site, but may not be visible in the Lovable editor preview.

### Status
Pending user clarification — was the tagline intentional or should it be removed?

---

## Bug Report: Failed to Sign Out

### Summary
User authentication sign out functionality fails with error toast "Failed to sign out"

### Priority
**HIGH** - Blocks core authentication flow and user experience

### Status
🔴 Open - Needs investigation

---

**End of BidBox Complete Documentation**
