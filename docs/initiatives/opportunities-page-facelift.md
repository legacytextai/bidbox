# Opportunities Page Facelift

Status: 📋 PLANNED — documentation only, no implementation started
Date: 2026-07-13
Document type: Initiative document
Implementation plan: `docs/initiatives/opportunities-page-facelift-implementation-plan.md`
Task list: `docs/initiatives/opportunities-page-facelift-task-list.md`
Branch: `phase1-opportunity-intelligence`
Related: `docs/initiatives/completed/oml-opportunity-metadata-layer.md` (normalized metadata columns), `docs/initiatives/opportunity-intelligence-mvp.md` (discovery → intelligence loop), `docs/initiatives/f5-opportunity-project-workspace.md` (workspace evolution)

---

## ⚠️ Protected Opportunity Card Rule (read first)

**The opportunity cards rendered on `/opportunities` are a protected UI surface.**

No change in this initiative — and no future agent working from this document — may modify the inside of an opportunity card without explicit, per-change authorization from the product owner. This prohibition covers:

- Badges, labels, icons, buttons, and status pills
- Metadata rows and their order
- Card layout, spacing, colors, and typography
- Hover behavior and focus states

The facelift reorganizes everything **around** the cards: tabs, page hierarchy, search, empty states, and surrounding controls. The cards themselves (`renderCard` in `src/pages/Opportunities.tsx`) are display targets, not design targets. Search results, For You results, and every other new surface must render the existing cards unchanged.

If a proposed change seems to require touching the cards (for example, showing a per-card similarity score), the default answer is **no** — solve it outside the card (ordering, section headers, page-level messaging) or escalate for explicit authorization.

---

## Executive Summary

The Opportunities page is BidBox's front door, but it currently behaves like an admin table: one flat feed (`All` / `Saved` / `Closed`), user qualification results awkwardly folded into the `All` tab as a collapsed "Filtered Out" section, no personalization surface, and no search of any kind.

This initiative restructures the page around two ideas:

1. **`For You` becomes the default tab** — a personalized, qualification-driven feed that starts county-based and grows in value as the Qualification Agent expands. `All` becomes what its name promises: the true, complete BidBox opportunity inventory, no longer filtered by the user's Bid Profile.
2. **Natural-language opportunity search** — a search bar at the top of the page that interprets plain-language intent ("water treatment projects over $2 million", "Riverside projects involving underground utilities") and returns relevance-ranked results using the existing cards, via a hybrid of structured constraint extraction and semantic (embedding) retrieval.

The existing `All`, `Saved`, and `Closed` tabs are preserved. The cards are untouched. Nothing in this document proposes a card change.

## Product Objective

Make `/opportunities` answer the contractor's real question — *"what should I bid?"* — instead of *"what did BidBox scrape?"*, while keeping the complete inventory one click away and making the whole database reachable through ordinary language.

## User Problem

- **Relevance is buried.** Qualification results exist (`user_opportunity_qualifications`) but surface only as a "Filtered Out" collapse at the bottom of `All`. The user never sees a positive "these match you" feed — only a negative "these were removed" list.
- **`All` is not really all.** Today the `All` tab hides red-qualified opportunities into the Filtered Out section, so the label lies in both directions: it is neither a clean personalized feed nor a trustworthy complete inventory.
- **No search.** A contractor looking for "asphalt overlay projects" must scroll the entire grid or abuse the agency facet. Titles, scope text, counties, and values are all in the database but unreachable by intent.
- **No guidance when empty.** A new user with no Bid Profile sees the same flat feed as a configured user, with no path to improving relevance.

## Product Decisions (settled — do not relitigate)

These decisions were made by the product owner and are fixed inputs to this initiative:

1. **Tab order:** `All` · `For You` · `Saved` · `Closed`. The three existing tabs are preserved with their existing names and meanings; `For You` is inserted between `All` and `Saved`.
2. **`For You` is always the default tab.** No conditional defaults based on Bid Profile completeness, qualification state, account age, user type, or onboarding state. When a user opens Opportunities, the default view is For You, period. The user may manually switch tabs.
3. **`For You` is the personalized, qualification-driven feed.** The initial version may rely primarily on geography (selected counties). It must be designed so it gains value automatically as the Qualification Agent expands — do not delay it waiting for the full agent.
4. **`All` is the true complete inventory.** No user-profile or qualification filtering. Global validity rules only (see below).
5. **Natural-language search** sits at the top of the page, interprets meaning rather than keywords, ranks by relevance, supports refinement, and renders results with the existing cards.
6. **The cards are protected** (see the rule above).

## Tab Behavior

### Tab hierarchy

```
[ All ]  [ For You ]  [ Saved ]  [ Closed ]        ← rendered order
              ▲
              default on page open
```

### For You

The personalized feed. An opportunity appears in For You when it is globally valid (not quarantined, not globally excluded, not a duplicate), not closed, and the user's active qualification row (`user_opportunity_qualifications.status`) is `green` or `yellow`. Red-qualified opportunities do not appear (their "why" remains visible on `All` via the existing Filtered Out treatment, unchanged).

- Initially this is county-driven (Bid Profile `target_counties` via `qualify-candidates`), plus the existing value-range and public-works checks. That is acceptable for v1.
- Ordering: the existing sort options apply; the default sort may bias `green` above `yellow` (page-level ordering, not a card change).
- As the Qualification Agent grows (project type, scope, contract value, license requirements, bonding capacity, agency preferences, contractor experience, compliance requirements), For You inherits the improvement with **zero UI changes** — the tab reads qualification output, it does not implement qualification. This contract is the core design constraint: For You consumes `user_opportunity_qualifications` (or its successor) and never re-implements matching logic client-side.

### All

The true, complete BidBox opportunity inventory: every supported geography, agency, project type, and value. `All` must not apply the user's Bid Profile or qualification results as a visibility filter.

Four distinct concepts, which today are conflated and must be kept separate:

| Concept | What it is | Applies to All? |
|---|---|---|
| **User filtering** | Bid Profile / qualification results (`user_opportunity_qualifications`), per-user | **No.** This is what For You is for. |
| **Global validity rules** | System artifacts that are not usable opportunities: quarantined ingestion records (`ingestion_status = 'quarantined'`), broken placeholders (empty titles), records with a `global_exclusion_code` | Yes — excluded for everyone |
| **Portal deduplication** | Exact duplicates where a canonical opportunity exists (`canonical_candidate_id` set; e.g. Caltrans-native vs. aggregator copies) | Yes — the canonical record shows, the duplicate doesn't |
| **Closed** | `bid_due_at` in the past | Moves the record to the Closed tab (existing behavior) |

**Behavior change from today:** the current `All` tab pushes red-qualified opportunities into the collapsed "Filtered Out" section. After the facelift, `All` shows every valid open opportunity as a normal card. The existing amber "Filtered out: reason" panel treatment inside cards is an existing card element and is preserved as-is where it already appears; the facelift only stops using user qualification as a *visibility* rule on All. The user must be able to trust that All is genuinely comprehensive.

### Saved

Unchanged: opportunities the user bookmarked (`saved_opportunities`), open only. Saving/unsaving continues to work identically from any tab and from search results.

### Closed

Unchanged: opportunities whose `bid_due_at` is in the past, regardless of qualification or saved state.

## Empty and Incomplete States (For You)

For You remains the default even when it has nothing good to show. No automatic redirect to All, ever. Three states, in priority order:

1. **No Bid Profile / empty profile.** Full-tab empty state: explain that For You is powered by the Bid Profile, with a single primary action **"Complete your Bid Profile"** → `/qualification-profile`, and a secondary text link "Browse all opportunities" that switches to the All tab (a link, not a redirect). One illustration-free panel; no modal.
2. **Qualification in progress.** When a `qualification_jobs` row is active for the user (the existing `useQualificationJob` hook already tracks this), show a processing panel: "BidBox is evaluating N opportunities against your Bid Profile" with the existing progress counts. Existing results, if any, stay visible below the panel (this mirrors the current banner behavior).
3. **Profile complete, zero/few matches.** State the fact plainly ("No open opportunities currently match your Bid Profile"), show *why* dimension counts if cheaply available (e.g. "Your profile targets 2 counties"), offer **"Adjust Bid Profile"** and the same "Browse all opportunities" link. If there are a handful of matches, no special state — just the short list; never pad For You with unqualified records.

**Recommended UX:** one shared empty-state component with these three variants, rendered in the card-grid area. The tab itself always renders with a real count so the user learns what For You is even when it is empty. This is the cleanest option because it needs no conditional-default logic, no redirects, and produces an obvious, single next action per state.

## Natural-Language Opportunity Search

### Vision

A search bar at the top of the Opportunities page (above the tabs) where the user describes work in ordinary language:

- `asphalt overlay projects`
- `fencing projects`
- `water treatment projects over $2 million`
- `school modernization projects bidding next month`
- `Riverside projects involving underground utilities`
- `projects requiring storm drain repairs`

The system interprets intent — not just tokens — and returns the most relevant opportunities as the **existing cards**, ranked by relevance. The user can refine ("only next 30 days") or clear back to the browsing feed. Conceptual inspiration only (meaning-based search, relevance ranking, refinement, deeper follow-up) is taken from competitor products such as BidAmerica's Global AI Search; no visual design, language, layout, branding, or implementation is copied, and no knowledge of their internal architecture is claimed.

### Product behavior

1. User types a plain-language query and submits.
2. The system extracts any **structured constraints** it can (county, agency, value range, bid-date window) and interprets the **semantic remainder** ("underground utilities") as meaning.
3. Results render as the existing cards, ordered by relevance, replacing the browse grid; browsing state (tab, sort, facets) is restored when search is cleared.
4. Active interpreted constraints are displayed as removable chips **above the grid** (never on cards), so the user sees exactly how their query was understood and can correct it.
5. The user refines by editing the query or removing chips; follow-up queries re-rank without a full page reset.
6. **Deeper analysis is not new UI:** a result card's existing "View Project" / Analyze Project path is the drill-down. A dedicated conversational deep-dive is explicitly deferred (see MVP scope).

### Search × tabs — recommendation

**Search operates within the selected tab.** The active tab is a scope, search is a lens:

- **For You + search:** qualification constraints are preserved; search re-ranks within the user's qualified set. This keeps For You's promise ("everything here matches you").
- **All + search:** searches the entire valid inventory (global validity and dedup rules still apply — search never resurrects quarantined or duplicate records).
- **Saved / Closed + search:** filters within those sets. These are small sets, so this is cheap and unsurprising.
- **Zero results in a scoped search:** show a zero state that says which scope was searched and offers one-click **"Search All opportunities instead"** (except when already on All). Never silently widen the scope.

This is recommended over "search always hits All" because it makes the tab bar and search composable rather than conflicting, and it gives For You search a clean answer to "should qualification constraints survive search?" — yes, by construction.

### MVP architecture — options considered

All options build on the same data reality: search-relevant fields already exist as normalized columns on `opportunity_candidates` (OML: `raw_title`, `agency`, `county`, `scope_text`, `estimated_value`/`_low`/`_high`, `bid_due_at`, `required_licenses`, `required_naics`, `portal_department`, `project_address`) plus, for analyzed opportunities only, `opportunity_intelligence_reports` (executive summary, scope summary) and `opportunity_document_chunks` (full text, no embeddings today). The repo currently has **no pgvector, no tsvector, and no search infrastructure of any kind** (verified against `supabase/migrations/` at the current head).

| Option | Sketch | Verdict |
|---|---|---|
| **A. Postgres full-text only** | `tsvector` over title/agency/scope, `websearch_to_tsquery` | Cheap, fast, zero AI cost — but it is keyword matching; "storm drain repairs" won't find "drainage rehabilitation". Fails the core product requirement on its own. Useful as a ranking channel, not as the product. |
| **B. pgvector semantic + LLM constraint extraction (hybrid)** | Enable the `vector` extension in the existing Supabase; embed one search document per opportunity into a side table; at query time a small LLM extracts structured constraints, the remainder is embedded and matched by cosine similarity, with SQL WHERE clauses from the constraints; final ranking blends similarity + FTS + due-date signal | Meets the meaning requirement, stays inside the existing Supabase (no new service), well-trodden pattern, incremental cost ≈ one cheap LLM call + one embedding call per query. **Recommended.** |
| **C. External search service (Elasticsearch / Typesense / Algolia / Pinecone)** | Sync opportunities out to a dedicated engine | Best-in-class ranking control, but a new service to deploy, sync, secure, and pay for — disproportionate at current inventory scale (thousands of rows, single region). Revisit if inventory reaches ~10⁶ rows or multi-tenant GOR materializes. |
| **D. LLM-only ("ask the model to pick")** | Ship candidate rows to a large model per query | Simple but slow, expensive, unrankable at inventory scale, and non-deterministic. Rejected. |

### Recommended architecture (Option B — hybrid)

```
                         user query (plain language)
                                   │
                     search-opportunities edge function
                                   │
              ┌────────────────────┴────────────────────┐
              │ 1. Query interpretation (Claude Haiku)   │
              │    → { counties?, agencies?, value_min?, │
              │        value_max?, due_before?/after?,   │
              │        semantic_text }                   │
              │    (timeout → fall back to whole query   │
              │     as semantic_text, no constraints)    │
              └────────────────────┬────────────────────┘
                                   │
              ┌────────────────────┴────────────────────┐
              │ 2. Retrieval (one SQL RPC)               │
              │    WHERE global-validity + dedup + tab   │
              │      scope + extracted constraints       │
              │    ORDER BY hybrid score:                │
              │      cosine(query_emb, opp_emb)          │
              │      ⊕ ts_rank (keyword channel)         │
              │      ⊕ due-date proximity boost          │
              └────────────────────┬────────────────────┘
                                   │
                 ranked candidate ids + interpreted chips
                                   │
                 frontend renders EXISTING cards in order
```

**Indexing side (write path):**

- New side table `opportunity_search_index` (1:1 with `opportunity_candidates`): the composed search document text, its embedding (`vector` column), a `tsvector` column, source-content hash, and freshness bookkeeping. A side table — not columns on `opportunity_candidates` — keeps the hot scan path and Codex's concurrent candidate work untouched.
- The **search document** composes: title, agency, county, portal department, scope_text, required licenses/NAICS, value band, and — when an intelligence report exists — its executive/scope summary. Intelligence summaries are an enrichment, not a dependency: most opportunities are searchable from portal metadata alone.
- Embeddings are generated by the existing Railway worker (it already owns background AI work) from a queue: new/changed candidates get their hash compared and re-embedded only when the composed document actually changed. A nightly reconciliation sweep catches stragglers, so **stale embeddings self-heal** and **newly ingested opportunities become searchable within minutes of a scan** without coupling the scan path to the embedding provider.

**Ranking:** reciprocal-rank fusion (or a tuned weighted sum) of the vector-similarity ranking and the FTS ranking, then a small deterministic boost for sooner `bid_due_at`. Structured constraints are hard `WHERE` filters, not ranking inputs — "over $2 million" must never return $500K projects that are merely semantically similar.

**Similarity score visibility — recommendation: not user-visible.** Scores are logged for evaluation but never displayed. Rationale: (a) cards are protected, so there is nowhere legitimate to put a per-card score; (b) raw cosine numbers mislead users; (c) ordering already communicates relevance. Revisit only if user research demands it, and even then as page-level messaging.

### Cost, latency, and first-page load

- **First page load never touches AI.** Tabs render from plain Postgres exactly as today; search work happens only when the user searches.
- Per query: one Haiku-class extraction call (~sub-second, fractions of a cent) + one embedding call (cheap) + one SQL RPC. Extraction has a hard timeout (~2s) with graceful fallback to pure semantic search.
- Query embeddings for identical normalized query text are cacheable; the corpus is embedded once per content change, not per query.
- Guardrails: per-user rate limit on the search function; index writes batched in the worker; embedding model chosen for cost (small text-embedding model, not a frontier model).

### Measuring search quality

- A committed **golden query set** (~30–50 queries with expected top results, curated from real portal data) run against the RPC in CI-ish fashion — recall@10 / MRR tracked before and after ranking changes.
- A lightweight `opportunity_search_events` log (query, interpreted constraints, result count, clicked candidate ids, zero-result flag) to observe real usage: zero-result rate, click-through position, refinement rate.

## MVP Scope

**In:**
- Four tabs in the specified order, For You default, URL-persisted tab state
- For You reading existing qualification output; the three empty/processing states
- All as true inventory (global validity + dedup only)
- Hybrid natural-language search (constraint extraction + pgvector + FTS) scoped to the active tab, with interpreted-constraint chips, zero-result states, and search-event logging
- Embedding index build + freshness pipeline + golden query set

**Out (explicit non-goals, see also bottom):**
- Conversational multi-turn "deeper analysis" chat over search results — the existing per-opportunity Analyze Project / Project Intelligence flow is the drill-down. A search-integrated deep-dive is a candidate follow-on initiative once search usage data exists.
- Any qualification logic beyond consuming existing outputs
- Any card modification

## Future-State Qualification Integration

The Qualification Agent roadmap (counties → project type, scope of work, contract value, license requirements, bonding capacity, agency preferences, contractor experience, compliance requirements) plugs into this design at exactly two seams, neither of which requires page changes:

1. **For You membership** — the agent writes richer `user_opportunity_qualifications` rows (or a successor table with the same read contract: candidate id → status + reasons). The tab query is unchanged.
2. **Search personalization (later)** — qualification features could become optional ranking signals for For You–scoped search. This is deliberately not in the MVP.

The one contract to protect: **qualification output remains a per-user, per-candidate row with a status and human-readable reasons.** Any future schema change must preserve or migrate that read path.

## UX Flow (target)

```
/opportunities
┌──────────────────────────────────────────────────────┐
│  Opportunities            ⟳ Last scanned: 2h ago     │
│  ┌────────────────────────────────────────────────┐  │
│  │ 🔍  Describe the work you're looking for…       │  │
│  └────────────────────────────────────────────────┘  │
│  [interpreted-constraint chips when searching]        │
│                                                      │
│  [All 214] [For You 37] [Saved 5] [Closed 480]       │
│                       ▲ default    [Sort] [Agency ▾] │
│                                                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│  │ EXISTING│ │ EXISTING│ │ EXISTING│   ← cards       │
│  │  CARD   │ │  CARD   │ │  CARD   │     unchanged   │
│  └─────────┘ └─────────┘ └─────────┘                │
└──────────────────────────────────────────────────────┘
```

- Tab selection and search query persist in the URL (`/opportunities?tab=for-you&q=…`) so back-navigation from a detail page restores the exact view (the existing sessionStorage scroll anchor keeps working), links are shareable, and refresh is lossless. This is the recommended answer to state persistence: **URL for tab + query, sessionStorage for scroll, nothing new in localStorage.**
- The page must clearly communicate which filters are active: the tab itself communicates qualification scope ("For You · based on your Bid Profile" subtitle), chips communicate interpreted search constraints, and the existing facet/sort controls remain visible and composable.

## Data Requirements

| Need | Source | Status |
|---|---|---|
| Tab membership (valid/open/closed/dup) | `opportunity_candidates`: `ingestion_status`, `global_exclusion_code/reason`, `canonical_candidate_id`, `bid_due_at` | Exists |
| For You membership | `user_opportunity_qualifications` (status, reasons, active) + `qualification_jobs` progress | Exists |
| Saved membership | `saved_opportunities` | Exists |
| Search filters | OML columns: `county`, `estimated_value(_low/_high)`, `agency`, `bid_due_at` | Exists |
| Semantic corpus | Composed search doc from OML fields + optional `opportunity_intelligence_reports` summaries | New (side table) |
| Embeddings | `vector` extension + embedding column + freshness fields | New |
| Keyword channel | `tsvector` on the search doc | New |
| Quality telemetry | `opportunity_search_events` | New |

All new objects are additive; no existing table is altered.

## Dependencies

- **Geography/qualification work in flight (Codex):** shadow geography resolution (`california_counties`, `california_city_counties`, `agency_jurisdictions`, `opportunity_geography_evidence`, `user_opportunity_geography_shadow`; migration `20260714010000_geography_resolution_shadow.sql`, `src/lib/geographyVisibility.ts`) will materially improve county coverage and therefore For You quality. The facelift **reads** whatever county/qualification data exists; it must not modify or depend on the shadow model's promotion timeline.
- **Known conflict surface:** `src/pages/Opportunities.tsx` is under active concurrent modification (an interactive rebase with an unresolved conflict in the candidate-loading path existed in the working tree when this document was written). Facelift implementation must start from a clean, post-Codex state of that file and should extract the page into smaller components early (tabs, grid, search bar) precisely to shrink future conflict surface.
- `qualify-candidates` / `qualification_jobs` / `useQualificationJob` — consumed as-is.
- Supabase `vector` extension availability on the hosted project (standard, but must be enabled via migration).

## Risks

| Risk | Mitigation |
|---|---|
| For You default disappoints users with thin profiles | The three explicit empty/processing states with a single clear action; All is one click away |
| Changing All's semantics (no longer hides red-qualified) surprises existing users | Release note + the existing per-card "Filtered out" panel still explains red reasons; For You gives the curated view they actually wanted |
| Semantic search returns plausible-but-wrong results | Hard WHERE constraints for extracted numerics/geography; golden query set gating ranking changes; chips make the interpretation visible and correctable |
| Embedding pipeline lags ingestion → new opportunities invisible in search | Search retrieval falls back to FTS-only for rows without embeddings (they're still findable); nightly reconciliation; freshness metric |
| LLM extraction latency/cost creep | Haiku-class model, hard timeout with semantic-only fallback, per-user rate limit, query-embedding cache |
| Client-side load-everything pattern won't scale with search | Search is server-side (RPC returns ranked ids); browse path unchanged for now; pagination noted as an open question below |
| Concurrent edits to Opportunities.tsx | Component extraction first; coordinate merges; never implement during an unresolved rebase |

## Open Questions

1. **Browse-path pagination.** The page currently loads the entire candidate table client-side (paginated fetch, 50K-row safety ceiling). Fine today; at what inventory size do the tabs themselves need server-side pagination? (Search is server-side from day one.)
2. **Should yellow-status opportunities appear in For You by default,** or behind a page-level "include near-matches" toggle? Current recommendation: include, sorted below green (page-level ordering only).
3. **Embedding model choice** (OpenAI `text-embedding-3-small` vs. Voyage vs. other) — decide at implementation time on cost/quality/vendor-consolidation grounds; the schema is model-agnostic if dimension is fixed per rebuild.
4. **Search across Closed:** is searching closed opportunities valuable enough to index them, or should the index cover open records only (smaller, cheaper)? Recommendation: index everything valid, filter by scope at query time — closed history has research value.
5. **Where does the future "deeper analysis" conversation live** — search surface, opportunity detail, or Project AI? Deferred until search-usage telemetry exists.
6. **Multi-tenant future (GOR):** if candidates become a shared global table, the search index moves with them; the per-user layer (For You, Saved) already sits in per-user tables. No blocker identified, but re-check when GOR is designed.

## Acceptance Criteria (initiative level)

1. `/opportunities` shows exactly four tabs in the order All · For You · Saved · Closed; opening the page always lands on For You regardless of profile/qualification/account state.
2. All, Saved, and Closed behave exactly as their current definitions (with All additionally showing previously qualification-hidden valid records as normal cards).
3. For You shows only globally valid, open, green/yellow-qualified opportunities for the signed-in user, and updates after a qualification job completes (existing refresh behavior).
4. Each of the three For You empty/processing states renders with its specified action; no state ever auto-redirects to another tab.
5. A natural-language query such as "storm drain repair projects in Riverside under $5M" returns relevance-ranked existing cards, displays its interpreted constraints as removable chips, and respects the active tab scope.
6. Zero-result searches show the scoped zero state with a one-click widen-to-All option.
7. Tab and query state survive refresh and back-navigation via the URL.
8. No opportunity card markup, styling, or behavior differs from pre-facelift (pixel/DOM parity on the card subtree).
9. Golden query set achieves the agreed baseline (target set during Phase 6; suggested starting bar: expected result in top 10 for ≥80% of golden queries).
10. First-page load performance is unchanged (no AI calls, no embedding reads on the browse path).

## Rollout Strategy

1. **Phase-gated implementation** per the implementation plan — tabs/states ship before search; search index builds silently before the search bar appears.
2. **Feature flag** (existing `app_settings` pattern) for the search bar so the index can run in production while the UI is dark; For You tab ships without a flag (it is additive and default-safe by construction of its empty states).
3. **Validation in production** with the team's own accounts against live inventory (the established controlled-validation playbook), including the golden query set, before announcing.
4. **Rollback:** search bar flag off → page is fully functional without search; For You tab is independent of search and rolls back by reverting the tab default (one-line change) if needed. The search index tables are additive and inert when unread.

## Non-Goals

- Any modification to opportunity cards (protected rule above)
- Building or expanding the Qualification Agent itself
- Conversational deep-analysis chat in the MVP
- External search infrastructure (Elasticsearch/Algolia/Pinecone)
- Renaming or repurposing All/Saved/Closed; conditional tab defaults
- Global Opportunity Repository (GOR) work
- Changes to scan/ingestion, portal drivers, or the OML boundary
- Mobile-specific redesign
