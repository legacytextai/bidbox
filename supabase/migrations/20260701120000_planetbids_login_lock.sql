-- Distributed lock for PlanetBids login sessions.
--
-- Multiple Railway worker instances share a single PlanetBids account.
-- Concurrent logins invalidate each other's session token, causing every
-- concurrent document_prefetch to fail with "No PlanetBids bearer token
-- captured after login."
--
-- These two functions provide a cooperative distributed lock stored in the
-- app_settings table. Only one worker may hold the lock at a time, globally,
-- across all Railway instances.
--
-- Lock key: 'planetbids_login_lock'
-- Value:    { worker_id, acquired_at, expires_at }
-- TTL:      600 seconds (10 minutes) — covers longest realistic browser session
--
-- acquire_planetbids_lock(worker_id, ttl_seconds):
--   Atomically deletes any expired lock then tries to INSERT a new one.
--   Returns TRUE if this worker now owns the lock, FALSE if another worker holds it.
--   The DELETE + INSERT is a single PL/pgSQL block, so it is transaction-scoped
--   and safe against concurrent callers.
--
-- release_planetbids_lock(worker_id):
--   Deletes the lock only if it belongs to this worker.
--   Returns TRUE if the lock was released, FALSE if it was already gone or
--   belonged to a different worker (e.g. expired and re-claimed).

CREATE OR REPLACE FUNCTION public.acquire_planetbids_lock(
  p_worker_id  TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_acquired   BOOLEAN     := FALSE;
BEGIN
  -- Remove any lock that has passed its TTL.
  DELETE FROM public.app_settings
  WHERE key = 'planetbids_login_lock'
    AND (value->>'expires_at')::TIMESTAMPTZ < NOW();

  -- Attempt to insert the lock.  If another worker holds a live lock the
  -- PRIMARY KEY constraint raises unique_violation and we return FALSE.
  BEGIN
    INSERT INTO public.app_settings (key, value, updated_at)
    VALUES (
      'planetbids_login_lock',
      jsonb_build_object(
        'worker_id',   p_worker_id,
        'acquired_at', NOW(),
        'expires_at',  v_expires_at
      ),
      NOW()
    );
    v_acquired := TRUE;
  EXCEPTION WHEN unique_violation THEN
    v_acquired := FALSE;
  END;

  RETURN v_acquired;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_planetbids_lock(
  p_worker_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.app_settings
  WHERE key = 'planetbids_login_lock'
    AND value->>'worker_id' = p_worker_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

-- Grant to service_role only (workers connect with service_role key).
GRANT EXECUTE ON FUNCTION public.acquire_planetbids_lock(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_planetbids_lock(TEXT)          TO service_role;
