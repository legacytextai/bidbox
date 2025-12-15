# BidBox GC Control Center PRD

**Strategic Product Requirements Document**  
Last Updated: 2025-12-07

---

## Executive Summary

BidBox is evolving from a "simple bid room" into the **GC Control Center** — a single, frictionless operating system for preconstruction that makes General Contractors more informed, organized, effective, and confident on bid day.

---

## 1. Updated Understanding of GC Workflows

Based on real Reddit conversations, estimator interviews, and field experience, we now have clarity on the *true* problems small-to-mid GCs face:

- Bidding workflows are scattered across email, spreadsheets, Drive links, text messages, and whiteboards.
- Chasing subcontractors is **not** a problem to eliminate — it is a required and valuable part of the job.
- The REAL pain is **lack of visibility**, **lack of organization**, and **lack of a unified place to manage trades, compliance, and bid coverage**.
- Subcontractors will *ignore login systems* and *avoid portals*. No GC software wins by forcing subs to adopt a system.
- GCs want a **simple hub** that gives them clarity, organization, and control — not automation gimmicks.

---

## 2. The GC Control Center Vision

A single, frictionless operating system for preconstruction — one that makes GCs:

- **More informed** — Know which trades are covered and where gaps exist
- **More organized** — All subs, files, and quotes in one place
- **More effective** — Action-ready call lists ranked by priority
- **More confident on bid day** — Clear visibility into bid coverage

---

## 3. Guiding Principles

### Principle 1: Do Not Replace Phone Calls — Empower Them
GCs close gaps by calling subs. BidBox must surface insights that make these calls more efficient and targeted.

### Principle 2: Subs Must Experience Zero Friction
No logins. No portals. No data entry. Just simple:  
**Click link → View plans → Upload quote.**

### Principle 3: Clarity Beats Features
Our UI should provide the GC with immediate clarity into:
- Which trades are needed
- Which subs fit those trades
- Who has viewed the plans
- Who has downloaded the plans
- Who has not engaged
- Where bid coverage is thin

### Principle 4: Local Specialization Is the Wedge
We specialize in **California public works**, **license-type filtering**, and **curated SoCal subcontractor directories**.  
This is something PlanHub and Dodge *cannot do*.

---

## 4. Why "Select Trades for Your Job" Is Foundational

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

## 5. Four Pillars of the Control Center

### Pillar 1 — Trade Intelligence
- Select required trades (license-type dropdown + multi-select)
- View trade coverage heatmap
- Know instantly where your risks are

### Pillar 2 — Subcontractor Organization
- For each trade, BidBox recommends vetted subs
- GC can add custom subs to their private pool
- Directory grows into a local advantage

### Pillar 3 — Engagement Visibility
- See who viewed the plans
- See who downloaded documents
- See who submitted quotes
- See who requires follow-up

### Pillar 4 — Bid-Day Command Center
- Auto-generated call list by trade
- Coverage meter per trade
- Compliance reminders (COIs, license expirations)
- Live quote intake

---

## 6. Two-Pool Subcontractor Architecture

### Overview
The Call List Generator pulls from **two distinct pools**:

1. **GC's Private Pool** — Subcontractors the GC has personally added and worked with
2. **BidBox Network Pool** — Curated, verified subcontractors maintained by BidBox

### Benefits
- GCs get instant coverage even with an empty private pool
- Network pool provides California public works specialists
- GCs build their own trusted sub relationships over time
- Combined pools maximize bid coverage

### Target User Flow
1. GC creates project → uploads plans
2. GC selects required trades (license types)
3. BidBox maps subs from **both pools** to selected trades
4. GC clicks **"Generate Call List (Excel)"**
5. BidBox outputs `.xlsx` with:
   - Grouped by trade
   - Sorted by engagement priority
   - Contains: Name, Company, Phone, Email, Engagement Status

**Result:** GC has an actionable call sheet ready immediately.

### Security Model (Audit Reference)

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
- Powers Call List Generator without requiring GC to build directory first
- Creates network effects (more subs → more value → more GCs)

**This is NOT a vulnerability**:
- Unauthenticated access is blocked (RLS requires `auth.uid() IS NOT NULL`)
- Competitor browsing is a business concern, not a security flaw
- If business decides to restrict visibility, use security definer functions scoped to project trades

**Do NOT flag as security issue**: Cross-GC visibility in `subcontractors` table.

**References**: `docs/masterplan.md` Security Decisions, `docs/tasks.md` Security Decisions

---

## 7. Queen Bee Features

### Primary: Trade Selection + Curated Sub Mapping
This backbone feature unlocks:
- Coverage intelligence
- Directory-driven subcontractor matching
- Engagement analytics
- Bid-day call prioritization
- Compliance tracking
- Future AI workflows

### Secondary: Call List Generator
The GC's primary "action layer" during bid-day operations.

**Purpose:** Give GCs a real-time, ranked call sheet that tells them: **Who to call next, and why.**

**Output Format:** Downloadable Excel (.xlsx) file
- Sorted by trade
- Sorted by engagement priority
- Contains: Name, Phone, Email, Engagement Status

**Ranking Logic:**
1. Not opened → highest priority (needs outreach)
2. Viewed but not downloaded (interested but stalled)
3. Downloaded but no quote (engaged, needs follow-up)
4. Submitted a quote → lowest priority (complete)

---

## 8. Database Schema (New Tables)

### project_trades
Links projects to required trades/license types.

```sql
id (uuid, PK)
project_id (uuid, FK → projects.id)
trade_code (text)        -- e.g., "C-10"
trade_name (text)        -- e.g., "Electrical"
created_at (timestamptz)
```

### subcontractors (BidBox Network Pool)
Curated, shared subcontractor directory.

```sql
id (uuid, PK)
company_name (text)
license_type (text)      -- e.g., "C-10"
license_number (text)
email (text)
phone (text)
city (text)
service_area (text)
is_verified (boolean)
created_at (timestamptz)
```

### gc_subcontractors (GC's Private Pool)
Each GC's private subcontractor list.

```sql
id (uuid, PK)
gc_id (uuid, FK → profiles.id)
company_name (text)
license_type (text)
contact_name (text)
email (text)
phone (text)
notes (text)
created_at (timestamptz)
```

---

## 9. Strategic Outcome

This evolution reinforces the BidBox vision:  
**Not replacing the GC's process, but supercharging it.**

We're not trying to automate away phone calls — we're making those calls smarter, faster, and more targeted. The GC stays in control, but now they have a command center that shows them exactly where to focus their energy.

---

## 10. Network Pool Moat Strategy

The BidBox Network Pool is a strategic competitive moat built through the **CSLB Network Directory Seeding Initiative** (Phase 7).

### How the Network Pool Gets Populated

1. **Admin Manual Seeding** — Via `/admin/network-subs` UI (current)
2. **CSLB Batch Harvesting** — Automated scraping of 290,000+ licenses (planned)
3. **GC Excel Imports** — Bulk upload enriches both private and network pools (planned)

### Tiered Seeding Strategy

| Tier | Focus | Target Count |
|------|-------|--------------|
| Tier 1 | Hot Trades (C-10, C-20, C-36, etc.) | ~50,000 |
| Tier 2 | Full CSLB Harvest | 290,000+ |
| Tier 3 | Enrichment (emails, websites) | Ongoing |

### Why This Is Defensible

- Competitors cannot easily replicate without massive scraping infrastructure
- Classification-to-trade mapping is valuable intellectual property
- Local California focus creates expertise that national tools can't match
- GC trust compounds over time as they build private pools

See `docs/tasks.md` Phase 7 and `docs/masterplan.md` "Network Pool Moat Strategy" for details.

---

## 11. Document References

- `docs/masterplan.md` — Product vision (includes Network Pool Moat Strategy)
- `docs/tasks.md` — Implementation tasks (Phases 3.5-7)
- `docs/implementation-plan.md` — Build sequence with CSLB Pipeline Architecture
- `docs/cslb-license-types.md` — California license type reference

---

**End of GC Control Center PRD**
