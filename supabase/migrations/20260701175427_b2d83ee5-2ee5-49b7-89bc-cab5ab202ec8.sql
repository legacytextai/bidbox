-- 1. PlanetBids login lock functions
CREATE OR REPLACE FUNCTION public.acquire_planetbids_lock(
  p_worker_id  TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires_at TIMESTAMPTZ := NOW() + (p_ttl_seconds || ' seconds')::INTERVAL;
  v_acquired   BOOLEAN     := FALSE;
BEGIN
  DELETE FROM public.app_settings
  WHERE key = 'planetbids_login_lock'
    AND (value->>'expires_at')::TIMESTAMPTZ < NOW();

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
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.acquire_planetbids_lock(TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_planetbids_lock(TEXT)          TO service_role;

-- 2. RLS INSERT policy for authenticated users on agent_tasks
CREATE POLICY "Authenticated users can queue project_analysis tasks"
  ON public.agent_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (task_type = 'project_analysis');

-- 3. Storage SELECT policy for opportunity-documents bucket
CREATE POLICY "Authenticated users can download opportunity documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'opportunity-documents');
