# BidBox Complete Documentation

> **Generated**: 2026-01-25  
> **Purpose**: Single-file reference for AI agents and external tools  
> **Usage**: Download and paste into ChatGPT, Claude, or other AI assistants for full project context  
> **Total Documents**: 18

---

## Table of Contents

1. [Masterplan](#1-masterplan)
2. [Tasks](#2-tasks)
3. [GC Control Center PRD](#3-gc-control-center-prd)
4. [Implementation Plan](#4-implementation-plan)
5. [One Link PRD](#5-one-link-prd)
6. [Design Guidelines](#6-design-guidelines)
7. [App Flow - Pages and Roles](#7-app-flow---pages-and-roles)
8. [BidBox BrandScript](#8-bidbox-brandscript)
9. [CSLB License Types](#9-cslb-license-types)
10. [Admin KPI Panel Plan](#10-admin-kpi-panel-plan)
11. [Admin KPI Tasks](#11-admin-kpi-tasks)
12. [Stripe Integration Guide](#12-stripe-integration-guide)
13. [Stripe Steps](#13-stripe-steps)
14. [Stripe Tasks](#14-stripe-tasks)
15. [Bug Prompt Template](#15-bug-prompt-template)
16. [Bug: Header Tagline Visibility](#16-bug-header-tagline-visibility)
17. [Bug: Sign Out Failure](#17-bug-sign-out-failure)
18. [Reddit Pain Points (Research)](#18-reddit-pain-points-research)

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

### ⭐ GC Control Center Direction

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

**Control Center Features (Implemented):**
- **Trade Selection**: Select required license types when creating projects (C-10 Electrical, C-20 HVAC, etc.)
- **Two-Pool Subcontractor Architecture**:
  - GC's Private Pool: Subs the GC has personally added
  - BidBox Network Pool: Curated, verified subcontractors
- **Call List Generator**: Excel export grouped by trade, sorted by engagement priority
- **Engagement Tracking**: Views, downloads, submissions per subcontractor
- **Coverage Intelligence**: Visual indicators showing which trades have coverage
- **One Link Project Ingestion**: Create projects from public works URLs with automatic metadata extraction

---

### 📊 Conceptual Data Model (ERD in words)

**profiles**    
- id (PK, FK → auth.users.id)
- email
- company_name
- created_at
- stripe_customer_id
- estimating_email (nullable) — Displayed as "Estimating Contact" on public bid room

**projects**    
- id    
- gc_id (FK → profiles)    
- name    
- location    
- agency    
- bid_due_at    
- job_walk_at (nullable) — Optional job walk date/time
- instructions    
- public_token    
- status ("live" or "dead")
- county
- timezone
- view_count
- source_url (nullable) — One Link source URL
- portal_type (nullable) — Detected portal type
- is_ready_to_bid (boolean) — Bid readiness status

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

**project_bid_readiness** (NEW)
- project_id (PK, FK → projects.id)
- bond_required, bond_delivery_method, bond_online_submitted, bond_in_person_delivered
- job_walk_mandatory, job_walk_completed, job_walk_attended_by
- addenda_issued, addenda_reviewed, addenda_reviewed_at
- proposal_prepared, proposal_signed, proposal_notarized
- bid_sheet_complete
- updated_at

**trade_types** (State-Agnostic Architecture)
- id (uuid, PK)
- state_code (nullable — "CA", "TX", "FL", null for national)
- code (text — "C-10", "Roofing", etc.)
- name (text — "Electrical")
- category (text — "Mechanical", "Civil", etc.)
- source (text — "CSLB", "TDLR", "DBPR", "CUSTOM")
- is_default (boolean)
- created_at

**project_trades**
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

> **Last Reviewed**: 2026-01-12

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

**References**: `docs/gc-control-center-prd.md` Section 6

---

### 🗺️ Phased Roadmap

**MVP (v0)** ✅ Complete  
- GC login + dashboard    
- Create project    
- Upload files    
- View public bid page    
- Accept uploads    
- View/manage bids  

**v1** ✅ Mostly Complete  
- Download all bids (ZIP/CSV)    
- Responsive mobile layout polish    
- PDF preview viewer    
- Countdown component
- ✅ Calendar print (single-page, iframe-based)
- ✅ Estimating email field + public display
- ✅ Job walk date tracking + calendar display
- ✅ Required trades display on public bid room
- ✅ Network subs pagination + full export
- ✅ **One Link project ingestion** (create from link, semantic extraction, daily re-crawl)
- ✅ **HighSignalPanel** (job walk, eligibility, estimate, bonds, addenda)
- ✅ **Calendar viewport optimization** (full month visible without scroll)
- ✅ **Bid Readiness Checklist** (2026-01-18)
  - Manual 5-section checklist for bid preparation verification
  - Sections: Bid Bond, Job Walk, Addenda, Proposal, Bid Sheet
  - Database-backed with auto-sync to `is_ready_to_bid` flag
  - Calendar and Projects page visual indicators (green/red badges)

**Phase 3.5: Trade Selection Layer** ✅ Database Complete  
- ✅ Create `trade_types` table (state-agnostic reference table)
- ✅ Create `project_trades` table (FK to trade_types)
- ✅ Seed California CSLB license types (43 trade types)
- 📋 Add trade multi-select to `/projects/new`
- 📋 Display selected trades on project admin page

**Phase 4: Subcontractor Directory** ✅ Complete  
- ✅ Create `subcontractors` table with `trade_type_id` FK (BidBox Network Pool)
- ✅ Create `gc_subcontractors` table with `trade_type_id` FK (GC's Private Pool)
- ✅ Build directory management UI
- ✅ Map subs to project trades via `trade_type_id`

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
- ✅ Webhook endpoint registered in Stripe Dashboard

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

### 🔗 One Link Project Ingestion (Complete)

> **Status**: ✅ COMPLETE (2026-01-12)

One Link enables GCs to create projects by pasting a public works project URL. BidBox extracts metadata, tracks changes, and becomes the system of record.

**What's Working**:
- Paste link → Auto-extract project details
- Background crawl with "Analyzing project..." loading UX
- Semantic extraction for job walk, eligibility, estimates, bonds, addenda
- Daily re-crawl (5 AM PST) with change detection
- Manual refresh button with staleness indicators
- HighSignalPanel displaying 5 risk signal columns

**Supported Portals**: Caltrans, PlanetBids, EPRO, ERSP, BonfireHub, RAMP LA

**Key Files**:
- `supabase/functions/crawl-project/index.ts` — Extraction engine
- `src/components/HighSignalPanel.tsx` — Risk signal display
- `src/components/ProjectSignals.tsx` — Source link + staleness

---

### 🗺️ Regional Filtering for California Projects

BidBox uses county-based regional filtering to provide GCs with geographically relevant Network Subs:

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
> **Last Updated**: 2026-01-18

# BidBox Implementation Tasks

**Source of Truth for Feature Implementation**

---

## 📅 Session Changelog

### 2026-01-18: Bid Readiness Checklist

**Completed**:
- Bid Readiness Checklist feature (Task 2.19)
- Calendar visual integration (readiness badges, color coding, ready counter)
- Projects page visual integration (ready/not ready badges)

**Key Insight**:
Estimators require explicit manual verification of bureaucratic requirements. The checklist prioritizes awareness and clarity over automation or enforcement. Each section must be consciously confirmed — the system makes no assumptions.

**Scope Boundaries** (intentionally not built):
- No automation of checklist completion
- No bid blocking based on readiness
- No notifications or reminders
- One Link documentation unchanged

---

## 🏗️ Architecture Note: State-Agnostic Licensing

> **CRITICAL**: BidBox uses a **future-proof, state-agnostic trade taxonomy**.
> 
> - `trade_types` table stores all license/trade types with `state_code` column
> - California CSLB is the **initial seed data**, not a permanent constraint
> - All tables use `trade_type_id` FK
> - **NEVER** hard-code license codes like "C-10" in components or logic

---

## 🔐 Security Decisions (Audit Reference)

### SD-001: Two-Pool Subcontractor Access Model [FINAL]

**Date**: 2025-12-15  
**Status**: Reviewed and closed — Do not reopen without product decision

**Summary**: BidBox uses two distinct subcontractor tables with different access models:
1. **`subcontractors`** (Network Pool) - Shared, BidBox-owned, readable by ALL authenticated users
2. **`gc_subcontractors`** (Private Pool) - Per-GC private directory, readable ONLY by owning GC

### SD-002 through SD-006: Additional Security Decisions

All documented in full `docs/tasks.md` — covers sub_trade_mappings, subscriptions, cslb_cache, and bids table protections.

---

## ✅ Phase 0: Critical Security Fixes - COMPLETED

All 8 security tasks completed including RLS policies, storage buckets, file validation, and drag-and-drop implementation.

---

## ✅ Phase 1: MVP Foundation - COMPLETED

All 5 tasks completed: Authentication, Projects Dashboard, New Project Creation, Project Detail View, Public Bid Room.

---

## ✅ Phase 2: MVP Polish & Core Features

Key completed tasks:
- Task 2.0: Calendar Print Single-Page Output ✅
- Task 2.3.7: Fix Datetime Timezone Bug ✅
- Task 2.6: Calendar Dashboard MVP ✅
- Task 2.15-2.17: One Link Project Ingestion ✅
- Task 2.18: Calendar Viewport Fit ✅
- Task 2.19: Bid Readiness Checklist ✅

---

## ✅ Phase 3.5: Trade Selection Layer - Database Complete

All schema tasks completed. UI tasks pending.

---

## ✅ Phase 4: Subcontractor Directory - COMPLETED

All 4 core tasks completed including Network Pool, Private Pool, Directory UI, and junction tables.

---

## ✅ Phase 6: Bid List Generator - COMPLETED

All tasks completed including two-sheet Excel export, regional filtering, and trade bias fix.

---

## 🔄 Phase 7: CSLB Network Directory Seeding - In Progress

**Status**: 224,771 contractors seeded  
**Gap Recovery**: offset 90,018 of ~290,000  
**Weekly Cron**: Active (Sundays 2 AM UTC)

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

## 4. Four Pillars of the Control Center

- **Pillar 1 — Trade Intelligence**: Select required trades, view coverage heatmap
- **Pillar 2 — Subcontractor Organization**: Two-pool architecture
- **Pillar 3 — Engagement Visibility**: Track views, downloads, submissions
- **Pillar 4 — Bid-Day Command Center**: Auto-generated call lists, coverage meters

---

## 6. Two-Pool Subcontractor Architecture

1. **GC's Private Pool** — Subcontractors the GC has personally added
2. **BidBox Network Pool** — Curated, verified subcontractors maintained by BidBox

### Security Model
| Pool | Table | Access Rule |
|------|-------|-------------|
| Network Pool | `subcontractors` | All authenticated users |
| Private Pool | `gc_subcontractors` | GC's own rows only |

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
**Phase 4.1 – GC Profile & Calendar Enhancements** ✅ Complete  
**Phase 4.2 – Bid Readiness Checklist** ✅ Complete (2026-01-18)  
**Phase 5 – Engagement Tracking** 📋 Planned  
**Phase 6 – Call List Generator** ✅ Completed  
**Phase 7 – CSLB Network Seeding** 🔄 In Progress

---

### Phase 4.2 – Bid Readiness Checklist ✅ Completed 2026-01-18

**Objective:** Provide estimators with a manual checklist to verify project-critical bureaucratic requirements before bid submission.

**Design Principles:**
- Manual confirmation required (no automation or assumptions)
- Estimator must consciously verify each requirement
- Awareness over enforcement

**Database Schema:**
- [x] Created `project_bid_readiness` table with all checklist fields
- [x] Added `is_ready_to_bid` boolean to `projects` table
- [x] Created `update_project_bid_readiness` trigger on checklist changes
- [x] Created `evaluate_bid_readiness()` SQL function for automatic status calculation

**Component Implementation:**
- [x] `BidReadinessChecklist` component (`src/components/BidReadinessChecklist.tsx`)
- [x] 5 collapsible Accordion sections
- [x] Status icons: Green CheckCircle2 (ready), Red filled Circle (not ready)
- [x] Progress indicator: 5 dots + X/5 counter in header
- [x] Auto-save on every interaction
- [x] Overall status banner: "READY TO BID" (all green) or "NOT READY TO BID (X items remaining)"

**Visual Integration:**
- [x] Calendar event readiness badges
- [x] Calendar color coding: Green card for ready, Red card for not ready
- [x] "Projects Ready for Bid" live counter tile on `/calendar` dashboard
- [x] "Ready to Submit" / "Not Ready to Submit" badges on `/projects` page

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: 🔄 In Progress (Updated 2026-01-01)
> 
> - **Network Pool Size**: 224,771 contractors
> - **Gap Recovery**: In progress (offset 90,018 of ~290,000)
> - **Weekly Cron**: Active (Sundays 2 AM UTC)

---

# 5. One Link PRD

> **Source**: `docs/one_link`

# 📘 PRD: One Link Project Ingestion Initiative

**Status:** ✅ Implementation Complete  
**Last Updated:** 2026-01-12

---

## 1. Executive Summary

The **One Link initiative** introduces a new primary workflow for creating and managing public works projects in BidBox:

> **Paste a public works project link → BidBox becomes the system of record.**

This initiative re-centers BidBox around **link-based project ingestion**, dramatically reducing setup friction, eliminating manual data entry, and enabling BidBox to act as a **daily project homebase**.

---

## 2. Goals & Non-Goals

### Goals
- Enable users to create a BidBox project by pasting a **single project link**
- Automatically extract and normalize key project metadata
- Surface risk signals (job walks, restrictions, gated docs, eligibility)
- Establish BidBox as the **system of record** for external projects
- Reduce time-to-project-creation to seconds

### Non-Goals (Phase 1)
- Opportunity discovery or crawling bid listings
- Automated bidding or submission
- Full document parsing or OCR

---

## 3. Supported Portals

| Portal | Type | Crawl Status |
|--------|------|--------------|
| Caltrans | State | ✅ Supported |
| PlanetBids | SaaS | ✅ Supported |
| EPRO | County | ✅ Supported |
| ERSP (LADWP) | Enterprise | ✅ Supported |
| BonfireHub | SaaS | ✅ Supported |
| RAMP LA | Aggregator | ✅ Supported |

---

## 4. Extracted Data Fields

**Core Metadata:**
- Project name, agency, location
- Bid due date/time
- Source URL, portal type

**Risk Signals (HighSignalPanel):**
- Job walk exists, mandatory, date/details
- Eligibility restrictions
- Estimate range
- Bond requirements
- Addenda count and dates

**Crawl Tracking:**
- `last_crawled_at` timestamp
- `crawl_snapshot` (raw extracted data)
- `crawl_changes` (delta since last crawl)

---

## 5. Implementation Files

- `supabase/functions/crawl-project/index.ts` — Main extraction engine
- `supabase/functions/recrawl-projects/index.ts` — Daily re-crawl cron
- `src/components/HighSignalPanel.tsx` — 5-column risk signal display
- `src/components/ProjectSignals.tsx` — Source link + staleness indicator

---

# 6. Design Guidelines

> **Source**: `docs/design-guidelines.md`

## Emotional Thesis  
Feels like a contractor's war room — sharp, no-frills, deadline-driven.

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
| **BidBox Blue** | `#1D4ED8` | **PRIMARY BRAND COLOR** - CTAs, links, accents |
| **Accent Orange** | `#D92D20` | Urgent badges only |
| **Soft Gray** | `#F4F4F5` | Backgrounds |
| **Success Green** | `#12B76A` | Success states, Ready badges |

## Layout & Spacing

- **Grid**: 8pt system
- **GC dashboard**: `max-width: 1200px`
- **Public bid page**: `max-width: 800px`

---

# 7. App Flow - Pages and Roles

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

| Route | Purpose | Auth |
|-------|---------|------|
| `/auth/*` | Register/Login | Public |
| `/calendar` | GC home dashboard | Required |
| `/projects` | All projects list | Required |
| `/projects/new` | Create project | Required |
| `/projects/[id]` | Project admin view | Required |
| `/bid/[token]` | Public bid room | No auth |
| `/settings` | GC profile/settings | Required |
| `/settings/subcontractors` | Private pool management | Required |
| `/subs-network` | Network pool browser | Required |
| `/admin/*` | Admin-only pages | Admin role |

---

# 8. BidBox BrandScript

> **Source**: `docs/bidbox_brandscript`

## The Hero
**The GC estimator** — juggling subs, scattered files, bid day chaos, and bloated enterprise tools.

## The Problem
- **External**: "Bidding is chaos."
- **Internal**: "This shouldn't be this hard."
- **Philosophical**: "A modern GC shouldn't need enterprise software just to share files."

## The Guide (BidBox)
You understand the workflow. You bring credibility through simplicity, reliability, and GC-first design.

## The Plan
1. Create a bid room - Upload plans → set due date → generate a link
2. Share with subs - Send the public link — no logins
3. Collect bids cleanly - Subs upload quotes → you receive everything in one place

## One-Liner
**"BidBox helps general contractors share bid files instantly and collect subcontractor quotes without logins, confusion, or chaos — so you can win more bids with less stress."**

---

# 9. CSLB License Types

> **Source**: `docs/cslb-license-types.md`

# California CSLB License Types Reference

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
| C-10 | Electrical |
| C-12 | Earthwork and Paving |
| C-20 | HVAC |
| C-27 | Landscaping |
| C-33 | Painting and Decorating |
| C-36 | Plumbing |
| C-39 | Roofing |
| C-43 | Sheet Metal |
| C-51 | Structural Steel |

(Full list of 43 trade types in database)

---

# 10. Admin KPI Panel Plan

> **Source**: `docs/admin_kpi_panel_plan.md`

## KPI Specifications (8 Metrics)

1. **Total Registered GCs**
2. **Active GCs (30d)**
3. **Total Projects Created**
4. **Projects per GC**
5. **Total Bid Submissions**
6. **Avg Bids per Project**
7. **Conversion Rate**
8. **Bid Room Views**

---

# 11. Admin KPI Tasks

> **Source**: `docs/admin_kpi_tasks.md`

## Summary

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1-5 | 31 tasks | ✅ All Complete |

All phases of the Admin KPI Analytics Panel have been successfully implemented.

---

# 12. Stripe Integration Guide

> **Source**: `docs/stripe.md`

## Payment Links Approach (Recommended)

### Implementation:
1. Create a Supabase Edge Function to generate a Stripe checkout session
2. When a user hits their generation limit, offer a purchase option
3. After successful payment, update their credits in the profiles table

---

# 13. Stripe Steps

> **Source**: `docs/stripe-steps.md`

## ✅ All Steps Complete

1. Stripe Dashboard Setup ✅
2. Supabase Database Schema ✅
3. Environment Variables ✅
4. Create Checkout Session Edge Function ✅
5. React Integration ✅
6. Stripe Webhook Edge Function ✅
7. Testing & Going Live ✅

---

# 14. Stripe Tasks

> **Source**: `docs/stripe-tasks.md`

## Task Summary — All Complete

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

# 15. Bug Prompt Template

> **Source**: `docs/bug_prompt.md`

# BidBox Bug Report Template

## Phase 1: Evidence Gathering
- Environment & Route
- Reproduction Steps
- Expected vs Actual Behavior
- Visual Evidence
- Data Context

## Phase 2: Root-Cause Analysis Checklist
- UI Layer, RLS Policies, Storage Buckets, Edge Functions, Client-Side Logic

## Phase 3: One Coherent Solution Plan
**DO NOT** propose incremental patches. Propose a complete fix.

## Phase 4: Verify & Test Matrix
- Core Functionality, Edge Cases, Regression Tests

---

# 16. Bug: Header Tagline Visibility

> **Source**: `docs/bug-header-tagline-visibility.md`

## Issue Summary
The tagline "Bid Better, Win More." appears under the BidBox header logo.

## Status
Pending user clarification.

---

# 17. Bug: Sign Out Failure

> **Source**: `docs/bug-report-sign-out-failure.md`

## Issue Summary
User authentication sign out fails with "Failed to sign out" error.

## Suggested Fixes
1. Add error logging to toast message
2. Force local signout by clearing localStorage
3. Implement retry logic

---

# 18. Reddit Pain Points (Research)

> **Source**: `docs/reddit_painpoints`

## Key Themes from Reddit Research

### 🚨 Theme 1: "I hate platforms that require subs to log in."
- Subs will ignore login systems
- Proprietary portals are a "royal PIA"

### 🚨 Theme 2: "Everything in bidding is overly complicated."
- GCs juggle too many tools
- Need for simple, streamlined process

### 🚨 Theme 3: "I don't want to pay enterprise pricing for basic features."
- BuildingConnected, Procore seen as overpriced
- Small/mid GCs priced out of good tools

### Market Opportunity
- Need for aggregation platform for subs
- Need for simple, affordable GC-focused tool
- Local specialization as competitive advantage
- Zero-friction for subcontractors is essential

---

**End of BidBox Complete Documentation**

*Total documents included: 18*  
*Last generated: 2026-01-25*
