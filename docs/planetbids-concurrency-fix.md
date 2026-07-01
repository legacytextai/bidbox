# PlanetBids Login Concurrency Fix

## Problem

Multiple Railway worker instances share a single PlanetBids account. When two or more workers simultaneously process `document_prefetch` tasks for PlanetBids candidates, they all log into the same account at the same time. PlanetBids' session model only allows one active session per account — a new login **invalidates** any existing session.

The result is a race condition: every concurrent worker captures a short-lived session token, then all but the last-to-login immediately have their token invalidated. The bearer token capture mechanism (a Playwright `page.on('request', ...)` listener that watches for `Authorization: Bearer` headers on requests to `api-external.prod.planetbids.com`) fires once during login but the captured token is already dead by the time the first API call is made.

**Error surfaced:** `No PlanetBids bearer token captured after login`

**Known affected candidates (June 2026 validation):**
- MWD portal 16151
- Palmdale 23532  
- Norwalk 54783
- San Diego 17950

All three OML validation failures (June 30 2026) were this root cause.

## Mechanism

```
Worker A logs in (session S1)  ──►  Worker B logs in (session S2, invalidates S1)
  │                                     │
  ├── captures token S1 ✓               ├── captures token S2 ✓
  │                                     │
  ├── GET /bids API → 401 (S1 dead) ✗   └── GET /bids API → 200 ✓
  │
  └── "No bearer token captured after login" error
```

## Solution: Cooperative Distributed Lock

A global mutex is stored in the `app_settings` table, which has a `TEXT PRIMARY KEY` constraint. The lock is implemented via a PostgreSQL function that atomically:

1. Deletes any expired lock (TTL-based crash recovery)
2. Attempts to `INSERT` the lock row — if it already exists, `UNIQUE VIOLATION` signals the lock is held

Only one worker may hold the PlanetBids login lock globally at any moment. Workers that fail to acquire the lock retry every 20 seconds for up to 5 minutes before requeueing the task as `pending`.

```
Worker A                         Worker B
  │                                │
  ├── acquire_planetbids_lock()    ├── acquire_planetbids_lock()
  │   → TRUE (acquired)            │   → FALSE (held by A)
  │                                │   Wait 20s...
  ├── login to PlanetBids          │   → FALSE (held by A)
  ├── capture bearer token         │   Wait 20s...
  ├── fetch documents              │   → TRUE (A released it)
  ├── store documents              │
  ├── release_planetbids_lock()    ├── login to PlanetBids
  │                                ├── capture bearer token
  │                                ├── fetch documents
  │                                └── release_planetbids_lock()
```

## Database Schema

**Table:** `public.app_settings`
```sql
key       TEXT PRIMARY KEY
value     JSONB
updated_at TIMESTAMPTZ
```

**Lock key:** `planetbids_login_lock`

**Lock value shape:**
```json
{
  "worker_id": "uuid-of-worker",
  "acquired_at": "2026-07-01T12:00:00Z",
  "expires_at": "2026-07-01T12:10:00Z"
}
```

## PostgreSQL Functions

**Migration:** `supabase/migrations/20260701120000_planetbids_login_lock.sql`

### `acquire_planetbids_lock(p_worker_id TEXT, p_ttl_seconds INTEGER DEFAULT 600) → BOOLEAN`

- Deletes the lock row if its `expires_at` is in the past (crash recovery)
- Inserts a new lock row; catches `unique_violation` and returns `FALSE`
- Returns `TRUE` if this worker now owns the lock

### `release_planetbids_lock(p_worker_id TEXT) → BOOLEAN`

- Deletes the lock row only if it belongs to `p_worker_id`
- Returns `TRUE` if released, `FALSE` if already gone or re-claimed

Both functions are `SECURITY DEFINER` and `GRANT`ed to `service_role` only.

## Worker Code

**File:** `bidbox-worker/index.js`

Constants:
```js
const PLANETBIDS_LOCK_TTL_SECONDS   = 600;   // 10 minutes — covers longest browser session
const PLANETBIDS_LOCK_RETRY_DELAY_MS = 20_000; // 20s between attempts
const PLANETBIDS_LOCK_MAX_RETRIES   = 15;     // 5 minutes total wait
```

`acquirePlanetBidsLock(workerId, log)` — loops calling the DB function, throws `PlanetBidsLockTimeoutError` after exhausting retries.

`releasePlanetBidsLock(workerId, log)` — always called in the `finally` block so the lock is released even on document-processing errors.

Error handling in `processTask`:
- `PlanetBidsLockTimeoutError` resets the task to `pending` (not `failed`) so it will be retried
- Preserves overall pipeline concurrency: non-PlanetBids portals and document processing tasks run freely in parallel

## Deployment Steps

1. **Apply migration** — push `20260701120000_planetbids_login_lock.sql` via Supabase dashboard or `supabase db push`
2. **Deploy worker** — commit `ac7366a` contains the lock code; deploy to Railway by pushing the branch
3. **Requeue failed tasks** — run the cleanup script once after deployment:
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/requeue-failed-prefetch.js
   ```
   Dry-run first: append `--dry-run`. Use `--all` to requeue ALL failed prefetch tasks regardless of error type.

## Validation Plan

After requeuing, confirm:
- All 3 previously-failed candidates now show `document_acquisition_status = 'acquired'` in the dashboard
- Worker logs show `PlanetBids lock acquired` and `PlanetBids lock released` log lines for each task
- No worker shows `No PlanetBids bearer token captured` errors

## Known Limitations

- The lock serializes all PlanetBids logins globally. If many new PlanetBids candidates arrive simultaneously, they queue up. This is intentional — the alternative (concurrent logins) does not work at all.
- TTL = 600s. If a worker dies mid-login while holding the lock, the next worker will wait up to 10 minutes before the TTL clears it. Adjust `PLANETBIDS_LOCK_TTL_SECONDS` if browser sessions routinely run longer.
- Workers that time out after 15 attempts reset their task to `pending` and stop retrying. If the lock is held for > 5 minutes continuously (e.g. a very slow network), tasks will be requeued repeatedly. Monitor for tasks cycling between `pending` and `running` without completing.
