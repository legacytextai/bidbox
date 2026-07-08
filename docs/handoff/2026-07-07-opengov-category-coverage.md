# OpenGov Category Coverage — Verified Follow-up to the Protocol Recon

**Date:** 2026-07-07
**Extends:** `docs/handoff/2026-07-07-opengov-protocol-recon.md` (§2.1 category resolution)
**Method:** Live authenticated API measurement (same session), `POST /api/v1/categories/search` + `POST /api/v1/project/search`. All numbers are live counts as of 2026-07-07, CA + open.
**Trigger:** Product manual recon suspected that a single parent NAICS category under-covers. **Confirmed — and the real gap is bigger and different than expected.**

---

## TL;DR (verified, corrects one assumption)

1. **The category-code system is the `set` query param** on `categories/search`: **`set=200` = NAICS, `set=100` = NIGP, `set=300` = UNSPSC.** Body `{ "query": "<text>" }`. Returns a JSON array of `{ id, code, title, setId, isLeaf, group1..group6 }`. **Hard-capped at 100 results per query; `page`/`limit` are ignored.**
2. **NAICS parent `23 Construction` (id `20000205`) already rolls up all children.** Parent-only = **27** CA projects; the full 73-category NAICS-23 family (all `23xxxx` codes) = the **same 27** (adds **0**). *The suspicion that NAICS children add coverage is not borne out on OpenGov — the parent is sufficient for the NAICS axis.*
3. **The real gap is cross-system, and it is large.** The three classification systems are **almost perfectly disjoint** for the same CA construction universe:

   | Search (CA, open) | Projects | Adds over prior |
   |---|---:|---:|
   | NAICS `23 Construction` (`20000205`) | 27 | — |
   | + NIGP `construction` (100 categories) | +73 | union = **100** |
   | + UNSPSC `construction` (11 categories) | +11 | union = **111** |

   **NAICS↔NIGP overlap = 0 projects.** Using all three ≈ **4.1× the coverage** of NAICS alone (27 → 111).
4. **Dedupe by OpenGov project `id` is correct and trivial** (stable integer key). Overlap happens to be ~0 today, but multi-search + dedupe is the right, safe design.

**Bottom line:** the product's instinct to broaden was right; the *axis* was wrong. Don't broaden within NAICS (children add nothing) — broaden **across NAICS + NIGP + UNSPSC**, merged and deduped by project id.

---

## The `categories/search` contract (verified)

```
POST https://api.procurement.opengov.com/api/v1/categories/search?set=<SET>
Cookie: <session>          # credentials: 'include'
Content-Type: application/json

{ "query": "<free text, e.g. 23 or construction>" }
```

- **`set`** (query string) selects the taxonomy: **`100` NIGP · `200` NAICS · `300` UNSPSC**. (Sets 1/2/3/101/102/201 returned empty.) Omitting `set` → `400 {"message":"Please specify the categorization system"}` (this was the earlier 400).
- **Response:** array (not enveloped) of category objects:
  ```json
  { "id": 20000205, "code": "23", "title": "Construction", "setId": 200,
    "isLeaf": false, "group1": "23", "group2": null, ... "group6": null }
  ```
  `id` is the internal id used in `project/search.categories`; `code` is the human taxonomy code; `setId` echoes the set.
- **Cap: 100 results per query, no pagination** (`&page=2` and `&limit=300` both still return 100). Different query terms return different (overlapping) subsets: `construction`=100, `build`=87, `concrete`=86, `plumb`=22, `paving`=5.

## The measurement (verified live)

- NAICS parent `[20000205]` + `states:['CA']` → **count 27**.
- NAICS all `23xxxx` (73 categories resolved from `set=200`, `code.startsWith('23')`) + CA → **count 27**, of which **0** are new vs the parent. → NAICS children are auto-included by the parent.
- NIGP `construction` (100 categories from `set=100`) + CA → **count 73**; **intersection with the NAICS-23 project set = 0**.
- UNSPSC `construction` (11 categories from `set=300`) + CA → **count 11**; **11 new** over NAICS∪NIGP.
- Union(NAICS23, NIGP-construction) = **100**; Union(all three) = **111**.

---

## Recommended driver discovery strategy (updated; supersedes protocol §2.1 / §7 single-category note)

**Do not** scan with `{ categories:[20000205], states:['CA'] }` alone — that captures only 27 of ~111 CA construction opportunities (~24%).

**Do** run a multi-taxonomy resolve → search → merge → dedupe:

```
authenticated session
  → resolve category ids (per set):
       NAICS  : categories/search?set=200  query "23"          → take code.startsWith('23')  (or just use parent id 20000205)
       NIGP   : categories/search?set=100  query "construction" → all 100 ids
       UNSPSC : categories/search?set=300  query "construction" → all ids
  → project/search (per taxonomy, CA, limit high) OR one combined categories[] array
  → merge projects, DEDUPE BY project.id
  → detail-enrich + document acquisition (unchanged, protocol §3/§5)
```

Notes for implementation:
- **NAICS:** the parent id `20000205` is sufficient (children add nothing). Simplest correct choice.
- **NIGP / UNSPSC:** resolution is capped at 100 categories per query term. `"construction"` is a strong MVP seed (yields the +73 / +11). If later coverage audits show gaps, add more NIGP/UNSPSC seed terms (`concrete`, `paving`, `build`, `plumbing`, `electrical`, `grading`, `roofing`, …) and union the category ids — recall over precision, since dedupe by project id makes overlap free.
- **Combined vs per-set search:** a single `project/search` with the merged `categories[]` (across sets) is likely fine (it's just a larger id array) and cheaper; per-set-then-merge is clearer and identical after dedupe. Either works; dedupe by `id` regardless.
- **False positives:** NIGP/UNSPSC "construction" nets include some services/materials adjacent to pure public-works construction. Per the product's call, **prefer recall** at scan time; apply relevance judgement downstream (the existing title relevance sweeper + F4 intelligence), not at the category filter. Do **not** narrow the category net to chase precision.

## Category-drift handling

- **Resolve at scan time, cache in code with a fallback.** Recommend: keep a checked-in constant set of resolved ids (NAICS `20000205`; the NIGP + UNSPSC "construction" id lists) as the fast path, and re-resolve via `categories/search` opportunistically (e.g., weekly or on scan) to catch new categories. OpenGov category ids are stable integers, so hardcoding the seed set is safe; re-resolution guards against drift without blocking a scan if `categories/search` shape changes.
- Do **not** hardcode raw taxonomy codes in `project/search` — it takes internal ids only (`20000205`, not `"23"`).

## Answers to the product's implementation questions

1. **Programmatic resolution?** Yes — `categories/search?set=<100|200|300>` body `{query}` returns the ids. Verified.
2. **Request shape to select NAICS vs NIGP?** The **`set` query param** (200 / 100 / 300). Not a body field.
3. **Reproduce NAICS "23" and NIGP "construction"?** Yes — `set=200 query:"23"` and `set=100 query:"construction"`, verified.
4. **Hardcode / cache / DB / refresh?** Cache the resolved seed ids in code (fast, stable) + opportunistic re-resolve for drift. DB storage is overkill for MVP.
5. **Prevent drift?** Stable integer ids + periodic re-resolve; alert if a scan's resolved id count drops sharply.
6. **Duplicates across NAICS/NIGP?** Measured overlap = **0 projects** today; still dedupe by `id` (safe, future-proof).
7. **NIGP false positives?** Some, yes — handle downstream (relevance sweeper / F4), not by narrowing categories.
8. **Category-only vs secondary relevance filter?** Category-only for discovery (maximize recall); rely on existing downstream relevance/intelligence for precision.

## MVP decision (confirmed, with correction)

**Correct MVP filter = CA + construction across all three taxonomies, merged and deduped by project id:**
- NAICS: `[20000205]` (parent; children add nothing)
- NIGP: all ids from `set=100 query:"construction"`
- UNSPSC: all ids from `set=300 query:"construction"`

Expected scale today: **~111 open CA construction opportunities** (vs 27 NAICS-only). This is the number to validate the driver against.

*No driver code written — this remains pre-implementation recon per instruction.*
