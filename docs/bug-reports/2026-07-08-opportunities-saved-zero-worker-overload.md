# Bug Report — Opportunities Page Showed Missing Old Projects / Saved Count 0 After Midnight Scan

**Date:** 2026-07-08
**Project:** BidBox
**Branch:** `phase1-opportunity-intelligence`
**Primary impacted area:** `/opportunities` feed (frontend read path) + Railway worker queue (PlanetBids `document_prefetch`)
**Status:** Resolved — fixes deployed, worker resumed clean
**Severity:** High for trust (appeared to be data loss); high for operations (worker overload)

---

## Bug Description

After the nightly/broad scan ran at approximately midnight PDT on 2026-07-08, the
`/opportunities` page appeared to lose older opportunities and the **Saved tab
showed `0`**, even though saved rows still existed in the database. In parallel,
the Railway worker was overloaded with failing PlanetBids `document_prefetch`
tasks, and the feed was polluted with incomplete `Untitled Opportunity` rows.

Nothing was actually deleted. The disappearance was a **read-side** bug, and the
worker failures were an **operational overload** — two independent root causes
that surfaced together because the same nightly scan triggered both.

---

## Current Behavior

- `/opportunities` no longer showed the older/pre-midnight opportunities.
- **Saved tab count showed `0`** despite 7 saved rows existing in the database.
- The feed was polluted with new PlanetBids / Cal eProcure rows, many rendering
  as `Untitled Opportunity` with missing bid-due dates.
- Coverage dashboard (24h) showed a large failure spike, dominated by
  `document_prefetch`:
  - Queue: **41 pending / 6 running**
  - **Failed (24h): 622**
  - Failures included **Browserbase 429 Too Many Requests** and
    **"No PlanetBids bearer token captured after login"**.
- Screenshot tab math confirmed a hard client-side cap:
  **All 639 + Closed 320 + Filtered Out 41 = 1000**.

---

## Expected Behavior

- `/opportunities` should show **all** current candidates, not just the newest 1000.
- The Saved tab should reflect the user's saved rows regardless of how many total
  candidates exist or how recently they were created.
- "My Projects" backing candidates should remain reachable in the UI.
- Broad/nightly scans should **not** flood the worker with document-acquisition
  work; discovery should be metadata-only unless acquisition is explicitly requested.
- Incomplete/`Untitled` candidates should not clutter the main feed.

---

## Steps to Reproduce / Timeline

1. Nightly/broad multi-portal scan runs at ~00:00 PDT 2026-07-08 and inserts a
   large batch of new candidates (**+773**), growing the table from 667 to **1,440**.
2. Open `/opportunities` as the admin user (`constructionaisolutions.co@gmail.com`,
   `324e7848…`).
3. Observe old opportunities missing from "All" and **Saved = 0**.
4. Observe worker queue backing up with failing PlanetBids `document_prefetch`
   tasks (Browserbase 429, missing bearer token).

---

## Environment

- **Frontend:** `src/pages/Opportunities.tsx` (React + Supabase JS client); route `/opportunities`.
- **Data:** Supabase Postgres via PostgREST; tables `opportunity_candidates`,
  `saved_opportunities`, `projects`, `agent_tasks`.
- **Worker:** `bidbox-worker` on Railway (service `bidbox`, project `supportive-truth`),
  normally 6 replicas; drivers use Browserbase for browser sessions.
- **Relevant limits:** Supabase/PostgREST default **1000-row** response cap;
  Browserbase account-wide session/rate limit; single global PlanetBids login lock.

---

## Additional Context

- Total candidates: **1,440** (pre-midnight **667**, new after midnight **773**).
- Saved rows: **7** (all for user `324e7848`); My Projects rows: **3**.
- **No rows were deleted or overwritten** — verified: 0 pre-midnight candidates
  were updated after midnight; all 7 saved FKs + 3 project FKs + sampled old rows
  resolve to intact pre-midnight rows.
- PlanetBids is the dominant portal (**76 sources / 924 opportunities**), which is
  why it produced the overwhelming majority of the `document_prefetch` load.

---

## Root Cause

### Root Cause A — Frontend 1000-row Supabase Cap

`src/pages/Opportunities.tsx` fetched `opportunity_candidates` ordered by
`created_at desc` **without pagination / `.range()`**. Supabase/PostgREST silently
caps an unranged response at **1000 rows**. Once the table grew to 1,440 after the
midnight scan, the client received only the **1000 newest** rows and silently
dropped the **440 oldest** — which included the older enriched opportunities, all
7 saved candidates, and all 3 project-backing candidates.

The Saved tab and its count are computed by filtering the **client-side candidate
array** by the user's saved IDs. The saved IDs were fetched correctly (all 7), but
the corresponding candidate objects were in the dropped tail, so the Saved tab
rendered **0**. The tab math `639 + 320 + 41 = 1000` corroborates the cap exactly.

### Root Cause B — PlanetBids/document_prefetch Worker Overload

At discovery, every newly-inserted candidate for which `supportsDocumentPrefetch`
is true (PlanetBids included) auto-enqueued a `document_prefetch` task
(`bidbox-worker/index.js`, `persistScannedCandidate`). The nightly scan discovered
hundreds of new PlanetBids candidates, each spawning a Browserbase + login
prefetch. With 6 replicas all claiming these:

- they contended for the **single** PlanetBids login lock (each loser waited up to
  **15 × 20s = 5 minutes**, holding a worker, then requeued to `pending` with **no
  delay** → immediately re-claimed → hot-looped);
- each hammered **Browserbase session creation**, which had **no concurrency cap
  and no 429 handling**, producing HTTP **429 Too Many Requests** with no backoff;
- incomplete candidates (null/empty `raw_title`) were classified as high-relevance
  and shown in the main feed as `Untitled Opportunity`.

---

## Investigation Notes

- The worker was paused (start-command override `sleep infinity`) before any
  read-only forensic inspection, so nothing could change mid-investigation.
- All investigation was **read-only** (PostgREST GET queries + code inspection).
- Key confirmations: `created_at < midnight AND updated_at >= midnight` = **0**
  (no old row overwritten); the 7 saved rows and 3 projects all resolve to intact
  pre-midnight candidates; an unranged frontend-style fetch returns **exactly 1000**
  rows and drops all 7 saved candidates + all 3 project-backing candidates.
- A separate observation: 125 OpenGov `document_prefetch` tasks (trigger
  `manual_validation`) had been enqueued overnight and were all **manually
  cancelled** (`failed`) before executing — they downloaded nothing; OpenGov has
  **0** `opportunity_documents`.

---

## Fix Implemented

### Fix A — Frontend Pagination

- **Commit:** `0cf76f1`
- **File:** `src/pages/Opportunities.tsx`
- Replaced the single unranged fetch with a **paginated `.range()` loop** (page
  size 1000) that loops until a short page is returned, guarded by a **50,000-row
  safety ceiling**.
- With the full candidate set loaded, the Saved/Closed filters resolve correctly
  again — no change to the tab/filter logic itself.
- Result: Saved DB rows = **7**; Saved tab = **6 open** items; **1** saved item is
  closed/past-due and remains under **Closed** by existing behavior.

### Fix B — Worker Guardrails

- **Commit:** `3559014`
- **Files:** `bidbox-worker/index.js`, `bidbox-worker/lib/browserbase.js`,
  `bidbox-worker/drivers/planetbids.js`, `bidbox-worker/drivers/planetbids_documents.js`
- Added **`PLANETBIDS_AUTO_DOCUMENT_PREFETCH_ENABLED=false`** kill switch — broad
  PlanetBids scans are now metadata-only; documents are still acquired on demand
  via the user-triggered `project_analysis` (Prepare Intelligence) path.
- Centralized Browserbase session creation with an **in-process concurrency gate**
  (`BROWSERBASE_GLOBAL_CONCURRENCY`) and **429/503 cooldown + retry**
  (`BROWSERBASE_429_COOLDOWN_MS`, `BROWSERBASE_429_MAX_RETRIES`).
- Capped the PlanetBids login-lock wait (`PLANETBIDS_LOCK_MAX_WAIT_ATTEMPTS`,
  default 3 ≈ 1 min, was 15/~5 min) and added a **requeue cooldown**
  (`PLANETBIDS_LOCK_REQUEUE_DELAY_MS`) so a worker cannot hot-loop on the lock.
- Routed incomplete / `Untitled` candidates into the collapsible **Filtered Out**
  section instead of the main feed (kept in the DB — auditable, never deleted).

---

## Production Recovery Steps

1. **Paused** the Railway worker via start-command override: `sleep infinity`.
2. **Forensic read-only DB inspection** confirmed:
   - saved rows still existed (7);
   - My Projects still existed (3);
   - old candidates still existed (667) and were not overwritten;
   - the frontend query cap caused the disappearance.
3. **Frontend Fix A deployed** — `0cf76f1`; Lovable verified frontend live at `3559014`.
4. **Worker Fix B committed** — `3559014`.
5. **Guardrail env vars staged** on Railway:
   ```text
   PLANETBIDS_AUTO_DOCUMENT_PREFETCH_ENABLED=false
   BROWSERBASE_GLOBAL_CONCURRENCY=1
   BROWSERBASE_429_COOLDOWN_MS=30000
   BROWSERBASE_429_MAX_RETRIES=5
   PLANETBIDS_LOCK_MAX_WAIT_ATTEMPTS=3
   PLANETBIDS_LOCK_REQUEUE_DELAY_MS=15000
   PLANETBIDS_LOCK_RETRY_DELAY_MS=20000
   ```
6. **Stale pre-`3559014` backlog cleaned** while Railway was paused (approved,
   scoped `agent_tasks`-only mutation):
   - 40 Chaffey/PlanetBids `document_prefetch` tasks marked `failed`
     (34 pending + 6 zombie `running` rows);
   - 7 stale pending PlanetBids scan tasks marked `failed`.
7. **Railway resumed safely:**
   - active deployment: `72bce980-9834-4712-9fd2-0e914f9cfaa4`
   - commit: `3559014f8997193770007b6d9a1d444548c4cfb0`
   - replicas: 1
   - PID 1: `node` (not `sleep`)
   - logs showed only startup / idle polling; no task claims, no Browserbase 429s,
     no PlanetBids `document_prefetch`, no errors.
8. **Post-resume DB verification:**
   - pending/running queue = 0
   - tasks created after resume = 0
   - failed tasks after resume = 0
   - saved rows = 7
   - Force Main OpenGov candidate still had 0 `opportunity_documents`
   - OpenGov Phase 3 acquisition was not run

---

## Validation Results

- **Fix A:** `tsc --noEmit` clean; `vite build` success; read-only production
  simulation of the paginated fetch loaded **1,440** candidates, with all **7/7**
  saved candidates and **3/3** project-backing candidates present.
- **Fix B:** `node --check` on all changed worker files; module resolution OK;
  `tsc --noEmit` + `vite build` clean for the frontend gating change.
- **Queue cleanup:** guarded script verified exact target counts before writing
  (6 running + 34 pending `document_prefetch`; 7 scans); post-state = queue empty.
- **Post-resume monitor:** 0 non-terminal tasks; 0 created/started/failed after
  resume; 0 Browserbase 429s; saved = 7; Force Main documents = 0; no OpenGov
  Phase 3 task enqueued.

---

## Current Safe State

- Data intact: **1,440** candidates, **7** saved rows, **3** projects — nothing
  deleted or overwritten.
- Frontend live at `3559014` with pagination fix; Saved and old opportunities
  visible again.
- Worker running `3559014` on **1 replica** with guardrail env vars; queue clean
  and idle (next scheduled scan is the nightly cron).
- OpenGov Phase 3 remains **implemented but not production-validated**; Force Main
  has **0** `opportunity_documents`.

---

## Prevention / Future Checklist

```md
Before assuming data loss:
- Check raw DB counts.
- Check saved rows directly.
- Check whether frontend queries are capped/paginated.
- Check whether tab counts are derived client-side from a capped array.
- Compare visible UI counts against backend totals.

Before resuming a paused worker:
- Confirm active commit.
- Confirm queue pending/running counts.
- Cancel stale pre-patch tasks.
- Stage guardrail env vars.
- Resume with 1 replica.
- Watch logs for 10–15 minutes.
- Run DB-side post-resume monitor.

Before enabling broad scans:
- Confirm broad scans do not auto-enqueue document_prefetch unless explicitly intended.
- Confirm Browserbase concurrency limits.
- Confirm 429 backoff.
- Confirm incomplete candidates are hidden or filtered.
```

---

## Related Commits

- `0cf76f1` — Opportunities pagination fix (frontend read-side).
- `3559014` — PlanetBids/`document_prefetch` guardrails and incomplete-candidate filtering.
- `43d463a` — OpenGov Phase 3 document acquisition implementation (**not** production
  validated during this incident).

---

## Related Files

- `src/pages/Opportunities.tsx`
- `bidbox-worker/index.js`
- `bidbox-worker/lib/browserbase.js`
- `bidbox-worker/drivers/planetbids.js`
- `bidbox-worker/drivers/planetbids_documents.js`
- `docs/bug-reports/`
