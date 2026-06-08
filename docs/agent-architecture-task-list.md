# BidBox Agent Architecture — Task List
**Version 3.1 — June 8, 2026**  
**Updated:** Scraping polish fixes live, qualify-candidates redeployed, SoCal PlanetBids expansion started

---

## Task 1 - PHASE A: DRIVER ARCHITECTURE FOUNDATION ✅ COMPLETE
Commits: `b291a21`

### 1.1. Define Driver Interface ✅
### 1.2. Build Driver Registry ✅
### 1.3. Refactor scan-opportunities ✅
### 1.4. Success Criteria ✅

---

## Task 2 - PHASE B: AGENT INFRASTRUCTURE FOUNDATION ✅ COMPLETE
Commits: `07a47bd`, `ac30963`, `ccb65f4`

### 2.1. Create `agent_tasks` Table ✅
### 2.2. Create `portal_drivers` Table ✅
### 2.3. Create `agent_run_logs` Table ✅
### 2.4. Success Criteria ✅

---

## Task 3 - PHASE C1: BROWSER DRIVER TECHNICAL VALIDATION ✅ COMPLETE
Research spike in `workstream-c/`. No production code.

### 3.1. Findings ✅
- headless: true blocked by PlanetBids bot detection
- headless: false renders fully — rows clickable, bo-detail URLs captured
- Bearer token interceptable from outgoing API requests
- Plans.pdf (20.8MB) downloaded via https.get with Bearer token
- File manifest available via papi/bid-downloadable-files API

### 3.2. Feasibility Verdict ✅
- PlanetBids Driver Feasible: YES
- Winning Technology: Playwright + Browserbase
- Confidence: High

---

## Task 4 - PHASE C2: PLANETBIDS DRIVER PRODUCTION DESIGN ✅ COMPLETE

### 4.0. Architectural Pivot ✅
- Original plan (driver inside Supabase Edge Function) hit WORKER_RESOURCE_LIMIT
- Revised: Railway worker polls agent_tasks, runs Playwright + Browserbase externally
- This is the correct architecture — exactly what agent_tasks was built for

### 4.1. Railway Worker Built and Deployed ✅
- `bidbox-worker/` Node.js service created
- Polls `agent_tasks` every 30 seconds
- Atomic task claiming (prevents double-processing)
- Runs PlanetBids Playwright driver via Browserbase
- Writes candidates to `opportunity_candidates` with `crawl_data`
- Calls `qualify-candidates` after each task
- Deployed to Railway, online and running
- Commits: `36e1a2c`, `f91bf62`, `6183188`, `15a3c76`, `b174615`

### 4.2. scan-opportunities Modified ✅
- PlanetBids sources now create `agent_tasks` rows and return immediately
- Non-PlanetBids sources continue using Firecrawl inline as before
- Response includes `total_queued` count

### 4.3. qualify-candidates Fixed for Service-to-Service ✅
- `verify_jwt = false` set in config.toml
- profile_id accepted directly in request body
- Worker passes hardcoded admin profile_id: `324e7848-6c4d-4fe5-a826-91427265a76e`
- qualify-candidates runs after scans
- Redeployed live to Supabase project `ztuyjlyuzasbceepezua` on 2026-06-08

### 4.4. Production Results ✅
- 63 candidates evaluated across first 8 agencies
- City of Riverside: 4 new (first run)
- City of Carlsbad: 5 new
- City of Huntington Beach: 5 new
- Port of Los Angeles: 2 new
- City of San Diego: 15 new (first successful crawl)
- Total DB at prior checkpoint: 56 candidates

### 4.5. Scraping Polish Fixes ✅ COMPLETE
Commit: `6b9e433`

- [x] Fix title extraction noise
  - Strips `Add to My Bids`, `REMAINING`, and trailing invitation/bid numbers from extracted titles

- [x] Add construction relevance filtering
  - Skips PlanetBids rows with populated commodity codes when none are in the `91xxx` construction range
  - Includes rows with empty commodity codes to avoid false negatives

- [x] Update qualify-candidates value logic
  - Uses `crawl_data.estimated_value` only when it is a positive number
  - Falls back to `parseValueFromTitle(raw_title)` when value is null, 0, or unavailable
  - Production Edge Function redeployed on 2026-06-08

- [x] Improve PlanetBids estimated value extraction
  - Worker now searches labeled estimate text on detail pages instead of relying on the brittle field helper only
  - Supports labels like Engineer's Estimate, Estimated Value, Project Estimate, Construction Estimate, Budget, and Estimate Range
  - Supports `$1,250,000`, `1,250,000`, `$1.2M`, `$850K`, and ranges such as `$1M - $2M`
  - Stores `estimated_value_raw`, `estimated_value_low`, and `estimated_value_high` in `crawl_data`
  - Uses range midpoint as `crawl_data.estimated_value` for display and qualification

- [x] Add scrape timeout guard and jitter
  - 10-minute outer timeout returns partial candidates
  - Browser closes in final cleanup
  - Adds small randomized waits between row/detail actions

### 4.6. Remaining UI Polish
- ⚠️ **Scan Now UI is misleading** — button shows completion when tasks are only queued. Actual scanning happens asynchronously in Railway worker. UI should show queued/running agent status.
- ⚠️ **Agent activity panel needed** — Opportunities page should show active scan tasks, agency names, status, elapsed time, and progress-like state from `agent_tasks`.

---

## Task 5 - PHASE D: QUALIFICATION ENGINE ✅ COMPLETE FOR CURRENT RULE SET

### 5.1. Profile + Engine Built ✅
- gc_qualification_profiles table with all parameters
- qualify-candidates edge function with Red/Yellow/Green rules
- Running after scans

### 5.2. crawl_data Value Matching ✅
- `crawl_data.estimated_value` is now checked first when it is a positive number
- raw_title parsing remains a fallback
- This unlocks Green status for bids with confirmed values in the configured profile range
- Existing candidates need a re-scan or backfill before old `estimated_value: null` rows change

### 5.3. Construction Relevance Filtering ✅
- Decision: filter at scrape time for PlanetBids when commodity codes are available
- Rule: 91xxx commodity codes are construction-related
- Unknown/empty commodity codes remain included

### 5.4. Remaining Qualification Enhancements
- [ ] Add non-PlanetBids construction relevance rules after E2/E3 drivers exist
- [ ] Revisit scoring after expanded source scan produces a larger candidate set
- [ ] Replace hardcoded worker profile_id with config or task payload

---

## Task 6 - PHASE E: AGENCY EXPANSION 🔄 IN PROGRESS

### 6.1. Original Agencies (8) ✅
- City of Irvine, City of Riverside, City of San Diego, Port of Long Beach
- City of Long Beach, City of Carlsbad, Port of Los Angeles, City of Huntington Beach

### 6.2. E1 — Southern California PlanetBids Expansion 🔄 STARTED
- Goal: every verified SoCal public agency using PlanetBids
- Process: find portal ID, add row to `opportunity_sources` with `portal_type = 'planetbids'`
- Pure configuration once the portal is verified
- Priority: HIGH
- Coverage ledger: `docs/opportunity-source-ledger.md`

**Completed:**
- [x] First verified SoCal PlanetBids migration created
  - Migration: `supabase/migrations/20260608000001_seed_socal_planetbids_sources.sql`
  - Adds 54 unique PlanetBids portal URLs as the first verified batch
  - This is not the final SoCal PlanetBids universe
  - Uses `ON CONFLICT (listing_url) DO UPDATE`
  - Does not delete existing sources or cascade existing candidates

- [x] Create opportunity source ledger
  - File: `docs/opportunity-source-ledger.md`
  - Tracks configured, production-enabled, and scan-verified states
  - Only mark a source as scan verified after worker logs prove success

**Next:**
- [ ] Apply migration in Supabase production
- [ ] Verify enabled `planetbids` source count after migration
- [ ] Run one scan cycle against expanded sources
- [ ] Monitor worker duration, Browserbase usage, per-source failures, and duplicate candidates
- [ ] Update `docs/opportunity-source-ledger.md` from production scan results
- [ ] Add follow-up migrations for missing verified PlanetBids agencies discovered during review
- [ ] Tune scan intervals if 24-hour cadence is too aggressive for low-volume sources

### 6.3. E2 — Master SoCal Agency Portal Inventory 📋 PLANNED
- Inventory cities, counties, school districts, ports, airports, transit agencies, water districts, sanitation districts, fire authorities, Caltrans, and state agencies
- Track agency name, agency type, county, portal platform, portal URL, priority, status, and notes
- Known non-PlanetBids platforms: Cal eProcure, Bonfire, OpenGov, Periscope/BidSync, DemandStar, agency-direct/custom portals

### 6.4. E3 — New Driver Per Portal Type 📋 PLANNED
Priority order:
- Cal eProcure driver for Caltrans/state opportunities
- Bonfire driver
- OpenGov driver
- Periscope/BidSync or DemandStar driver, depending on E2 count
- Agency-direct drivers for high-value custom portals such as LA County, LACMTA, LADWP

### 6.5. How to Add a New PlanetBids Agency
- Find PlanetBids portal ID from URL: `vendors.planetbids.com/portal/{ID}/`
- Insert into `opportunity_sources`: name, `portal_type = 'planetbids'`, listing_url, `scan_enabled = true`
- Worker picks it up on the next scan/task queue cycle

---

## Task 7 - PHASE F: DOCUMENT COLLECTION ❌ NOT STARTED

### 7.1. Prerequisites
- Login credentials needed for authenticated PlanetBids session
- Bearer token proven to work in C1 (Plans.pdf downloaded)
- Worker infrastructure ready

### 7.2. What's Needed
- Add PlanetBids login to worker (email/password stored as Railway env vars)
- Login once per session, capture bearer token
- After detail page extraction, call file manifest API
- Download files via https.get with bearer token
- Upload to Supabase Storage
- Write to opportunity_documents table (needs migration)

---

## Task 8 - PHASE G: ESTIMATING INTELLIGENCE ❌ NOT STARTED
Blocked on Task 7

---

## Task 9 - PHASE H: OUTREACH INTELLIGENCE ❌ NOT STARTED
Blocked on all previous phases

---

## Task 10 - OPEN ITEMS / NEXT PRIORITIES

### 10.1. Immediate Next
- Apply E1 SoCal PlanetBids migration in Supabase
- Run expanded source scan
- Monitor task/worker behavior with 54 enabled PlanetBids portals
- Update `docs/opportunity-source-ledger.md` with scan-verified statuses
- Build Opportunities-page agent activity panel
- Fix Scan Now UX to reflect async queueing vs completed scraping

### 10.2. Later
- Begin E2 master agency portal inventory
- Decide first non-PlanetBids driver after E2 shows source counts
- Start Phase F document collection once PlanetBids account credentials are ready

### 10.3. Architecture Decisions Locked
- ✅ Railway worker + agent_tasks polling (not webhooks)
- ✅ Browserbase for headless browser (not self-hosted)
- ✅ Playwright for portal automation (not Stagehand)
- ✅ Bearer token for document download (not browser download)
- ✅ Single worker, LIMIT 1 per poll cycle initially (can scale horizontally later)
