# BidBox Opportunity Source Ledger

**Purpose:** This is the operational proof sheet for agencies BidBox crawls for opportunity intelligence.

**Last updated:** 2026-06-08

---

## Status Definitions

- **Configured in migration:** The agency is present in a repo migration and will be added to `opportunity_sources` when applied.
- **Production enabled:** The agency exists in production `opportunity_sources` with `scan_enabled = true`.
- **Scan verified:** A worker scan has completed for the agency and either found candidates or cleanly reported zero active bidding rows.
- **Needs review:** The source needs investigation because scans fail, portal behavior changed, or the portal URL may be stale.

Do not treat a source as “BidBox is successfully grabbing projects from this agency” until it is marked **Scan verified**.

---

## Current Coverage Summary

| Metric | Count | Notes |
| --- | ---: | --- |
| Configured PlanetBids sources in E1 migration | 54 | First verified batch, not exhaustive |
| Production enabled | Pending | Update after migration is applied |
| Scan verified | Pending | Update after expanded scan cycle completes |
| Needs review | Pending | Update from worker logs |

---

## E1 PlanetBids Sources

Migration: `supabase/migrations/20260608000001_seed_socal_planetbids_sources.sql`

| # | Agency | Portal ID | Listing URL | Config Status | Scan Status |
| ---: | --- | ---: | --- | --- | --- |
| 1 | City of Beverly Hills | 39493 | https://vendors.planetbids.com/portal/39493/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 2 | City of Burbank | 14210 | https://vendors.planetbids.com/portal/14210/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 3 | Burbank-Glendale-Pasadena Airport Authority | 21910 | https://vendors.planetbids.com/portal/21910/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 4 | City of Carlsbad | 27970 | https://vendors.planetbids.com/portal/27970/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 5 | City of Chula Vista | 15381 | https://vendors.planetbids.com/portal/15381/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 6 | City of Corona | 39497 | https://vendors.planetbids.com/portal/39497/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 7 | City of Costa Mesa | 45476 | https://vendors.planetbids.com/portal/45476/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 8 | City of Culver City | 39483 | https://vendors.planetbids.com/portal/39483/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 9 | City of Diamond Bar | 39500 | https://vendors.planetbids.com/portal/39500/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 10 | City of Duarte | 42035 | https://vendors.planetbids.com/portal/42035/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 11 | City of Glendale | 39503 | https://vendors.planetbids.com/portal/39503/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 12 | City of Huntington Beach | 15340 | https://vendors.planetbids.com/portal/15340/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 13 | City of Inglewood | 45619 | https://vendors.planetbids.com/portal/45619/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 14 | City of Irvine | 15927 | https://vendors.planetbids.com/portal/15927/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 15 | City of Jurupa Valley | 26879 | https://vendors.planetbids.com/portal/26879/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 16 | City of La Canada Flintridge | 62508 | https://vendors.planetbids.com/portal/62508/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 17 | City of Long Beach | 15810 | https://vendors.planetbids.com/portal/15810/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 18 | Long Beach Unified School District | 23758 | https://vendors.planetbids.com/portal/23758/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 19 | City of Los Angeles | 23749 | https://vendors.planetbids.com/portal/23749/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 20 | Los Angeles Community College District | 21372 | https://vendors.planetbids.com/portal/21372/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 21 | Los Angeles County Office of Education | 61954 | https://vendors.planetbids.com/portal/61954/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 22 | Los Angeles World Airports | 48397 | https://vendors.planetbids.com/portal/48397/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 23 | Metropolitan Water District of Southern California | 16151 | https://vendors.planetbids.com/portal/16151/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 24 | Moreno Valley Unified School District | 59999 | https://vendors.planetbids.com/portal/59999/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 25 | City of Murrieta | 17992 | https://vendors.planetbids.com/portal/17992/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 26 | City of National City | 24103 | https://vendors.planetbids.com/portal/24103/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 27 | City of Newport Beach | 22078 | https://vendors.planetbids.com/portal/22078/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 28 | Newport-Mesa Unified School District | 46422 | https://vendors.planetbids.com/portal/46422/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 29 | City of Norwalk | 54783 | https://vendors.planetbids.com/portal/54783/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 30 | Omnitrans | 18046 | https://vendors.planetbids.com/portal/18046/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 31 | City of Ontario | 11434 | https://vendors.planetbids.com/portal/11434/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 32 | Orange County Fire Authority | 14773 | https://vendors.planetbids.com/portal/14773/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 33 | Orange County Sanitation District | 14058 | https://vendors.planetbids.com/portal/14058/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 34 | Orange Unified School District | 15578 | https://vendors.planetbids.com/portal/15578/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 35 | City of Palm Springs | 47688 | https://vendors.planetbids.com/portal/47688/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 36 | City of Pomona | 24662 | https://vendors.planetbids.com/portal/24662/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 37 | Port of Long Beach | 19236 | https://vendors.planetbids.com/portal/19236/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 38 | Port of Los Angeles | 42217 | https://vendors.planetbids.com/portal/42217/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 39 | City of Redlands | 24639 | https://vendors.planetbids.com/portal/24639/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 40 | City of Riverside | 39475 | https://vendors.planetbids.com/portal/39475/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 41 | San Diego County Regional Airport Authority | 16725 | https://vendors.planetbids.com/portal/16725/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 42 | City of San Diego | 17950 | https://vendors.planetbids.com/portal/17950/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 43 | San Diego Unified School District | 43764 | https://vendors.planetbids.com/portal/43764/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 44 | City of Santa Ana | 20137 | https://vendors.planetbids.com/portal/20137/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 45 | Santa Clarita Community College District | 53162 | https://vendors.planetbids.com/portal/53162/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 46 | Santa Clarita Valley Water Agency | 27355 | https://vendors.planetbids.com/portal/27355/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 47 | City of Seal Beach | 39491 | https://vendors.planetbids.com/portal/39491/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 48 | City of Temecula | 14837 | https://vendors.planetbids.com/portal/14837/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 49 | City of Torrance | 47426 | https://vendors.planetbids.com/portal/47426/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 50 | Transportation Corridor Agencies | 24054 | https://vendors.planetbids.com/portal/24054/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 51 | Val Verde Unified School District | 70300 | https://vendors.planetbids.com/portal/70300/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 52 | City of West Hollywood | 22761 | https://vendors.planetbids.com/portal/22761/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 53 | City of Westlake Village | 59523 | https://vendors.planetbids.com/portal/59523/bo/bo-search | Configured in migration | Pending production apply + scan verification |
| 54 | City of Wildomar | 66534 | https://vendors.planetbids.com/portal/66534/bo/bo-search | Configured in migration | Pending production apply + scan verification |

---

## How To Update This Ledger After A Scan

For each source:

1. Confirm the row exists in production `opportunity_sources`.
2. Confirm an `agent_tasks` row was queued and completed for the source.
3. Confirm one of these outcomes:
   - New or existing `opportunity_candidates` were associated with the source, or
   - Worker log says the source scanned cleanly with zero active `Bidding` rows.
4. Update **Scan Status** to `Scan verified` with the scan date.
5. If the source fails repeatedly, update **Scan Status** to `Needs review` and add a note.

---

## Known Coverage Gap

The E1 migration is a first verified batch, not the final SoCal PlanetBids universe. The next expansion pass should continue finding and verifying additional city, school district, community college, water, sanitation, airport, transit, and special district PlanetBids portals.
