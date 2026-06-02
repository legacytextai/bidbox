-- agent_run_logs: per-run audit trail for agent_tasks executions
-- Stores raw logs, screenshots, and artifact references produced by a worker.

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
