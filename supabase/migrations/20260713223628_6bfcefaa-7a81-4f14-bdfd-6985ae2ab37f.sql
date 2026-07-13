-- Durable PlanetBids recovery and asynchronous, versioned qualification jobs.
-- Additive data migration: no opportunity, document, project, or user-owned row
-- is deleted. Existing qualification rows become profile_version 0 and active.

ALTER TABLE public.opportunity_candidates
  ADD COLUMN IF NOT EXISTS recovery_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_last_error_code text,
  ADD COLUMN IF NOT EXISTS recovery_last_error_reason text,
  ADD COLUMN IF NOT EXISTS recovery_exhausted_at timestamptz,
  ADD COLUMN IF NOT EXISTS recovery_last_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS metadata_version text;

CREATE INDEX IF NOT EXISTS idx_opportunity_candidates_recovery_due
  ON public.opportunity_candidates (recovery_next_attempt_at, recovery_attempt_count)
  WHERE ingestion_status = 'quarantined'
    AND recovery_exhausted_at IS NULL
    AND recovery_attempt_count < 3;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('planetbids_recovery_automatic_enabled', '{"enabled":false}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.opportunity_recovery_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_candidate_id uuid NOT NULL REFERENCES public.opportunity_candidates(id) ON DELETE RESTRICT,
  agent_task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  trigger text NOT NULL,
  extraction_source text CHECK (extraction_source IN ('detail_api', 'rendered_page', 'listing_api', 'document', 'manual')),
  before_values jsonb NOT NULL DEFAULT '{}',
  after_values jsonb NOT NULL DEFAULT '{}',
  fields_changed text[] NOT NULL DEFAULT '{}',
  confidence text CHECK (confidence IN ('low', 'medium', 'high', 'authoritative')),
  outcome text NOT NULL CHECK (outcome IN ('recovered', 'partial', 'failed', 'exhausted', 'dry_run')),
  error_code text,
  error_reason text,
  diagnostics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opportunity_recovery_audits_candidate
  ON public.opportunity_recovery_audits (opportunity_candidate_id, created_at DESC);

ALTER TABLE public.opportunity_recovery_audits ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.opportunity_recovery_audits TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_active_planetbids_recovery_candidate
  ON public.agent_tasks ((payload->>'candidate_id'))
  WHERE task_type = 'planetbids_candidate_recovery'
    AND status IN ('pending', 'running', 'retrying')
    AND payload ? 'candidate_id';

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_active_qualification_fanout_candidate
  ON public.agent_tasks ((payload->>'candidate_id'))
  WHERE task_type = 'qualification_candidate_fanout'
    AND status IN ('pending', 'running', 'retrying')
    AND payload ? 'candidate_id';

ALTER TABLE public.gc_qualification_profiles
  ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.qualification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bid_profile_id uuid NOT NULL REFERENCES public.gc_qualification_profiles(id) ON DELETE CASCADE,
  profile_version integer NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed', 'superseded')),
  total_candidates integer NOT NULL DEFAULT 0,
  processed_candidates integer NOT NULL DEFAULT 0,
  green_count integer NOT NULL DEFAULT 0,
  yellow_count integer NOT NULL DEFAULT 0,
  red_count integer NOT NULL DEFAULT 0,
  batch_count integer NOT NULL DEFAULT 0,
  query_time_ms integer,
  evaluation_time_ms integer,
  upsert_time_ms integer,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bid_profile_id, profile_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qualification_jobs_one_active_profile
  ON public.qualification_jobs (bid_profile_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_qualification_jobs_user_created
  ON public.qualification_jobs (user_id, created_at DESC);

ALTER TABLE public.qualification_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own qualification jobs"
  ON public.qualification_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT ON public.qualification_jobs TO authenticated;
GRANT ALL ON public.qualification_jobs TO service_role;

ALTER TABLE public.user_opportunity_qualifications
  ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qualification_job_id uuid REFERENCES public.qualification_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS candidate_metadata_version text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE public.user_opportunity_qualifications
  DROP CONSTRAINT IF EXISTS user_opportunity_qualifications_pkey;
ALTER TABLE public.user_opportunity_qualifications
  ADD CONSTRAINT user_opportunity_qualifications_pkey
  PRIMARY KEY (user_id, opportunity_candidate_id, profile_version);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_opportunity_qualifications_active
  ON public.user_opportunity_qualifications (user_id, opportunity_candidate_id)
  WHERE active;
CREATE INDEX IF NOT EXISTS idx_user_opportunity_qualifications_job
  ON public.user_opportunity_qualifications (qualification_job_id);

CREATE OR REPLACE FUNCTION public.queue_qualification_rebuild(p_bid_profile_id uuid DEFAULT NULL)
RETURNS public.qualification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile public.gc_qualification_profiles;
  v_job public.qualification_jobs;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;

  SELECT * INTO v_profile
  FROM public.gc_qualification_profiles
  WHERE profile_id = v_user_id
    AND (p_bid_profile_id IS NULL OR id = p_bid_profile_id)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'qualification profile not found'; END IF;

  UPDATE public.qualification_jobs
    SET status = 'superseded', completed_at = now(), updated_at = now()
  WHERE bid_profile_id = v_profile.id AND status IN ('queued', 'running');

  UPDATE public.gc_qualification_profiles
    SET profile_version = profile_version + 1, updated_at = now()
  WHERE id = v_profile.id
  RETURNING * INTO v_profile;

  INSERT INTO public.qualification_jobs (user_id, bid_profile_id, profile_version)
  VALUES (v_user_id, v_profile.id, v_profile.profile_version)
  RETURNING * INTO v_job;

  INSERT INTO public.agent_tasks (task_type, status, priority, trigger_reason, payload)
  VALUES ('qualification_rebuild', 'pending', 8, 'bid_profile_saved', jsonb_build_object(
    'qualification_job_id', v_job.id,
    'user_id', v_user_id,
    'bid_profile_id', v_profile.id,
    'profile_version', v_profile.profile_version
  ));
  RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION public.queue_qualification_rebuild(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_qualification_rebuild(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_qualification_job(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_job public.qualification_jobs;
BEGIN
  SELECT * INTO v_job FROM public.qualification_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status <> 'running' THEN RETURN false; END IF;
  IF EXISTS (
    SELECT 1 FROM public.gc_qualification_profiles
    WHERE id = v_job.bid_profile_id AND profile_version <> v_job.profile_version
  ) THEN
    UPDATE public.qualification_jobs SET status='superseded', completed_at=now(), updated_at=now() WHERE id=p_job_id;
    RETURN false;
  END IF;

  UPDATE public.user_opportunity_qualifications SET active=false, updated_at=now()
    WHERE user_id=v_job.user_id AND active;
  UPDATE public.user_opportunity_qualifications SET active=true, updated_at=now()
    WHERE qualification_job_id=p_job_id AND profile_version=v_job.profile_version;
  UPDATE public.qualification_jobs SET status='complete', completed_at=now(), updated_at=now()
    WHERE id=p_job_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_qualification_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_qualification_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.set_opportunity_candidate_metadata_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.metadata_version := md5(concat_ws('|', NEW.raw_title, NEW.agency, NEW.bid_due_at::text,
    NEW.county, NEW.estimated_value::text, NEW.scope_text,
    array_to_string(NEW.required_licenses, ','), array_to_string(NEW.required_naics, ','), NEW.ingestion_status));
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS set_opportunity_candidate_metadata_version ON public.opportunity_candidates;
CREATE TRIGGER set_opportunity_candidate_metadata_version
  BEFORE INSERT OR UPDATE OF raw_title, agency, bid_due_at, county, estimated_value, scope_text,
    required_licenses, required_naics, ingestion_status
  ON public.opportunity_candidates FOR EACH ROW
  EXECUTE FUNCTION public.set_opportunity_candidate_metadata_version();

CREATE OR REPLACE FUNCTION public.queue_candidate_qualification_fanout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.ingestion_status = 'valid' AND
     (TG_OP = 'INSERT' OR OLD.ingestion_status IS DISTINCT FROM NEW.ingestion_status OR OLD.metadata_version IS DISTINCT FROM NEW.metadata_version) THEN
    BEGIN
      INSERT INTO public.agent_tasks (task_type, status, priority, trigger_reason, payload)
      VALUES ('qualification_candidate_fanout', 'pending', 6, 'candidate_metadata_changed',
        jsonb_build_object('candidate_id', NEW.id, 'metadata_version', NEW.metadata_version));
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS queue_candidate_qualification_fanout ON public.opportunity_candidates;
CREATE TRIGGER queue_candidate_qualification_fanout
  AFTER INSERT OR UPDATE OF metadata_version, ingestion_status
  ON public.opportunity_candidates FOR EACH ROW
  EXECUTE FUNCTION public.queue_candidate_qualification_fanout();

COMMENT ON TABLE public.opportunity_recovery_audits IS 'Bounded audit records for candidate-preserving recovery writes; never stores full portal payloads or documents.';
COMMENT ON TABLE public.qualification_jobs IS 'Durable navigation-safe qualification rebuild progress. Only a completed version is activated.';