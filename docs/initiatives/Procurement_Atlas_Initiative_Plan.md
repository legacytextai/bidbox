# Initiative: Procurement Atlas

## Autonomous Agency Intelligence & Reconnaissance Platform

## Executive Summary

Procurement Atlas is an internal engineering product, separate from
BidBox, whose mission is to autonomously discover, verify, classify,
investigate, and plan integrations for every official California public
works procurement agency and portal.

It is **not** a customer-facing application and **does not** ingest
opportunities directly into production. Instead, it becomes the
engineering system of record that tells BidBox which agencies exist,
which are already supported, which require new drivers, and exactly how
to implement them.

Current implementation priority remains manually adding 1--3 new agency
drivers (starting with LA County DPW). Procurement Atlas is a parallel
strategic initiative for later implementation.

------------------------------------------------------------------------

# Goals

## Primary

-   Build a verified registry of every official California public works
    procurement agency.
-   Distinguish official procurement systems from third-party
    aggregators.
-   Produce engineering-quality reconnaissance reports.
-   Recommend driver reuse vs. new driver development.
-   Become the planning layer for BidBox expansion.

## Non-Goals

-   Not a replacement for BidBox.
-   Not a production opportunity ingestion pipeline.
-   Not a bid aggregation service.
-   Not a customer product.

------------------------------------------------------------------------

# Core Principles

1.  Official government sources only.
2.  Every conclusion must be evidence-backed.
3.  Reconnaissance before implementation.
4.  Existing BidBox agencies must be imported first.
5.  Atlas becomes the single engineering source of truth.

------------------------------------------------------------------------

# High-Level Architecture

Agency Queue → Discovery → Official Website Verification → Procurement
Portal Discovery → Authority Verification → Portal Classification →
Browser Reconnaissance → Engineering Planning → Agency Registry → Human
Approval → BidBox Implementation

------------------------------------------------------------------------

# Technology Stack

## Frontend

-   Lovable
-   Internal dashboard only

## Database

-   Dedicated Supabase project
-   Separate from BidBox

## Workers

-   Railway

## Browser Automation

-   Browserbase
-   Playwright

## AI

-   GPT / Claude for reasoning, report generation, planning

## Source Control

-   GitHub
-   Recon reports versioned alongside code if desired

------------------------------------------------------------------------

# Major Components

## Agency Registry

Tracks: - agency - jurisdiction - official website - procurement page -
portal URL - portal type - driver status - confidence - verification
date

## Portal Registry

Tracks: - portal vendor - authentication - document handling -
pagination - APIs - anti-bot - addenda - notes

## Recon Reports

Stores: - screenshots - findings - implementation notes - unknowns -
recommendations

## Driver Catalog

Tracks: - implemented drivers - reusable drivers - planned drivers -
engineering effort - coverage

------------------------------------------------------------------------

# Suggested Database

## agencies

-   id
-   name
-   type
-   county
-   state
-   official_website
-   status

## procurement_portals

-   agency_id
-   portal_url
-   procurement_page
-   portal_type
-   official
-   confidence
-   last_verified

## recon_runs

-   agency_id
-   status
-   started_at
-   completed_at
-   markdown_report

## recon_findings

-   run_id
-   finding_type
-   title
-   content
-   confidence
-   verified

## implementation_plans

-   agency_id
-   driver_type
-   estimated_effort
-   status
-   notes

------------------------------------------------------------------------

# Autonomous Agents

## 1. Agency Discovery Agent

Find agencies by county, city, district, utility, transportation
authority.

## 2. Official Portal Finder

Locate the official procurement page.

## 3. Authority Verification Agent

Prove: Agency Website → Procurement Page → Procurement Portal

Reject aggregators lacking an official backlink.

## 4. Portal Classification Agent

Classify: - PlanetBids - OpenGov - Bonfire - Cal eProcure - Agency
Direct - DemandStar - BidNet - Unknown

## 5. Browser Recon Agent

Inspect: - listings - detail pages - metadata - downloads - login -
APIs - pagination - anti-bot

## 6. Engineering Planner

Generate: - implementation report - unknowns - driver recommendation -
effort estimate

## 7. Health Check Agent

Periodically revisit existing agencies to detect portal changes.

------------------------------------------------------------------------

# Integration with Existing BidBox

Import current: - opportunity_sources - portal drivers - implemented
agencies - existing reconnaissance - architecture documents

Atlas must understand: - PlanetBids coverage - Caltrans - future LA
County DPW - OpenGov research - all future agencies

------------------------------------------------------------------------

# Dashboard

Pages: - Overview - Agencies - Recon Queue - Reports - Driver Catalog -
Coverage Map - Portal Types

Metrics: - verified agencies - pending recon - portal distribution -
supported agencies - implementation-ready agencies

------------------------------------------------------------------------

# Milestones

## M1

Foundation - Supabase - Lovable - Railway - Seed existing BidBox
agencies

## M2

Discovery - Agency discovery - Official verification - Portal
classification

## M3

Recon - Browserbase automation - Engineering reports - Driver
recommendations

## M4

Atlas Complete - Statewide coverage - Continuous monitoring - BidBox
implementation queue

------------------------------------------------------------------------

# Success Criteria

-   Every supported agency represented.
-   Every unsupported agency classified.
-   Every portal has a recon report.
-   Every future driver begins from an Atlas report instead of manual
    research.

------------------------------------------------------------------------

# Immediate Priority

Do NOT begin this initiative yet.

Current engineering priority: 1. Continue manually adding 1--3 new
agency drivers. 2. Complete LA County DPW reconnaissance. 3. Implement
and validate new drivers. 4. Return to Procurement Atlas after agency
expansion momentum is established.
