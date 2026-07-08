# OpenGov Category Dictionary — Final Recon (Canonical Source of Truth)

**Date:** 2026-07-07
**Extends:** `docs/handoff/2026-07-07-opengov-category-coverage.md`
**Method:** Live authenticated API enumeration + coverage measurement (same session). 68 seed terms × 3 taxonomies; category → CA-project coverage measured directly against `POST /api/v1/project/search`.
**Status:** Definitive category strategy. **No driver code written** — this is the permanent dictionary the OpenGov driver is built against, once.

---

## 0. TL;DR — the decision

**Define the OpenGov construction dictionary by structural rule (taxonomy branch), not by keyword-matched category titles.** Keyword matching on 68 seed terms enumerated 3,106 categories and pulled ~15–25% noise (software, vehicles, food, audits, shredding). The construction *branches* of each taxonomy give **795 categories at ~2% noise**.

| Layer | Definition | Categories | CA projects (live) | Noise |
|---|---|---:|---:|---:|
| **Tier 1 (core)** | NAICS sector 23 · NIGP classes 906/909/910/911/912/913/918/925/926/988 · UNSPSC segment 72 | 551 | **128** | ~2% |
| **Tier 2 (adjacent)** | NAICS 5413 (A&E) · NIGP 914/961/968 · UNSPSC segments 30/81/95 | 244 | +21 (**149**) | ~5% |
| ~~Broad keyword net~~ | ~~all 68 seed terms, all sets~~ | ~~3,106~~ | ~~213~~ | **~20% (reject)** |

**Diminishing returns is sharp:** Tier 1 → 128 projects. Tier 2 → +21 (mostly legit A&E/permits). The broad net's extra +64 beyond Tier 1+2 is ~90% noise. **Ship Tier 1 as the dictionary; include Tier 2 with downstream relevance filtering; do not go broader.**

The three taxonomies are **fully disjoint** (0 project overlap pairwise), so the union is additive and dedupe-by-`project.id` is trivial and mandatory.

---

## 1. Category resolution mechanism (verified)

```
POST https://api.procurement.opengov.com/api/v1/categories/search?set=<SET>
Cookie: <session>                      # credentials: 'include'
Content-Type: application/json
{ "query": "<free text>" }
```
- **`set`**: **`200` = NAICS · `100` = NIGP · `300` = UNSPSC**. Omitting it → `400 "Please specify the categorization system"`.
- Returns a bare JSON **array** of `{ id, code, title, setId, isLeaf, group1..group6 }`. `id` is what `project/search.categories` takes; `code` is the taxonomy code.
- **Hard cap: 100 results per query, no pagination** (`page`/`limit` ignored). This is *why* one seed term under-enumerates and multiple terms (or structural class enumeration) are required.

`project/search` accepts a large `categories[]` array (tested to ~250 ids/call; chunk at ~150 for safety) and returns `{ projects, count }` (see the protocol recon for the full contract; pagination is `?page=&limit=` on the query string).

---

## 2. The Canonical Dictionary — by structural rule

The dictionary is **generated**, not frozen. Each entry is `{ id, taxonomy, code, title, tier }`. The rule below deterministically defines all 795 entries; the driver resolves the live `id` set from it (see §6 resolution algorithm).

### 2.1 NAICS (set 200)
- **Tier 1 — `code` starts with `23`** (the Construction sector). **69 categories.** Parent `23 Construction` = **id `20000205`**, which on OpenGov **already rolls up every child `23xxxx`** (verified: parent alone and the full 69-category family both return the identical 27 CA projects). → For NAICS, the driver may use just `[20000205]`; the full family is listed for completeness.
- **Tier 2 — `code` starts with `5413`** (Architectural, Engineering & Related Services). **9 categories** (e.g. "Building Inspection Services"). A&E / design-build relevance for public works.

### 2.2 NIGP (set 100) — construction service classes (3-digit class prefix)
Tier 1 classes (259 categories), with live CA-project yield:

| Class | Title (example) | Cats | CA proj |
|---|---|---:|---:|
| 925 | General Construction: Management (CM/PM/Engineering) | 69 | high |
| 913 | Construction: Airport/Roadway/Runway (heavy civil) | 35 | 35 |
| 910 | Construction/Maintenance & Repair (roads, septic, etc.) | 33 | 33 |
| 909 | Facility Construction (buildings) | 28 | 28 |
| 911 | C.I.P. / Construction Contingency | 25 | — |
| 912 | Construction, Fire Protection & trades | 22 | 22 |
| 906 | General Construction — Architectural (A&E) | 16 | 8 |
| 918 | Construction Consulting | 14 | 17 |
| 988 | Grading / site work | 9 | 20 |
| 926 | Abatement (lead/asbestos) design | 8 | 1 |

Tier 2 NIGP classes (53 categories) — construction-adjacent, some noise: **914** (Cleaning, interior/exterior — facility maintenance vs janitorial; 30 proj), **961** (Building Permit Services; 4 proj), **968** (Sandblasting & misc services; 32 proj — broad).

### 2.3 UNSPSC (set 300) — construction segments (2-digit segment prefix)
- **Tier 1 — segment `72`** = Building and Facility Construction and Maintenance Services. **223 categories → 14 CA proj (core, clean).**
- **Tier 2 — segments `30`** (Structures/Building/Construction Components; 2 proj), **`81`** (Engineering/Research/Technology-Based Services — civil eng/A&E; 10 proj), **`95`** (Land and Buildings; 3 proj). 182 categories.

### 2.4 Excluded as noise (do NOT include)
Categories that the broad keyword net dragged in but are **not** construction — reject entirely:
- **NIGP:** 205 (Network Components), 203 (Batteries), 285 (Lamps), 306 (Data Books), 570 (Railroad Rails — debatable), 830 (Steel Tanks — include only if water-infrastructure focus).
- **UNSPSC:** 43 (IT/Software), 78 (Transportation/Vehicles), 25 (Vehicles), 22, 53, 76 (Cleaning supplies), 90 (Travel/Food).
- **Any set:** categories surfaced only by ambiguous terms (`security`→guard services, `communications`→telecom, `water`→bottled water, `generator`→portable gensets for rental, `fiber`→optical components) that don't fall in the Tier 1/2 branches.

---

## 3. Coverage statistics (live, CA + open, 2026-07-07)

| Search | CA projects | Notes |
|---|---:|---|
| NAICS 23 parent (`20000205`) only | 27 | prior recon baseline |
| NAICS full 23-family (69 cats) | 27 | children add **0** — parent rolls up |
| NIGP Tier-1 classes | ~71 | 9xx construction services |
| UNSPSC segment 72 | ~14 | |
| **Tier 1 union** | **128** | **the recommended MVP number** |
| Tier 1 + Tier 2 union | 149 | +A&E, permits, land |
| Broad 3,106-category net | 213 | ~20% noise — rejected |

**Diminishing returns:** each structural branch adds real, disjoint construction projects (NAICS 27 → +NIGP → +UNSPSC = 128). Tier 2 adds a modest, still-relevant 21. Beyond Tier 2, marginal projects are overwhelmingly noise. **Stop at Tier 1 (+Tier 2 optional).**

## 4. Overlap analysis

Pairwise **project** overlap across taxonomies = **0** in every measurement (NAICS∩NIGP = 0, NAICS∩UNSPSC = 0, NIGP∩UNSPSC = 0). Agencies classify a given solicitation under **one** taxonomy, essentially never cross-tagging. Consequences:
- Union is (almost exactly) additive — every taxonomy is pure incremental recall.
- **Dedupe by `project.id` is mandatory and trivial** (stable integer). Overlap is ~0 today but a project *can* carry multiple categories, so dedupe protects against future cross-tagging at zero cost.

## 5. False-positive analysis

- **Tier 1: ~2%.** Of 128 projects, the only clear misfires were a "Food and Commissary Services" (agency mis-tagged under UNSPSC 72) and a gas-market RFP. A "Qualified Contractors List" prequalification is arguably in-scope.
- **Tier 2: ~5%.** NIGP 914 (cleaning) and 968 (misc services) and UNSPSC 81 (engineering) introduce janitorial/consulting adjacent items.
- **Broad net: ~15–25%.** Ambiguous seed terms pulled software, vehicle rentals, shredding, medical, audit, marketing, learning-management systems.
- **Recommendation:** filter by the Tier 1/2 **branch rule** (not keywords); accept the ~2–5% residual at scan time and let the **existing downstream relevance layer** (title relevance sweeper + F4 project intelligence) handle final precision. Do **not** tighten categories to chase the last 2% — recall matters more, and dedupe/relevance are cheap downstream.

---

## 6. Recommended Production Architecture

### 6.1 Answers to the specific questions
1. **Query all three taxonomies every scan?** Yes — they are disjoint; skipping any loses ~unique projects (NIGP alone is ~55% of coverage). One `project/search` per taxonomy (or one combined `categories[]` array), CA filter, high `limit`, then merge.
2. **Hardcode or generate categories?** **Hybrid: rule-defined, resolved-and-snapshotted, periodically refreshed.** Store the structural rule (§2) + a checked-in resolved-ID snapshot (fast path, drift-proof scans). Do **not** hand-maintain 795 IDs, and do **not** re-enumerate 200+ `categories/search` calls on every scan.
3. **Remove duplicate projects?** Dedupe by OpenGov **`project.id`** after merging taxonomy result sets. Trivial; keep one canonical candidate.
4. **Qualify before or after ingestion?** **After.** Ingest by category (maximize recall) → dedupe → detail-enrich → then the existing relevance sweeper + F4 qualification apply precision. Category filtering is discovery, not qualification.
5. **Refresh strategy for the dictionary?** Re-resolve the rule (§6.2) on a **monthly** cadence (or on-demand), diff against the snapshot, alert on large deltas (drift signal). Category IDs are stable integers, so the snapshot is safe between refreshes; refresh only guards against OpenGov adding new categories/classes.

### 6.2 Dictionary resolution algorithm (build-time / monthly, not per-scan)
```
for set in [200 NAICS, 100 NIGP, 300 UNSPSC]:
  for term in SEED_TERMS:                       # broad net to defeat the 100-cap
     cats += categories_search(set, term)       # dedupe by id
keep cats where:
  NAICS  : code.startsWith('23')                              (Tier1)  | code.startsWith('5413') (Tier2)
  NIGP   : class3 in {906,909,910,911,912,913,918,925,926,988}(Tier1)  | class3 in {914,961,968} (Tier2)
  UNSPSC : segment2 == '72'                                   (Tier1)  | segment2 in {30,81,95}  (Tier2)
snapshot -> opengov_categories dictionary (id, taxonomy, code, title, tier)
```
`SEED_TERMS` = the 68-term list used in this recon (construction, contractor, building, roadway, bridge, sewer, water, grading, paving, concrete, electrical, plumbing, HVAC, roofing, demolition, excavation, structural, engineering, environmental, abatement, … ) — breadth only matters to surface categories past the 100-cap; the **structural filter** is what guarantees precision.

### 6.3 Scan-time flow (per nightly scan)
```
authenticated session (Browserbase login → cookies; protocol recon §1)
  → load dictionary snapshot (Tier 1 ids; Tier 2 optional/flagged)
  → project/search per taxonomy (CA, limit high, paginate if needed)
  → merge → DEDUPE by project.id
  → persistScannedCandidate (store project id, financialId, government.code,
      taxonomy+category that matched, detail URL, dates, summary)
  → detail-enrich (GET project/:id) + documents (pre-signed S3 URLs)
  → existing relevance sweeper + F4 qualification (precision downstream)
```
Store, per candidate, **which taxonomy/category matched** — this feeds later relevance tuning and lets Tier 2 be filtered more aggressively downstream if needed.

---

## 7. Final Implementation Plan (for approval — driver still NOT built)

1. **Persist the dictionary.** Add an `opengov_categories` snapshot (Tier 1 ids required; Tier 2 flagged) generated by §6.2. Store as a checked-in JSON/seed the driver loads — plus the structural rule in code so it can be regenerated.
2. **Register `portal_type = 'opengov'`** at the four seams (refresh-opportunities, scan-opportunities, worker claim/dispatch, platformDetection) — same checklist as `lacmta`/`lacounty_dpw`.
3. **One global source** (`OpenGov — California Construction`), not per-agency; agencies captured as candidate metadata (`government.code`/name).
4. **Scan driver** (`bidbox-worker/drivers/opengov.js`): Browserbase login → cookie session → three-taxonomy `project/search` (Tier 1 dictionary, CA) → merge/dedupe by project id → `persistScannedCandidate`. Canonical key = OpenGov `project.id`.
5. **Detail + documents** (Phase 2/3): `GET project/:id`; download `attachments[].url` (pre-signed S3, fetch same-run) into `opportunity-documents`; feed F3/F4 unchanged.
6. **Dictionary refresh job:** monthly re-resolution + drift alert.
7. **Validate** against the live number: **~128 CA construction opportunities (Tier 1)** at ingest; confirm ~2% noise is absorbed by the relevance layer; confirm zero duplicate candidates on re-scan (dedupe by project id).

**Credentials:** `OPENGOV_EMAIL` / `OPENGOV_PASSWORD` (Railway env). **Expected Tier 1 MVP scale:** ~128 open CA construction opportunities today.

*Category coverage is now settled. The driver can be built once against this dictionary without revisiting category strategy.*
