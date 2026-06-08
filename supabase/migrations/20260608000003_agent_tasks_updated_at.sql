-- Add updated_at to agent_tasks for live scan progress panels.
-- Existing lifecycle timestamps remain authoritative:
-- created_at = queued, started_at = claimed/running, completed_at = complete/failed.

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS update_agent_tasks_updated_at ON public.agent_tasks;

CREATE TRIGGER update_agent_tasks_updated_at
  BEFORE UPDATE ON public.agent_tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();
