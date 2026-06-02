-- 20260602000001_agent_tasks.sql
CREATE TABLE public.agent_tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type    text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'running', 'complete', 'failed', 'retrying')),
  priority     integer     NOT NULL DEFAULT 0,
  payload      jsonb       NOT NULL DEFAULT '{}',
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  completed_at timestamptz
);

GRANT SELECT ON public.agent_tasks TO authenticated;
GRANT ALL ON public.agent_tasks TO service_role;

CREATE INDEX idx_agent_tasks_status  ON public.agent_tasks(status);
CREATE INDEX idx_agent_tasks_pending ON public.agent_tasks(priority DESC, created_at ASC)
  WHERE status = 'pending';

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read agent tasks"
  ON public.agent_tasks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write agent tasks"
  ON public.agent_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 20260602000002_portal_drivers.sql
CREATE TABLE public.portal_drivers (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  portal_type text        NOT NULL UNIQUE,
  driver_name text        NOT NULL,
  driver_mode text        NOT NULL,
  enabled     boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.portal_drivers TO authenticated;
GRANT ALL ON public.portal_drivers TO service_role;

ALTER TABLE public.portal_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read portal drivers"
  ON public.portal_drivers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write portal drivers"
  ON public.portal_drivers FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.portal_drivers (portal_type, driver_name, driver_mode)
VALUES
  ('planetbids', 'firecrawl_driver', 'firecrawl'),
  ('caltrans',   'firecrawl_driver', 'firecrawl'),
  ('simple_html','firecrawl_driver', 'firecrawl');

-- 20260602000003_agent_run_logs.sql
CREATE TABLE public.agent_run_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  status       text        NOT NULL,
  logs         text,
  screenshots  jsonb,
  artifacts    jsonb,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT SELECT ON public.agent_run_logs TO authenticated;
GRANT ALL ON public.agent_run_logs TO service_role;

CREATE INDEX idx_agent_run_logs_task_id    ON public.agent_run_logs(task_id);
CREATE INDEX idx_agent_run_logs_started_at ON public.agent_run_logs(started_at DESC);

ALTER TABLE public.agent_run_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read agent run logs"
  ON public.agent_run_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write agent run logs"
  ON public.agent_run_logs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);