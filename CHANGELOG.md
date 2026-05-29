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

---

## [Phase 1 Sessions 2–3] – 2026-05-28

### 🎯 Phase Objective
Refine the opportunity discovery pipeline to PlanetBids-only sources, add a user qualification profile system so every discovered candidate is automatically pre-scored against the GC's real bid parameters, and update the dashboard to surface the most relevant candidates first.

---

### Phase 1A Refinements — Opportunity Discovery Pipeline

#### Sources Narrowed to PlanetBids Only

The original seed included Caltrans and a mix of portal types. The sources table was reseeded with 8 Southern California PlanetBids portals only:

- City of Irvine (Orange County)
- City of Riverside
- City of San Diego
- Port of Long Beach
- City of Long Beach
- City of Carlsbad
- Port of Los Angeles
- City of Huntington Beach

The reseed uses `DELETE FROM opportunity_sources` (which cascades to `opportunity_candidates`) before inserting. This was intentional — PlanetBids is the only reliably scrapeable portal type at this stage.

#### PlanetBids Extraction Refinement

The `scan-opportunities` edge function was updated with a PlanetBids-specific extraction path:

- Portal ID extracted from listing URL via regex (`/portal/(\d+)/`) before any scraping
- `waitFor: 8000ms` in Firecrawl to allow Ember.js rendering time
- LLM system prompt explicitly instructs: extract only rows where `Stage = Bidding`; exclude Closed, Rejected, Awarded
- `bid_id` extracted from `/bo-detail/{id}` hrefs found in scraped markdown; detail URL constructed as `https://vendors.planetbids.com/portal/{portalId}/bo/bo-detail/{bid_id}`
- `agency` always set to `source.name` (not LLM output) for consistency

**Known limitation — detail URL reliability:**
PlanetBids is built on Ember.js. The `/bo-detail/{bid_id}` links are rendered by JavaScript click handlers, not present as static `href` attributes in the initial page HTML. Firecrawl captures the rendered DOM as markdown, but `bid_id` extraction from that markdown is unreliable — some bids have discoverable links, many do not. Constructed detail URLs may point to incorrect bids. Two identified solutions for a future phase: **VendorLine API** ($395/year, structured PlanetBids data) or an **OpenClaw browser agent** capable of interacting with Ember.js UI directly.

**Known bug — free tier limit bypass:**
Converting an opportunity to a project via the Opportunities dashboard bypasses the 3-project free tier limit that exists on the standard New Project flow. Not yet fixed.

---

### Phase 1B — User Qualification Profile + Smart Filtering

#### Database Changes

**New table: `gc_qualification_profiles`**

Stores one row per user. `profile_id` is a FK to `profiles.id` (= `auth.uid()`) with a UNIQUE constraint — one profile per user. No company/tenant layer in this phase (see Architecture Decisions below).

| Column | Type | Description |
|---|---|---|
| `target_counties` | `text[]` | California counties the GC bids in |
| `licenses_held` | `text[]` | Contractor license classes held (e.g. A, B) |
| `min_project_value` | `numeric` | Minimum project value to consider |
| `max_project_value` | `numeric` | Maximum project value to consider |
| `bond_capacity` | `numeric` | Bonding capacity |
| `agency_exclusions` | `text[]` | Agencies to always auto-Red |
| `trade_categories` | `text[]` | Scopes of interest (empty = all trades) |

Array columns default to `'{}'` (not NULL) to simplify UI-side iteration. RLS: four policies (SELECT/INSERT/UPDATE/DELETE) all gated on `profile_id = auth.uid()`.

Seeded with one row for `constructionaisolutions.co@gmail.com`: Orange/LA/Riverside/San Diego counties, licenses A and B, $2M–$15M range, $50M bond capacity, no exclusions, all trades. Seed uses a subquery on `profiles.email` — no hardcoded UUIDs. If the email is not in `profiles` when the migration runs, the INSERT silently skips.

**New columns on `opportunity_candidates`:**

| Column | Type | Notes |
|---|---|---|
| `auto_status` | `text` | System-assigned: red/yellow/green. CHECK constraint. NULL = not yet qualified. |
| `auto_status_reason` | `text` | Human-readable explanation, e.g. "County unknown; Value not determinable" |
| `qualification_score` | `integer` | 0–100. CHECK constraint enforces range. |
| `qualified_at` | `timestamptz` | Timestamp of last auto-qualification run |

`auto_status` is completely separate from the manual `status` field. The auto-qualifier never reads or writes `status`. An index on `auto_status` was added for dashboard sort performance.

Migration file: `supabase/migrations/20260528000001_gc_qualification_profiles.sql`

#### New Edge Function: `qualify-candidates`

Registered with `verify_jwt = true`. Accepts optional `candidate_id` (qualify one) or `profile_id` (qualify all pending for a specific user) in the POST body. Defaults to `auth.uid()` if neither is provided.

**Execution flow:**

1. Identifies calling user from Bearer token via `supabase.auth.getUser()`
2. Loads `gc_qualification_profiles` for the resolved user — returns early with a message if no profile exists; candidates stay `auto_status = null`
3. Loads all `opportunity_candidates` where `status = 'pending'` (manually reviewed candidates are never touched)
4. Runs each candidate through the rule engine
5. Writes `auto_status`, `auto_status_reason`, `qualification_score`, `qualified_at` to each row individually
6. Returns `{ evaluated, auto_green, auto_yellow, auto_red, skipped, errors }`

**Qualification rule engine:**

Red rules are evaluated first. If any Red rule fires, Yellow is not evaluated. Yellow flags are all collected (not short-circuited). Green is assigned if nothing fired.

*Red rules (hard disqualifiers):*
- Agency matches an entry in `agency_exclusions` (case-insensitive)
- County is confirmed and outside all `target_counties`
- Extracted value is confirmed and below `min_project_value`
- Extracted value is confirmed and above `max_project_value`

*Yellow rules (soft flags — all collected):*
- County cannot be determined from available data
- Project value cannot be determined from available data
- `bid_due_at` is within 5 days of now
- `scope_text` is null or fewer than 50 characters

*Green:* assigned if no Red or Yellow fired.

**Scoring:**
- Red: 5–10
- Yellow: 30–50, minus 10 per additional Yellow flag (floor 30)
- Green: 70 base, +10 for confirmed county match, +10 for confirmed value in range (ceiling 100)

**County inference:**
At the candidate stage, `crawl_data` is not populated — only `raw_title`, `agency`, `bid_due_at`, and `source_url` come from the listing scrape. County is inferred by mapping the `agency` field through a static `AGENCY_COUNTY` lookup table inside the edge function. `crawl_data.county` is checked first if present.

**⚠️ Important:** `AGENCY_COUNTY` is a hardcoded map of exact `source.name` strings to California counties. When new rows are added to `opportunity_sources`, a corresponding entry must be manually added to `AGENCY_COUNTY` in `supabase/functions/qualify-candidates/index.ts` or those candidates will permanently receive a Yellow "County unknown" flag.

**Value parsing:**
Dollar amounts are extracted from `raw_title` via regex. Handles: `$5M`, `$2.5M`, `$2,500,000`, `$150K`, `$1.2B` (suffix case-insensitive). `crawl_data.estimated_value` takes precedence if present.

**License checking — dormant in Phase 1:**
`licenses_held` is stored in the profile but no Red rule fires on license mismatch. There is no license requirement data at the candidate stage — `crawl_data` is not populated until after `crawl-project` runs on a converted opportunity. Ready to activate in Phase 2 when structured crawl data is available earlier in the pipeline.

#### Scanner → Qualifier Wiring

`scan-opportunities` modified to call `qualify-candidates` after each source run, after `finishRun()` writes the agent_run record. The Authorization header from the original scan request is passed through to the qualifier.

Errors from `qualify-candidates` are non-fatal — a failed or timed-out qualifier never fails the scan run.

**⚠️ Known limitation:** If `scan-opportunities` is called without a user JWT (e.g. a future cron job), `authHeader` will be empty and the qualify call is silently skipped. Needs redesign when automated scheduled scanning is added.

**Note on logging:** Qualification result counts appear in Supabase Functions console logs but are not written to `agent_runs.raw_log` — `finishRun()` writes that field before the qualify call is made.

#### Profile Settings Page (`/settings/profile`)

Form sections: Geography (county multi-select), Licensing (license class multi-select), Project Size (min/max currency inputs), Bond Capacity, Agency Exclusions (multi-select from live `opportunity_sources`), Trade Categories. On save: UPSERTs to `gc_qualification_profiles`, then calls `qualify-candidates` for all pending candidates and shows a toast with re-evaluated count. "Bid Profile" link added to sidebar nav.

#### Opportunities Dashboard Updates

- Auto-status badge on each card (outlined/ghost style, distinct from manual status buttons). Hidden if `auto_status` is null.
- Tooltip on badge shows `auto_status_reason` and `qualification_score`
- Sort order on All view: green → yellow → null → red
- Collapsible "Filtered Out" section — auto-Red candidates hidden by default

---

### Architecture Decisions

**Single-user profile model**
`gc_qualification_profiles` ties to `profiles.id`, not a company table. A `gc_companies`/`gc_company_members` multi-tenant layer was designed in full during this session and explicitly deferred — there is one GC using the system and the added complexity had no immediate benefit. When a company layer is added later, only the FK on `gc_qualification_profiles` changes; the qualification logic and edge function do not need to change.

**Candidates are upstream of tenancy**
`opportunity_candidates` has no `gc_id` or `gc_company_id`. Candidates are globally visible to all authenticated users. This is intentional for Phase 1 — a shared candidate pool is the correct mental model when there is one GC. Per-company candidate scoping is a Phase 2 concern.

**ON CONFLICT DO NOTHING preserves reviewed candidates**
Re-running the scanner never overwrites a candidate that has been manually reviewed. A coordinator's decision is durable across re-scans.

**`auto_status` and `status` are always separate**
The auto-qualifier writes only `auto_status`, `auto_status_reason`, `qualification_score`, and `qualified_at`. It never reads or writes `status`. This separation is enforced by convention in the edge function, not by a DB constraint.

---

### Known Limitations and Open Items

| Item | Notes |
|---|---|
| PlanetBids detail URLs may be incorrect | Ember.js click-rendered links; `bid_id` extraction unreliable. Future: VendorLine API or OpenClaw browser agent. |
| Convert to Project bypasses free tier limit | 3-project enforcement missing on opportunity conversion path. Not yet fixed. |
| License checking dormant | `licenses_held` stored but no Red rule fires. Activate in Phase 2 when `crawl_data` carries detail-page fields. |
| `AGENCY_COUNTY` lookup is static | New `opportunity_sources` rows need a matching entry in `qualify-candidates/index.ts` manually. |
| Cron scans skip qualification | Auth header passthrough requires a user JWT; automated scans without a session silently skip qualify-candidates. |
| CaleProcure not integrated | `caleprocure.ca.gov` uses PeopleSoft AJAX; scraping deferred. |
| Qualify results not in `agent_runs.raw_log` | Counts in Supabase Functions console logs only. |
| `types.ts` not regenerated | Must be regenerated from live schema after migration is applied. Lovable used `as any` casts as a workaround. |
| Branch not merged to main | All Phase 1 work is on `phase1-opportunity-intelligence`. |
