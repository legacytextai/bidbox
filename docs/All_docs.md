# BidBox Complete Documentation

> **Generated**: 2026-01-04  
> **Purpose**: Single-file reference for AI agents and external tools  
> **Usage**: Download and paste into ChatGPT, Claude, or other AI assistants for full project context  
> **Total Documents**: 17

---

## Table of Contents

1. [Masterplan](#1-masterplan)
2. [Tasks](#2-tasks)
3. [GC Control Center PRD](#3-gc-control-center-prd)
4. [Implementation Plan](#4-implementation-plan)
5. [Design Guidelines](#5-design-guidelines)
6. [App Flow - Pages and Roles](#6-app-flow---pages-and-roles)
7. [BidBox BrandScript](#7-bidbox-brandscript)
8. [CSLB License Types](#8-cslb-license-types)
9. [Admin KPI Panel Plan](#9-admin-kpi-panel-plan)
10. [Admin KPI Tasks](#10-admin-kpi-tasks)
11. [Stripe Integration Guide](#11-stripe-integration-guide)
12. [Stripe Steps](#12-stripe-steps)
13. [Stripe Tasks](#13-stripe-tasks)
14. [Bug Prompt Template](#14-bug-prompt-template)
15. [Bug: Header Tagline Visibility](#15-bug-header-tagline-visibility)
16. [Bug: Sign Out Failure](#16-bug-sign-out-failure)
17. [Reddit Pain Points (Research)](#17-reddit-pain-points-research)

---

# 1. Masterplan

> **Source**: `docs/masterplan.md`

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

**Phase 6: Bid List Generator** ✅ Complete  
- ✅ Merge two pools (Private + Network) for project coverage
- ✅ Generate Excel (.xlsx) with two sheets ("My Subs" and "Network Subs")
- ✅ Filter by project's selected trades
- ✅ Regional filtering: Network Subs filtered by project county → region mapping
- ✅ Fix trade bias bug (per-trade iteration vs single `.in()` query)

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

These features represent high-leverage, high-value AI capabilities that will differentiate BidBox after the MVP and v1 are stable.

**🔥 AI Feature #1 — Bid Scope Comparison (Leveling Assistant)**
- Read all uploaded bid PDFs
- Extract line items, scope notes, exclusions, inclusions, unit costs
- Normalize the text
- Highlight missing scope, suspicious exclusions, outlier prices

**🔥 AI Feature #2 — Auto-Build CSI Trade Breakdown from Plans**
- Upload plans/specs → AI automatically generates trade list, quantities, risks

**🔥 AI Feature #3 — Subcontractor Quote Risk Scoring**
- AI evaluates each sub's proposal for ambiguity, missing items, high-risk exclusions

---

### 🏔️ BidBox Network Pool Moat Strategy

> **Strategic Initiative: CSLB Network Directory Seeding**
> 
> **Status**: 🔄 In Progress (Updated 2026-01-01)
> - Network Pool Size: 224,771 contractors
> - Gap Recovery: In progress (offset 90,018 of ~290,000)
> - Weekly Cron: Active (Sundays 2 AM UTC)

BidBox is building a long-term competitive moat by populating the Network Pool with verified California subcontractors sourced from the CSLB database.

**Why This Matters:**
1. **Central Directory for California Public Works** - BidBox becomes THE go-to directory
2. **Organic + Systematic Growth** - Network grows through admin seeding, CSLB harvesting, GC imports
3. **Future Revenue Enablers** - Compliance monitoring, lead generation, AI bid matching
4. **Defensibility** - 290,000+ contractor database requires months of effort to replicate

---

### 🗺️ Regional Filtering for California Projects

**Three California Regions:**
- **Southern CA** (7 counties): Imperial, Los Angeles, Orange, Riverside, San Bernardino, San Diego, Ventura
- **Central CA** (17 counties): Fresno, Inyo, Kern, Kings, Madera, Mariposa, Merced, Mono, Monterey, San Benito, San Joaquin, San Luis Obispo, Santa Barbara, Santa Cruz, Stanislaus, Tulare, Tuolumne
- **Northern CA** (34 counties): Alameda, Alpine, Amador, Butte, Calaveras, Colusa, Contra Costa, Del Norte, El Dorado, Glenn, Humboldt, Lake, Lassen, Marin, Mendocino, Modoc, Napa, Nevada, Placer, Plumas, Sacramento, San Francisco, San Mateo, Santa Clara, Shasta, Sierra, Siskiyou, Solano, Sonoma, Sutter, Tehama, Trinity, Yolo, Yuba

**Filtering Rules:**
- Projects require a county selection
- Network Pool subs filtered to same region as project county
- Private Pool subs remain unfiltered

---

# 2. Tasks

> **Source**: `docs/tasks.md`  
> **Note**: This is an excerpt. Full file is 1,672 lines.

# BidBox Implementation Tasks

**Source of Truth for Feature Implementation**  
Last Updated: 2026-01-01

---

## 🏗️ Architecture Note: State-Agnostic Licensing

> **CRITICAL**: BidBox uses a **future-proof, state-agnostic trade taxonomy**.
> 
> - `trade_types` table stores all license/trade types with `state_code` column
> - California CSLB is the **initial seed data**, not a permanent constraint
> - All tables use `trade_type_id` FK
> - **NEVER** hard-code license codes like "C-10" in components or logic

---

## 📋 Task Status Legend

- [ ] Not Started
- [x] Completed
- [🔄] In Progress
- [⚠️] Blocked/Needs Review

---

## 🔐 Security Decisions (Audit Reference)

### SD-001: Two-Pool Subcontractor Access Model [FINAL]

**Date**: 2025-12-15  
**Status**: Reviewed and closed — Do not reopen without product decision

**Summary**: BidBox uses two distinct subcontractor tables with different access models:

1. **`subcontractors`** (Network Pool) - Shared, BidBox-owned, readable by ALL authenticated users
2. **`gc_subcontractors`** (Private Pool) - Per-GC private directory, readable ONLY by owning GC

---

## 🔴 Phase 0: CRITICAL SECURITY FIXES ✅ COMPLETED

- [x] Task 0.1: Fix Projects Table RLS Policy
- [x] Task 0.2: Fix Project Files Table RLS Policy
- [x] Task 0.3: Fix Storage Bucket Policies
- [x] Task 0.4: Add File Upload Validation
- [x] Task 0.5: Enable Leaked Password Protection
- [x] Task 0.6: Implement Drag-and-Drop File Upload
- [x] Task 0.8: Fix Subs Network Trade Search URL Overflow

---

## ✅ Phase 1: MVP Foundation - COMPLETED

- [x] Task 1.1: Authentication System
- [x] Task 1.2: Projects Dashboard
- [x] Task 1.3: New Project Creation
- [x] Task 1.4: Project Detail View
- [x] Task 1.5: Public Bid Room Page

---

## 🎯 Phase 2: MVP Polish & Core Features

- [ ] Task 2.1: Add Countdown Timer to Bid Room
- [ ] Task 2.2: Late Bid Handling
- [x] Task 2.3: Make Location/Agency Fields Optional
- [x] Task 2.3.5: Update PRD with Final Branding
- [x] Task 2.3.6: Enhance Bid Room UI
- [x] Task 2.3.7: Fix Datetime Timezone Bug
- [ ] Task 2.4: Token Regeneration Feature
- [ ] Task 2.5: Settings Page Basic Structure

---

## 🚀 Phase 3: v1 Features (Post-MVP)

- [ ] Task 3.1: Download All Bids as ZIP
- [ ] Task 3.2: Email Notifications
- [ ] Task 3.3: CSV Export of Bids
- [ ] Task 3.4: PDF Preview
- [ ] Task 3.5: Basic Analytics Dashboard

---

## 💳 Phase 4: Stripe Integration ✅ COMPLETED

- [x] Task 4.1: Stripe Account & Product Setup
- [x] Task 4.2: Enable Stripe Integration
- [x] Task 4.3: Database Schema Updates
- [x] Task 4.4: Create `create-checkout` Edge Function
- [x] Task 4.5: Create `stripe-webhook` Edge Function
- [x] Task 4.6: Register Webhook in Stripe Dashboard
- [x] Task 4.7: Frontend Integration

---

## 🎯 Phase 3.5: Trade Selection Layer ✅ COMPLETED

- [x] Task 3.5.0: Create `trade_types` Reference Table
- [x] Task 3.5.1: Create `project_trades` Table
- [x] Task 3.5.2: Seed California CSLB License Types
- [x] Task 3.5.2.1: Add C-61 Limited Specialty D-Codes
- [x] Task 3.5.3: Add Trade Multi-Select to `/projects/new`
- [x] Task 3.5.4: Update Project Creation Logic
- [x] Task 3.5.5: Display Trades on Project Admin Page

---

## ✅ Phase 4: Subcontractor Directory - COMPLETED

- [x] Task 4.1: `subcontractors` table (BidBox Network Pool)
- [x] Task 4.2: `gc_subcontractors` table (GC Private Pool)
- [x] Task 4.3: Directory Management UI
- [x] Task 4.4: Junction tables for trade mapping

---

## 🎯 Phase 5: Engagement Tracking (Planned)

- [ ] Task 5.1: Track Plan Views
- [ ] Task 5.2: Track File Downloads
- [ ] Task 5.3: Display Engagement Status

---

## 🎯 Phase 6: Bid List Generator ✅ COMPLETED

- [x] Task 6.1: Build Bid List Generator Service
- [x] Task 6.2: Two-Sheet Excel Export
- [x] Task 6.3: BidListButton Component
- [x] Task 6.4: Integration
- [x] Task 6.4.1: Fix Network Subs Trade Bias Bug
- [x] Task 6.5: California County-Based Regional Filtering

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

**Status**: 🔄 In Progress

### Phase 7.1: Foundational Architecture ✅ MOSTLY COMPLETE

- [x] 7.1.1-7.1.6: Core infrastructure complete
- [x] 7.1.9: Enhanced progress logging

### Phase 7.6: Compliance & Scheduled Jobs

- [x] 7.6.0: Weekly CSLB data refresh cron job (Sundays 2 AM UTC)
- [🔄] 7.6.4: Network Pool Gap Recovery (offset 90,018 of ~290,000)

**Progress Tracking** (Updated: 2026-01-01):
| Run | Offset Range | New Contractors | Total Pool |
|-----|--------------|-----------------|------------|
| 1-6 | 0 → 30,006 | +77 | 224,606 |
| 7-10 | 30,006 → 55,011 | +38 | 224,644 |
| 11-17 | 55,011 → 90,018 | +127 | 224,771 |

---

# 3. GC Control Center PRD

> **Source**: `docs/gc-control-center-prd.md`

# BidBox GC Control Center PRD

**Strategic Product Requirements Document**  
Last Updated: 2025-12-28

---

## Executive Summary

BidBox is evolving from a "simple bid room" into the **GC Control Center** — a single, frictionless operating system for preconstruction that makes General Contractors more informed, organized, effective, and confident on bid day.

---

## 1. Updated Understanding of GC Workflows

- Bidding workflows are scattered across email, spreadsheets, Drive links, text messages, and whiteboards.
- Chasing subcontractors is **not** a problem to eliminate — it is a required and valuable part of the job.
- The REAL pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, compliance, and bid coverage**.
- Subcontractors will *ignore login systems* and *avoid portals*.
- GCs want a **simple hub** that gives them clarity, organization, and control.

---

## 2. The GC Control Center Vision

A single, frictionless operating system for preconstruction — one that makes GCs:

- **More informed** — Know which trades are covered and where gaps exist
- **More organized** — All subs, files, and quotes in one place
- **More effective** — Action-ready call lists ranked by priority
- **More confident on bid day** — Clear visibility into bid coverage

---

## 3. Guiding Principles

1. **Do Not Replace Phone Calls — Empower Them**
2. **Subs Must Experience Zero Friction** - No logins, no portals
3. **Clarity Beats Features**
4. **Local Specialization Is the Wedge** - California public works, license-type filtering

---

## 4. Why "Select Trades for Your Job" Is Foundational

Selecting trades (by license type) when creating a project becomes a **core system primitive**.

It enables:
- Mapping GC needs → Required subcontractor categories
- Generating trade-specific call sheets
- Surfacing trade-specific coverage gaps
- Tracking compliance per trade
- Enabling future AI features

---

## 5. Four Pillars of the Control Center

### Pillar 1 — Trade Intelligence
### Pillar 2 — Subcontractor Organization
### Pillar 3 — Engagement Visibility
### Pillar 4 — Bid-Day Command Center

---

## 6. Two-Pool Subcontractor Architecture

1. **GC's Private Pool** — Subcontractors the GC has personally added
2. **BidBox Network Pool** — Curated, verified subcontractors maintained by BidBox

### Regional Filtering
- County Selection: Required field on project creation
- Region Mapping: 58 CA counties → 3 regions
- Network Subs: Filtered to same region as project county
- Private Pool: Remains unfiltered

### Security Model
| Pool | Table | Access Rule |
|------|-------|-------------|
| Network Pool | `subcontractors` | All authenticated users |
| Private Pool | `gc_subcontractors` | GC's own rows only |

---

## 7. Queen Bee Features

### Primary: Trade Selection + Curated Sub Mapping
### Secondary: Call List Generator

---

## 10. Network Pool Moat Strategy

The BidBox Network Pool is a strategic competitive moat built through the CSLB Network Directory Seeding Initiative.

**Tiered Seeding Strategy:**
| Tier | Focus | Target Count |
|------|-------|--------------|
| Tier 1 | Hot Trades | ~50,000 |
| Tier 2 | Full CSLB Harvest | 290,000+ |
| Tier 3 | Enrichment | Ongoing |

---

# 4. Implementation Plan

> **Source**: `docs/implementation-plan.md`

## BidBox – Implementation Plan

### 🧱 Step-by-Step Build Sequence

**Phase 1 – Foundations** ✅ Complete
**Phase 2 – GC Internal Pages** ✅ Complete
**Phase 3 – Public Bid Page** ✅ Complete
**Phase 4 – Polish + Export** 🔄 In Progress

---

### GC Control Center Phases

**Phase 3.5 – Trade Selection Layer** ✅ Database Complete
**Phase 4 – Subcontractor Directory** ✅ Complete
**Phase 5 – Engagement Tracking** 📋 Planned
**Phase 6 – Call List Generator** ✅ Completed

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: 🔄 In Progress (Updated 2026-01-01)
> 
> - **Network Pool Size**: 224,771 contractors
> - **Gap Recovery**: In progress (offset 90,018 of ~290,000)
> - **License Range**: 8 to 1,148,273
> - **Weekly Cron**: Active (Sundays 2 AM UTC)

### Scraping Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CSLB Scraping Pipeline                   │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Scheduler│───▶│ Firecrawl│───▶│ Parser   │───▶│ Store │ │
│  │ (Cron)   │    │ /Browser │    │ /Mapper  │    │ (DB)  │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│                                                             │
│  Rate: 1 req/sec    Batch: 100-500    Resumable: Yes       │
└─────────────────────────────────────────────────────────────┘
```

---

# 5. Design Guidelines

> **Source**: `docs/design-guidelines.md`

## Emotional Thesis  
Feels like a contractor's war room — sharp, no-frills, deadline-driven. Every UI decision should scream: *"Don't screw this up on bid day."*

## Typography

- **H1** – Project titles: `Inter, Bold, 28px`
- **H2** – Section headers: `Inter, Semibold, 22px`
- **H3** – Labels: `Inter, Medium, 16px`
- **Body** – General text: `Inter, Regular, 14px`
- **Caption** – Metadata: `Inter, Light, 12px`

## Color System

| Purpose | Hex | Usage |
|---------|-----|-------|
| **Primary** (black) | `#121212` | Text, backgrounds |
| **BidBox Blue** | `#1D4ED8` | **PRIMARY BRAND COLOR** - CTAs, links, accents, icons |
| **Accent Orange** | `#D92D20` | Urgent badges only |
| **Soft Gray** | `#F4F4F5` | Backgrounds |
| **Outline** | `#E4E4E7` | Borders |
| **Success Green** | `#12B76A` | Success states |

## Layout & Spacing

- **Grid**: 8pt system
- **GC dashboard**: `max-width: 1200px`
- **Public bid page**: `max-width: 800px`

## Motion & Interaction

- **File upload success**: 250ms fade-in
- **Copy link**: 200ms glow
- **Countdown timer**: smooth tick, **digits remain black**

## Header & Branding

- **Sidebar Logo**: "BB" in vibrant blue (#1D4ED8)
- **Logo Strategy**: Use "BB" mark only — avoid duplicate "BidBox" text

## Voice & Tone

- Personality: Direct, helpful, focused
- Avoid humor, over-friendly nudges, or techy jargon

## Accessibility

- All form fields = labeled
- Buttons = `aria-pressed` and focus indicators
- Countdown timer = `aria-live="polite"`

---

# 6. App Flow - Pages and Roles

> **Source**: `docs/app-flow-pages-and-roles.md`

## 👤 User Roles

### 1. General Contractor (GC)
- Requires login (email/password)
- Can create and manage projects
- Can view bid submissions

### 2. Subcontractor (Sub)
- No login
- Accesses public `/bid/[token]` link
- Can view plans and submit bid

---

## 📄 Core Pages

### `/auth/*` - Register / Login for GCs only
### `/projects` - GC home dashboard
### `/projects/new` - Form to create a project
### `/projects/[id]` - GC admin view for individual project
### `/bid/[token]` - Public page with no login

---

## 🔄 End-to-End Flows

### GC Flow
1. Logs in → 2. Goes to `/projects` → 3. Creates project → 4. Uploads files → 5. Gets public link → 6. Shares with subs → 7. Receives bids → 8. Manages via `/projects/[id]`

### Sub Flow
1. Receives link → 2. Opens bid room → 3. Views plans → 4. Submits quote → 5. Gets confirmation

---

## 🔐 Access Rules

| Page | GC | Sub | Auth Required |
|------|----|-----|---------------|
| `/projects` | ✅ | ❌ | Yes |
| `/projects/new` | ✅ | ❌ | Yes |
| `/projects/[id]` | ✅ | ❌ | Yes |
| `/bid/[token]` | ❌ | ✅ | No |

---

# 7. BidBox BrandScript

> **Source**: `docs/bidbox_brandscript`

# 🔵 BidBox MVP — Full StoryBrand Framework

## 1. The Character (Hero)

**The hero is the GC estimator.**

He's juggling:
- Subcontractors who don't respond
- Dropbox links scattered across email
- Files too big to email
- Bid day chaos
- SmartBid / BuildingConnected that are bloated, slow, expensive
- "Did the sub get my plans?" uncertainty

He desperately wants **simplicity and control**.

---

## 2. The Problem

**External Problem** — "Bidding is chaos."
**Internal Problem** — "This shouldn't be this hard."
**Philosophical Problem** — "A modern GC shouldn't need enterprise software just to share files."

---

## 3. The Guide (BidBox)

You understand the workflow because you work in construction. You bring credibility through simplicity, reliability, and GC-first design.

---

## 4. The Plan

**Process Plan:**
1. Create a bid room - Upload plans → set due date → generate a link
2. Share with subs - Send the public link — no logins
3. Collect bids cleanly - Subs upload quotes → you receive everything in one place

**Agreement Plan:**
- Zero friction
- Zero logins for subs
- Zero bloat
- Always works

---

## 5. The Call to Action

**Direct CTA**: Start Free
**Transitional CTA**: See a Sample Bid Room

---

## 6. Failure (What They're Avoiding)

- Subs miss files
- Bids arrive late
- Hours wasted chasing emails
- Bid coverage suffers
- Money is lost

---

## 7. Success (The Transformation)

With BidBox:
- Estimators feel *in control*
- Subs respond faster
- Files never get lost
- Bid rooms look professional
- Everything becomes clear, predictable, trackable

The estimator transforms into a **calm, confident, organized leader**.

---

## ⭐ One-Liner

**"BidBox helps general contractors share bid files instantly and collect subcontractor quotes without logins, confusion, or chaos — so you can win more bids with less stress."**

---

# 8. CSLB License Types

> **Source**: `docs/cslb-license-types.md`

# California CSLB License Types Reference

**For BidBox Trade Selection Feature**

## ⚠️ State-Agnostic Architecture Note

The BidBox architecture is **state-agnostic** and supports nationwide expansion.

---

## Class A — General Engineering
| Code | Name |
|------|------|
| A | General Engineering |

## Class B — General Building
| Code | Name |
|------|------|
| B | General Building |

## Class C — Specialty Contractors (Commonly Used)

| Code | Name |
|------|------|
| C-4 | Boiler, Hot Water Heating & Steam Fitting |
| C-7 | Low Voltage Systems |
| C-8 | Concrete |
| C-10 | Electrical |
| C-12 | Earthwork and Paving |
| C-13 | Fencing |
| C-15 | Flooring and Floor Covering |
| C-16 | Fire Protection |
| C-17 | Glazing |
| C-20 | HVAC |
| C-21 | Building Moving/Demolition |
| C-23 | Ornamental Metal |
| C-27 | Landscaping |
| C-29 | Masonry |
| C-33 | Painting and Decorating |
| C-34 | Pipeline |
| C-35 | Lathing and Plastering |
| C-36 | Plumbing |
| C-38 | Refrigeration |
| C-39 | Roofing |
| C-42 | Sanitation System |
| C-43 | Sheet Metal |
| C-45 | Electrical Sign |
| C-46 | Solar |
| C-50 | Reinforcing Steel |
| C-51 | Structural Steel |
| C-53 | Swimming Pool |
| C-54 | Ceramic and Mosaic Tile |
| C-55 | Water Conditioning |
| C-57 | Well Drilling |
| C-60 | Welding |
| C-61 | Limited Specialty |

## C-61 Limited Specialty — Active D-Codes (29 Total)

| Code | Name |
|------|------|
| C-61/D-3 | Awnings Contractor |
| C-61/D-4 | Central Vacuum Systems |
| C-61/D-6 | Concrete-Related Services |
| C-61/D-9 | Drilling, Blasting and Oil Field Work |
| C-61/D-10 | Elevated Floors |
| C-61/D-12 | Synthetic Products |
| C-61/D-16 | Hardware, Locks and Safes |
| C-61/D-21 | Machinery and Pumps |
| C-61/D-24 | Metal Products |
| C-61/D-28 | Doors, Gates and Activating Devices |
| C-61/D-29 | Paperhanging |
| C-61/D-30 | Pile Driving and Pressure Foundation Jacking |
| C-61/D-31 | Pole Installation and Maintenance |
| C-61/D-34 | Prefabricated Equipment |
| C-61/D-35 | Pool and Spa Maintenance |
| C-61/D-38 | Sand and Water Blasting |
| C-61/D-39 | Scaffolding |
| C-61/D-40 | Service Station Equipment and Maintenance |
| C-61/D-41 | Siding and Decking |
| C-61/D-42 | Non-Electrical Sign Installation |
| C-61/D-49 | Tree Service |
| C-61/D-50 | Suspended Ceilings |
| C-61/D-52 | Window Coverings |
| C-61/D-53 | Wood Tanks |
| C-61/D-56 | Trenching Only |
| C-61/D-59 | Hydroseed Spraying |
| C-61/D-62 | Air and Water Balancing |
| C-61/D-63 | Construction Clean-up |
| C-61/D-64 | Non-specialized |
| C-61/D-65 | Weatherization and Energy Conservation |

---

# 9. Admin KPI Panel Plan

> **Source**: `docs/admin_kpi_panel_plan.md`

# Admin KPI Analytics Panel — Plan

## 1. Purpose & Goals

### Why Platform KPIs Matter Now
- **Growth Monitoring**: Track GC acquisition and retention trends
- **Engagement Validation**: Measure if bid rooms are actually being used
- **Product-Market Fit**: Identify power users vs. one-time users

### Success Metrics
| Goal | Target |
|------|--------|
| GC Growth | +5 GCs/month |
| Engagement | 60%+ projects receive bids |
| Retention | 40%+ GCs active in 30d |

---

## 2. KPI Specifications (8 Metrics)

1. **Total Registered GCs**
2. **Active GCs (30d)**
3. **Total Projects Created**
4. **Projects per GC**
5. **Total Bid Submissions**
6. **Avg Bids per Project**
7. **Conversion Rate**
8. **Bid Room Views**

---

## 3. Data Architecture

- Admin Role System with `user_roles` table
- `has_role()` Security Definer Function
- View count tracking on projects table

---

## 4. Frontend Architecture

- Route: `/admin/analytics`
- Components: KPICard, KPIGrid, GCMetricsTable

---

# 10. Admin KPI Tasks

> **Source**: `docs/admin_kpi_tasks.md`

# Admin KPI Analytics Panel — Implementation Tasks

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 | 6 tasks | ✅ Completed |
| Phase 2 | 10 tasks | ✅ Completed |
| Phase 3 | 3 tasks | ✅ Completed |
| Phase 4 | 7 tasks | ✅ Completed |
| Phase 5 | 5 tasks | ✅ Completed |
| **Total** | **31 tasks** | **✅ All Complete** |

All phases of the Admin KPI Analytics Panel have been successfully implemented.

---

# 11. Stripe Integration Guide

> **Source**: `docs/stripe.md`  
> **Note**: Full file is 5,198 lines. This is an excerpt of key sections.

# How to integrate Stripe

## Payment Links Approach (Recommended)

### Why Payment Links:
- Easiest to Implement
- No Complex Backend Logic
- Minimal Security Risk
- Quick Time-to-Market

### Implementation Plan:
1. Create a Supabase Edge Function to generate a Stripe checkout session
2. When a user hits their generation limit, offer a purchase option
3. After successful payment, update their credits in the profiles table

---

## The Checkout Session Object

Key attributes:
- `id` - Unique identifier
- `mode` - payment, setup, or subscription
- `payment_status` - paid, unpaid, no_payment_required
- `success_url` - Redirect URL after success
- `url` - The checkout URL

---

## Webhooks

Subscribe to:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

---

# 12. Stripe Steps

> **Source**: `docs/stripe-steps.md`

# Stripe Integration Guide (React + Supabase + Edge Functions)

## ✅ Step 1: Stripe Dashboard Setup

1. Create One-Time Product: "Early Access Lifetime" - $199
2. Create Subscription Product: "Tier 1" - $49/month (future)

## ✅ Step 2: Supabase Database Schema

- `profiles` table with `stripe_customer_id`
- `subscriptions` table

## ✅ Step 3: Environment Variables

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## ✅ Step 4: Create Checkout Session Edge Function

Location: `supabase/functions/create-checkout/index.ts`

## ✅ Step 5: React Integration

## ✅ Step 6: Stripe Webhook Edge Function

Location: `supabase/functions/stripe-webhook/index.ts`

## ✅ Step 7: Testing & Going Live

---

# 13. Stripe Tasks

> **Source**: `docs/stripe-tasks.md`

## Task Summary

| Component | Status |
|-----------|--------|
| Stripe products/prices | ✅ Done |
| Stripe API keys | ✅ Done |
| Database schema | ✅ Done |
| create-checkout function | ✅ Done |
| stripe-webhook function | ✅ Done |
| Webhook endpoint | ✅ Done (Live Mode) |
| Frontend integration | ✅ Done |
| useSubscription hook | ✅ Done |
| Free tier enforcement | ✅ Done |

---

# 14. Bug Prompt Template

> **Source**: `docs/bug_prompt.md`

# BidBox Bug Report Template

*A structured approach to single-pass bug fixes*

## Phase 1: Evidence Gathering

- Environment & Route
- Reproduction Steps
- Expected vs Actual Behavior
- Visual Evidence
- Data Context

## Phase 2: Root-Cause Analysis Checklist

- UI Layer
- RLS Policies
- Storage Buckets
- Edge Functions
- Client-Side Logic

## Phase 3: One Coherent Solution Plan

**DO NOT** propose incremental patches. Propose a complete fix.

## Phase 4: Verify & Test Matrix

- Core Functionality
- Edge Cases
- Regression Tests

## What NOT to Do

- ❌ Incremental Guessing
- ❌ Environment Confusion
- ❌ Vague Descriptions
- ❌ Missing User Context
- ❌ Skipping Verification

---

# 15. Bug: Header Tagline Visibility

> **Source**: `docs/bug-header-tagline-visibility.md`

## Issue Summary
The tagline "Bid Better, Win More." appears under the BidBox header logo in the external preview window and published site.

## Affected File
`src/components/Layout.tsx` - PublicLayout component, lines 158-173

## Status
Pending user clarification - was the tagline intentional or should it be removed?

---

# 16. Bug: Sign Out Failure

> **Source**: `docs/bug-report-sign-out-failure.md`

## Issue Summary
User authentication sign out fails with an error toast "Failed to sign out".

## Steps to Reproduce
1. Navigate to `/projects`
2. Open sidebar
3. Click "Logout"

## Possible Causes
- Supabase Auth Session Issue
- Client State Mismatch
- RLS Policy Conflict

## Suggested Fixes
1. Add error logging to toast message
2. Force local signout by clearing localStorage/sessionStorage
3. Implement retry logic

---

# 17. Reddit Pain Points (Research)

> **Source**: `docs/reddit_painpoints`  
> **Note**: Full file is 6,984 lines. This is a summary of key themes.

## Key Themes from Reddit Research

### 🚨 Theme 1: "I hate platforms that require subs to log in."
- Subs will ignore login systems
- Proprietary portals are a "royal PIA"
- Many subs simply won't bid work requiring portal entry

### 🚨 Theme 2: "Everything in bidding is overly complicated."
- GCs juggle too many tools: email, spreadsheets, text, multiple portals
- Estimators spend too much time on admin tasks
- Need for simple, streamlined process

### 🚨 Theme 3: "I don't want to pay enterprise pricing for basic features."
- BuildingConnected, Procore seen as overpriced
- Small/mid GCs priced out of good tools
- Need affordable alternatives

### Sub Perspective Pain Points
- Having to use multiple different bidding systems
- Each GC uses different platforms
- "I currently have active accounts in iSQFT, iBeam, Procore, PanteraTools, Buzzsaw, BIM360, Bluebeam Studio, PlanGrid, Fieldwire..."

### GC Perspective Pain Points
- Managing 60 trades with 3 bids per trade = 180 companies
- Organizing bids from multiple sources (email, text, fax, portals)
- Getting subs to respond consistently

### Market Opportunity
- Need for aggregation platform for subs
- Need for simple, affordable GC-focused tool
- Local specialization as competitive advantage
- Zero-friction for subcontractors is essential

---

**End of BidBox Complete Documentation**

*Total documents included: 17*  
*Last generated: 2026-01-04*
