# BidBox Complete Documentation

> **Generated**: 2025-12-28  
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

**Control Center Features:**
- **Trade Selection**: Select required license types when creating projects (C-10 Electrical, C-20 HVAC, etc.)
- **Two-Pool Subcontractor Architecture**:
  - GC's Private Pool: Subs the GC has personally added
  - BidBox Network Pool: Curated, verified subcontractors
- **Bid List Generator**: Excel export with two sheets ("My Subs" and "Network Subs"), filtered by trades and region
- **Regional Filtering**: Network Subs filtered by California region based on project county
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
- county (California county for regional filtering)
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

**Phase 4: Subcontractor Directory** ✅ Complete  
- ✅ Create `subcontractors` table with `trade_type_id` FK (BidBox Network Pool)
- ✅ Create `gc_subcontractors` table with `trade_type_id` FK (GC's Private Pool)
- ✅ Build directory management UI
- ✅ Map subs to project trades via `trade_type_id`

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

### 🗺️ Regional Filtering for California Projects

BidBox uses county-based regional filtering to provide GCs with geographically relevant Network Subs:

**Three California Regions:**
- **Southern CA** (7 counties): Imperial, Los Angeles, Orange, Riverside, San Bernardino, San Diego, Ventura
- **Central CA** (17 counties): Fresno, Inyo, Kern, Kings, Madera, Mariposa, Merced, Mono, Monterey, San Benito, San Joaquin, San Luis Obispo, Santa Barbara, Santa Cruz, Stanislaus, Tulare, Tuolumne
- **Northern CA** (34 counties): Alameda, Alpine, Amador, Butte, Calaveras, Colusa, Contra Costa, Del Norte, El Dorado, Glenn, Humboldt, Lake, Lassen, Marin, Mendocino, Modoc, Napa, Nevada, Placer, Plumas, Sacramento, San Francisco, San Mateo, Santa Clara, Shasta, Sierra, Siskiyou, Solano, Sonoma, Sutter, Tehama, Trinity, Yolo, Yuba

**Filtering Rules:**
- Projects require a county selection (dropdown on create/edit)
- Network Pool subs filtered to same region as project county
- Private Pool subs remain unfiltered (GC's trusted contacts have no geographic restriction)
- Region is derived at runtime from static mapping (not stored in DB)

**Implementation Files:**
- `src/lib/californiaRegions.ts` — Region mapping and utility functions
- `src/components/CountySelect.tsx` — Searchable county dropdown
- `src/lib/bidListGenerator.ts` — Regional filtering logic

---

### ⚠️ Risks & Mitigations

| Risk | Mitigation |  
|------|------------|  
| Subs upload junk files or spam | Add file type validation + upload rate limits |  
| GCs forget their links | Add copyable links in dashboard; regenerate token option |  
| File size too big | Enforce Supabase upload limits (25MB) |  
| Confusion between GC/public views | Use visual headers + URL structure (`/projects/[id]` vs `/bid/[token]`) |

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

---

# GC Control Center PRD

## BidBox GC Control Center PRD

**Strategic Product Requirements Document**  
Last Updated: 2025-12-28

---

### Executive Summary

BidBox is evolving from a "simple bid room" into the **GC Control Center** — a single, frictionless operating system for preconstruction that makes General Contractors more informed, organized, effective, and confident on bid day.

---

### 1. Updated Understanding of GC Workflows

Based on real Reddit conversations, estimator interviews, and field experience, we now have clarity on the *true* problems small-to-mid GCs face:

- Bidding workflows are scattered across email, spreadsheets, Drive links, text messages, and whiteboards.
- Chasing subcontractors is **not** a problem to eliminate — it is a required and valuable part of the job.
- The REAL pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, compliance, and bid coverage**.
- Subcontractors will *ignore login systems* and *avoid portals*. No GC software wins by forcing subs to adopt a system.
- GCs want a **simple hub** that gives them clarity, organization, and control — not automation gimmicks.

---

### 2. The GC Control Center Vision

A single, frictionless operating system for preconstruction — one that makes GCs:

- **More informed** — Know which trades are covered and where gaps exist
- **More organized** — All subs, files, and quotes in one place
- **More effective** — Action-ready call lists ranked by priority
- **More confident on bid day** — Clear visibility into bid coverage

---

### 3. Guiding Principles

#### Principle 1: Do Not Replace Phone Calls — Empower Them
GCs close gaps by calling subs. BidBox must surface insights that make these calls more efficient and targeted.

#### Principle 2: Subs Must Experience Zero Friction
No logins. No portals. No data entry. Just simple:  
**Click link → View plans → Upload quote.**

#### Principle 3: Clarity Beats Features
Our UI should provide the GC with immediate clarity into:
- Which trades are needed
- Which subs fit those trades
- Who has viewed the plans
- Who has downloaded the plans
- Who has not engaged
- Where bid coverage is thin

#### Principle 4: Local Specialization Is the Wedge
We specialize in **California public works**, **license-type filtering**, and **curated SoCal subcontractor directories**.  
This is something PlanHub and Dodge *cannot do*.

---

### 4. Why "Select Trades for Your Job" Is Foundational

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

### 5. Four Pillars of the Control Center

#### Pillar 1 — Trade Intelligence
- Select required trades (license-type dropdown + multi-select)
- View trade coverage heatmap
- Know instantly where your risks are

#### Pillar 2 — Subcontractor Organization
- For each trade, BidBox recommends vetted subs
- GC can add custom subs to their private pool
- Directory grows into a local advantage

#### Pillar 3 — Engagement Visibility
- See who viewed the plans
- See who downloaded documents
- See who submitted quotes
- See who requires follow-up

#### Pillar 4 — Bid-Day Command Center
- Auto-generated call list by trade
- Coverage meter per trade
- Compliance reminders (COIs, license expirations)
- Live quote intake

---

### 6. Two-Pool Subcontractor Architecture

#### Overview
The Bid List Generator pulls from **two distinct pools**:

1. **GC's Private Pool** — Subcontractors the GC has personally added and worked with
2. **BidBox Network Pool** — Curated, verified subcontractors maintained by BidBox

#### Benefits
- GCs get instant coverage even with an empty private pool
- Network pool provides California public works specialists
- GCs build their own trusted sub relationships over time
- Combined pools maximize bid coverage

#### Target User Flow
1. GC creates project → uploads plans
2. GC selects project county (required for regional filtering)
3. GC selects required trades (license types)
4. BidBox maps subs from **both pools** to selected trades
5. GC clicks **"Export Bid List (Excel)"**
6. BidBox outputs `.xlsx` with two sheets:
   - **My Subs**: GC's private pool contacts (unfiltered by region)
   - **Network Subs**: CSLB-sourced subs filtered by same region as project county

**Result:** GC has a geographically-relevant, trade-filtered contact list ready immediately.

#### Regional Filtering (NEW - 2025-12-28)

The Network Pool is filtered by California region to reduce noise and provide locally-relevant results:

- **County Selection**: Required field on project creation/edit
- **Region Mapping**: 58 CA counties → 3 regions (Southern, Central, Northern)
- **Filtering Rules**:
  - Network Subs: Filtered to same region as project county
  - Private Pool: Remains unfiltered (GC's trusted contacts work statewide)
- **Typical Results**: ~1,000-2,500 Network Subs per region (vs ~6,500 statewide)

#### Security Model (Audit Reference)

> **Decision ID**: SD-001  
> **Last Reviewed**: 2025-12-15  
> **Status**: Final — Do not reopen without product review

The two-pool architecture has **intentionally different access rules**:

| Pool | Table | Access Rule | Rationale |
|------|-------|-------------|-----------|
| Network Pool | `subcontractors` | All authenticated users | Shared directory, BidBox-owned, no GC ownership |
| Private Pool | `gc_subcontractors` | GC's own rows only | Proprietary contact list, strict RLS via `gc_id` |

**Why Network Pool is shared**:
- Enables instant coverage for GCs with empty private pools
- Powers Bid List Generator without requiring GC to build directory first
- Creates network effects (more subs → more value → more GCs)

**This is NOT a vulnerability**:
- Unauthenticated access is blocked (RLS requires `auth.uid() IS NOT NULL`)
- Competitor browsing is a business concern, not a security flaw
- If business decides to restrict visibility, use security definer functions scoped to project trades

---

### 7. Queen Bee Features

#### Primary: Trade Selection + Curated Sub Mapping
This backbone feature unlocks:
- Coverage intelligence
- Directory-driven subcontractor matching
- Engagement analytics
- Bid-day call prioritization
- Compliance tracking
- Future AI workflows

#### Secondary: Bid List Generator
The GC's primary "action layer" during bid-day operations.

**Purpose:** Give GCs a geographically-relevant, trade-filtered contact list that tells them: **Who to call, organized by trade and pool.**

**Output Format:** Downloadable Excel (.xlsx) file with two sheets:
- **My Subs**: GC's private pool (Company, Contact, Phone, Email, City, Trades, Notes)
- **Network Subs**: CSLB-sourced (Business Name, License #, Phone, City, County, Classification(s))

---

# Design Guidelines

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

---

# App Flow - Pages and Roles

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
- Fields: name, county (required), agency, bid date/time, instructions  
- Upload multiple files (PDFs)  
- Select required trades (multi-select)
- On submit:  
  - Save project to DB  
  - Upload files to Supabase Storage  
  - Generate public token and links  
  - Redirect to `/projects/[id]`

### 4. `/projects/[id]`  
- GC admin view for individual project  
- View/edit project metadata (including county)
- View/delete/add files  
- See list of bids with timestamps and filenames  
- "Export Bid List (Excel)" button
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
4. Completes form (including county selection) and uploads files    
5. Selects required trades
6. Gets public bid link    
7. Shares it with subs    
8. Exports Bid List (Excel) to get subcontractor contacts
9. Receives bids in real-time    
10. Manages project via `/projects/[id]`

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

**End of BidBox Complete Documentation**
