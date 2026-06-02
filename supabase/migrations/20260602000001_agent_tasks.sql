-- agent_tasks: unified queue for all agent job types
-- (discovery scans, document collection, spec extraction, outreach, etc.)

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
