## BidBox – Implementation Plan

---

### 🧱 Step-by-Step Build Sequence

**Phase 1 – Foundations: Data Model + Storage** ✅ Complete

- [x] Set up Supabase project with Postgres + Storage  
- [x] Create tables: `users`, `projects`, `project_files`, `bids`  
- [x] Enable Supabase Auth (email/password for GCs only)  
- [x] Create Supabase Storage bucket: `project-files`  
- [x] Write helper: generate secure `public_token` for each project

---

**Phase 2 – GC Internal Pages (Private)** ✅ Complete

- [x] `/auth/register` & `/auth/login`  
  - GC signup/login form  
  - Save `company_name`, email, password

- [x] `/projects` (GC dashboard)  
  - Show tile layout of all GC's projects  
  - Each tile: name, bid due, status, submission count, copy public link  
  - "+ New Project" tile → `/projects/new`

- [x] `/projects/new`  
  - Form: project name, location, agency, due date, instructions  
  - File upload component (multiple PDF uploads)  
  - On submit:  
    - Save project + metadata  
    - Store files in Supabase  
    - Generate `public_token`  
    - Redirect to `/projects/[id]`

- [x] `/projects/[id]`  
  - Show/edit project metadata (bid due, status)  
  - Display uploaded files (view/delete/add)  
  - Show all bids submitted (name, timestamp, file links)  
  - Button: "Download All Bids" (ZIP — stretch goal)

---

**Phase 3 – Public Bid Page (No Login)** ✅ Complete

- [x] `/bid/[token]` public route  
  - Load project via `public_token`  
  - Show: name, agency, due date, instructions  
  - "Download Project Files" list  
  - Countdown timer  
  - "Submit Your Quote" button (opens modal)

- [x] Submit Quote Modal  
  - Fields: name, company, email, bid item (optional), file upload  
  - Validate file type (.pdf, .xls, .docx)  
  - On submit:  
    - Save `bid` row in DB  
    - Store file in Supabase  
    - Show confirmation message

---

**Phase 4 – Polish + Export** 🔄 In Progress

- [ ] Add "Download All Submissions" as ZIP (GC side)  
- [ ] Format export CSV (name, company, email, file link, timestamp)  
- [x] Make `/bid/[token]` responsive (mobile-first)  
- [x] PDF previewer  
- [x] Add 200–300ms fade-in success message for subs
- [x] Calendar print single-page output (iframe-based)
  - Implementation: `src/lib/calendarPrint.ts`
  - Filename: `Bid_Calendar_YYYY-MM-DD` (today's date)
  - Guaranteed single-page via explicit sizing

---

**Phase 4.1 – GC Profile & Calendar Enhancements** ✅ Completed 2026-01-05

- [x] Estimating email field in /settings
- [x] Display estimating contact in public bid room (with mailto: link)
- [x] Job walk date/time field on projects (create + edit)
- [x] Calendar integration for job walk events (gray badge)
- [x] Calendar event redesign (header/title/subtitle hierarchy)
- [x] Calendar size and layout improvements (expanded footprint)
- [x] Network subs pagination (50/page, 1,000 UI cap)
- [x] Network subs full export (bypasses UI limit)
- [x] License status badge standardization ("active" instead of "clear")
- [x] Required trades display on public bid room
- [x] File upload drag-and-drop audit (pilot readiness)

---

## 🎯 GC Control Center Phases (NEW)

### **Phase 3.5 – Trade Selection Layer** ✅ Database Complete

**Objective:** Allow GCs to select required trades (by license type) when creating a project.

> **⚠️ ARCHITECTURAL PRINCIPLE**: The licensing system is **state-agnostic**. California CSLB is the initial seed data, but the architecture supports nationwide expansion without code changes.

- [x] 3.5.0 Create `trade_types` reference table (STATE-AGNOSTIC)
  ```sql
  id (uuid, PK)
  state_code (text, nullable)   -- "CA", "TX", "FL", null for national
  code (text)                   -- "C-10", "Roofing", etc.
  name (text)                   -- "Electrical"
  category (text)               -- "Mechanical", "Civil", etc.
  source (text)                 -- "CSLB", "TDLR", "DBPR", "CUSTOM"
  is_default (boolean)
  created_at (timestamptz)
  UNIQUE(state_code, code)
  ```

- [x] 3.5.1 Create `project_trades` table with FK to `trade_types`
  ```sql
  id (uuid, PK)
  project_id (uuid, FK → projects.id)
  trade_type_id (uuid, FK → trade_types.id)  -- NOT hard-coded strings!
  created_at (timestamptz)
  UNIQUE(project_id, trade_type_id)
  ```

- [x] 3.5.2 Seed California CSLB license types
  - 43 trade types seeded with state_code='CA', source='CSLB'
  - Includes: General (A, B), Specialty (C-4 through C-61)

- [ ] 3.5.3 Add trade multi-select UI to `/projects/new`
  - Fetch trade types dynamically from database
  - Filter by `state_code = 'CA'` for MVP
  - Display selected trades as chips/tags

- [ ] 3.5.4 Update project creation logic
  - Insert selected `trade_type_id`s into `project_trades` table

- [ ] 3.5.5 Display selected trades on `/projects/[id]` admin page
  - Join `project_trades` with `trade_types`
  - Show trade chips with category-based colors

---

### **Phase 4 – Subcontractor Directory** ✅ Complete (Phase 4.0)

**Objective:** Create two-pool architecture for subcontractor management.

> **⚠️ IMPORTANT**: All subcontractor tables use `trade_type_id` FK via junction tables, NOT hard-coded license strings.

- [x] 4.0 CSLB License Lookup Microservice
  - Edge function `lookup-cslb` with caching
  - Scrapes CSLB website for license data
  - Maps classifications to `trade_type_id`
  - 30-day cache in `cslb_cache` table

- [x] 4.1 Create `subcontractors` table (BidBox Network Pool)
  - Junction table `sub_trade_mappings` for multi-trade support
  - Admin-only write access via RLS

- [x] 4.2 Create `gc_subcontractors` table (GC's Private Pool)
  - Junction table `gc_sub_trade_mappings` for multi-trade support
  - GC-isolated via RLS policies

- [x] 4.3 Build GC Private Pool UI (`/settings/subcontractors`)
  - Add/edit/delete private subs
  - CSLB lookup auto-fill
  - Manual fallback with TradeMultiSelect

- [x] 4.0a Admin Network Seeder UI (`/admin/network-subs`)
  - Admin-only page for managing network pool
  - CSLB lookup or manual entry
  - Starts empty (seed later)

- [x] 4.4 Project → Sub matching logic
  - Query by `trade_type_id` via junction tables
  - Foundation for Call List Generator (Phase 6)

**Deferred to Phase 4.1+:**
- [ ] 4.5 Bulk CSLB seeding for statewide network
- [ ] 4.6 Nightly cron for license expiration monitoring
- [ ] 4.7 Network Pool UI for GCs (read-only view)

---

### **Phase 5 – Engagement Tracking** 📋 Planned

**Objective:** Track subcontractor engagement with bid rooms.

- [ ] 5.1 Track plan views
  - Enhance existing `view_count` or create detailed tracking

- [ ] 5.2 Track file downloads
  - New tracking table or column
  - Log which sub downloaded which file

- [ ] 5.3 Display engagement status per sub
  - Status: Not opened / Viewed / Downloaded / Submitted

---

### **Phase 6 – Call List Generator** 📋 Planned

**Objective:** Provide GCs with a ranked Excel call list based on project sub pool.

- [ ] 6.1 Build ranking logic
  - Priority order:
    1. Not opened → highest priority
    2. Viewed but not downloaded
    3. Downloaded but no quote
    4. Submitted a quote → lowest priority

- [ ] 6.2 Merge two pools for project coverage
  - Combine GC's Private Pool + BidBox Network Pool
  - Filter by `trade_type_id` (not string matching)
  - Join with `trade_types` for display names

- [ ] 6.3 Generate Excel (.xlsx) output
  - Grouped by trade (from `trade_types.name`)
  - Sorted by engagement priority
  - Columns: Name, Company, Phone, Email, Trade, State, Engagement Status

- [ ] 6.4 Add "Generate Call List (Excel)" button
  - Location: Project admin view
  - Download `.xlsx` file on click

---

### ⏱️ Timeline with Checkpoints

| Day(s) | Tasks |  
|--------|-------|  
| 1–2 | Set up Supabase project, tables, auth ✅ |  
| 3–4 | Build GC auth flow + dashboard (`/projects`) ✅ |  
| 5–6 | Implement project creation form + file upload ✅ |  
| 7–8 | Build GC project admin view (`/projects/[id]`) ✅ |  
| 9–10 | Build public `/bid/[token]` page + form ✅ |  
| 11 | Bid submission + confirmation handling ✅ |  
| 12 | Polish dashboard layout, exports 🔄 |  
| 13 | Mobile + UX polish ✅ |  
| 14 | Stripe integration ✅ |
| 15-16 | Phase 3.5: Trade Selection Layer 📋 |
| 17-18 | Phase 4: Subcontractor Directory 📋 |
| 19-20 | Phase 5: Engagement Tracking 📋 |
| 21-22 | Phase 6: Call List Generator 📋 |

---

### 👥 Team Roles & Rituals

**You (Solo Builder / Dev-CTO)**

- Drive build forward  
- Make clear scope trade-offs  
- Use Lovable for scaffolding, then refine by hand

**Optional Usability Helpers**

- Ask 1 estimator friend to try `/projects/new` form  
- Ask 1 sub to upload a test bid from `/bid/[token]`

**Rituals**

- ✅ Test each screen solo with fake data before launch  
- 🧪 Run a 3-user test on public `/bid/[token]` before sharing  
- 🧹 Set a 30-minute design debt cleanup after build

---

### 🚀 Optional Integrations & Stretch Goals

- [x] Countdown timer (public page)  
- [x] PDF embed viewer  
- [ ] "Download all bids" ZIP  
- [ ] Basic spam protection (rate limit uploads)  
- [x] Light usage analytics per GC (Admin KPI panel)  
- [ ] Add password reset (Supabase auth helper)
- [ ] Compliance tracking (COIs, license expirations)
- [ ] AI bid diff tools

---

## 🚀 Phase 7: CSLB Network Directory Seeding Initiative

> **Status**: 🔄 In Progress (Updated 2026-01-01)
> 
> - **Network Pool Size**: 224,771 contractors
> - **Gap Recovery**: In progress (offset 90,018 of ~290,000)  
> - **License Range**: 8 to 1,148,273
> - **Weekly Cron**: Active (Sundays 2 AM UTC)
> 
> This phase outlines the strategic initiative to populate the BidBox Network Pool with 290,000+ California CSLB-licensed contractors.

### Objective

Transform BidBox into the central directory for California public works subcontractors by systematically harvesting and enriching CSLB license data.

### Why This Builds Defensibility

- **Curated California directory** = local specialization wedge
- **Competitors need months of scraping effort** to replicate
- **Network grows organically** via GC imports + systematic seeding
- **Enables future revenue features**: compliance monitoring, lead gen, AI matching

---

### Scraping Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CSLB Scraping Pipeline                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐ │
│  │ Scheduler│───▶│ Firecrawl│───▶│ Parser   │───▶│ Store │ │
│  │ (Cron)   │    │ /Browser │    │ /Mapper  │    │ (DB)  │ │
│  └──────────┘    └──────────┘    └──────────┘    └───────┘ │
│                                                             │
│  Rate: 1 req/sec    Batch: 100-500    Resumable: Yes       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Key Components:**

1. **Scheduler (Supabase pg_cron)**
   - Triggers batch jobs at configured intervals
   - Tracks last-processed license number for resumability
   - Runs during off-peak hours (2-6 AM PT)

2. **Scraper (Firecrawl preferred)**
   - Rate limited: Max 1 request/second
   - Batch size: 100-500 licenses per job
   - Fallback: Headless browser (Puppeteer)
   - Error recovery with exponential backoff

3. **Parser/Mapper**
   - Extract: company_name, license_status, expiration_date, classifications
   - Map CSLB classifications → `trade_type_id` via lookup
   - Normalize: phone format, company name capitalization, city names

4. **Storage**
   - Insert/update `subcontractors` table
   - Create `sub_trade_mappings` entries for multi-trade contractors
   - Update `cslb_cache` for fast lookups

---

### Multi-Step Ingestion Flow

```
1. Fetch CSLB license page via Firecrawl
   └─▶ URL: https://cslb.ca.gov/OnlineServices/CheckLicenseII/...

2. Parse HTML for contractor data
   └─▶ company_name, license_status, expiration_date, city, classifications

3. Map each classification to trade_type_id
   └─▶ "C-10" → trade_types.id WHERE code='C-10' AND state_code='CA'
   └─▶ Handle multi-classification (e.g., "C-10, C-46")

4. Normalize data
   └─▶ Phone: (XXX) XXX-XXXX
   └─▶ Company: Title Case, remove Inc./LLC variations
   └─▶ City: Match to standardized list

5. Check for existing entry (dedupe)
   └─▶ Primary key: license_number (unique)
   └─▶ If exists: UPDATE, else: INSERT

6. Insert/update subcontractors + sub_trade_mappings
   └─▶ Set is_verified = true for CSLB-sourced data

7. Update cslb_cache for future lookups
   └─▶ TTL: 30 days
```

---

### GC Excel Import Flow

```
1. GC uploads .xlsx via frontend
   └─▶ Drag-and-drop or file picker

2. Edge function parses rows
   └─▶ Use xlsx library for parsing

3. AI detects columns (optional)
   └─▶ OpenAI: "Which column contains license numbers?"
   └─▶ Fallback: Fixed template format

4. For each row with license_number → CSLB lookup
   └─▶ Check cslb_cache first (30-day TTL)
   └─▶ If cache miss: scrape CSLB live

5. Insert into gc_subcontractors + gc_sub_trade_mappings
   └─▶ Link to GC via gc_id = auth.uid()

6. Return success/error summary
   └─▶ "Imported 45/50, 5 errors (click to view)"
```

---

### Tiered Seeding Strategy

| Tier | Focus | Est. Count | Timeline |
|------|-------|------------|----------|
| **Tier 1** | Hot Trades (C-10, C-20, C-36, etc.) | ~50,000 | 1-2 weeks |
| **Tier 2** | Full CSLB Harvest | 290,000+ | 2-4 weeks |
| **Tier 3** | Enrichment (emails, websites) | Ongoing | Continuous |

---

### Legal & Operational Considerations

- CSLB data is **publicly available** on cslb.ca.gov
- Scraping must be **rate-limited** (1 req/sec) to avoid IP blocks
- BidBox is **NOT** a licensed contractor verification authority
- We provide **convenience + pre-classification**, not official verification
- Data is for **internal GC use**, not public redistribution
- Subs can **request removal** if desired

---
