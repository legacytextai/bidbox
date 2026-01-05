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
- ✅ Calendar print (single-page, iframe-based)
- ✅ Estimating email field + public display
- ✅ Job walk date tracking + calendar display
- ✅ Required trades display on public bid room
- ✅ Network subs pagination + full export

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

These features represent high-leverage, high-value AI capabilities that will differentiate BidBox after the MVP and v1 are stable. AI is not required for initial launch but is intended to be a major competitive advantage as the platform grows.

Here are three extremely high-value, actually valuable AI features that subcontractors AND GCs would truly appreciate — not gimmicks.
These would differentiate you from Procore and BuildingConnected.

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

GC gets a clean output like:

```
Division 16 — Electrical
- Sub A missing conduit demo
- Sub B excludes temp power
- Sub C 22% lower on fixtures but higher on panels
- All subs lack trenching; flag for addendum request
```

This feature ALONE is a $199/mo product.

**🔥 AI Feature #2 — Auto-Build CSI Trade Breakdown from Plans**

GC uploads plans/specs → AI automatically generates:
- CSI trade list
- Suggested subcategories
- Quantities or takeoff notes
- Risks and high-cost areas
- List of subcontractors needed

Example:
Upload plans → AI outputs:
```
- Earthwork — 3,500 CY import/export
- Paving — 12,000 SF
- Striping — 200 LF
- Concrete sidewalks — 3,200 SF
- Electrical — 12 pull boxes, panel upgrades
- Landscaping — 45 trees, irrigation redesign
```

This saves estimators HOURS.

**🔥 AI Feature #3 — Subcontractor Quote Risk Scoring**

AI evaluates each sub's proposal for:
- Ambiguity in scope
- Missing required items
- High-risk exclusions
- Possible underbidding
- Past bid patterns (local DB)
- Language indicating change order risk

Example:
```
Risk Score: 27/100 (Low)
✓ Clear scope
✓ No major exclusions
✓ Includes materials and labor
✓ Matches project plans

Risk Score: 81/100 (High)
⚠ Multiple vague exclusions
⚠ Missing required addendum references
⚠ "Alternate" wording in price
⚠ Under industry benchmark by 33%
```

GCs would LOVE THIS.

---

**Note:** AI features are not part of MVP or v1. These capabilities will be developed only after core workflows are stable and validated with early GCs and subcontractors.

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
