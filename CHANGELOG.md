# BidBox Changelog

All notable changes to the BidBox project are documented in this file.

---

## [Phase 1 Session 1] – 2026-05-26

### 🎯 Phase Objective
Lay the foundation for automated bid opportunity discovery — enabling BidBox to scan public procurement portals, surface new bid opportunities, and allow GCs to review and convert them into active projects with one click.

---

### Database

#### New Tables

1. **`opportunity_sources`** — Configuration for procurement portals to monitor.
   - `id` (uuid, PK), `name`, `portal_type`, `listing_url`, `scan_enabled`, `scan_interval_hours`, `last_scanned_at`
   - Supports multiple portal types: `planetbids`, `caltrans`, `epro`, `ersp`, `bonfirehub`, `ramp`

2. **`opportunity_candidates`** — Raw bid opportunities discovered during scans.
   - `id` (uuid, PK), `source_id` (FK), `source_url` (unique), `portal_type`, `raw_title`, `agency`, `bid_due_at`, `scope_text`
   - Review workflow: `status` (pending | red | yellow | green | converted), `review_notes`, `reviewed_by`, `reviewed_at`, `converted_project_id`
   - Unique constraint on `source_url` to prevent duplicates across rescans

3. **`agent_runs`** — Audit log for every scan execution.
   - `id` (uuid, PK), `source_id` (FK), `started_at`, `completed_at`, `candidates_found`, `candidates_new`, `errors`, `raw_log`
   - Enables observability and debugging of scan pipeline issues

#### Seed Data

- **8 PlanetBids agencies seeded** across Southern California:
  - City of Irvine, City of Riverside, City of San Diego
  - Port of Long Beach, City of Long Beach, City of Carlsbad
  - Port of Los Angeles, City of Huntington Beach

---

### Backend

#### New Edge Function: `scan-opportunities`

- **Trigger:** Manual ("Scan Now" button) or scheduled (cron-ready)
- **Pipeline:**
  1. Reads enabled `opportunity_sources` from DB
  2. Scrapes each listing URL via **Firecrawl** (`waitFor` adapted per portal type — 8s for PlanetBids JS-rendered pages)
  3. Extracts individual opportunities via **Lovable AI Gateway** (Gemini 2.5 Flash) with structured tool-calling
  4. Upserts candidates into `opportunity_candidates` (URL-deduplicated)
  5. Logs execution to `agent_runs` with full raw logs
- **Dual extraction paths:**
  - **PlanetBids path:** Uses `extract_planetbids_opportunities` tool — filters Stage="Bidding", extracts `bid_id` from `/bo-detail/{id}` links, builds detail URLs via portal ID
  - **Generic path:** Uses `extract_opportunity_list` tool for non-PlanetBids portals with URL validation
- **Resilient design:** Always returns HTTP 200 with `success: false` on failure (per project contract)

---

### Frontend

#### New Page: `/opportunities`

- **Auth-gated** dashboard for reviewing discovered bid opportunities
- **Card grid layout** (responsive 1→2→3 columns)
- **Filter tabs:** All, Pending, Green, Yellow, Red, Converted (with live counts)
- **Per-card actions:**
  - Status triage (Red / Yellow / Green buttons)
  - Review notes input (auto-saves on blur)
  - External link to source URL
  - **"Convert to Project"** — one-click project creation:
    - Creates project from candidate metadata (`raw_title`, `agency`, `bid_due_at`, `source_url`, `portal_type`, `scope_text`)
    - Auto-triggers `crawl-project` edge function for background enrichment
    - Marks candidate as `converted` with `converted_project_id` FK
    - Toast with "View Project" action button
- **"Scan Now"** button with spinner state and last-scanned timestamp
- **Empty state** with contextual messaging and CTA

---

### Navigation

- Added `/opportunities` route to `App.tsx`
- Sidebar navigation link added (inferred from standard layout)

---

### Known Limitations / Next Steps

- Firecrawl API key required for scan functionality (currently stored in Lovable Cloud secrets)
- Scan is **manual-only** in Session 1; daily cron automation planned for Session 2
- No auto-classification of trades or scope analysis yet (candidate title is raw)
- Caltrans portal path deferred to Phase 1 Session 2
