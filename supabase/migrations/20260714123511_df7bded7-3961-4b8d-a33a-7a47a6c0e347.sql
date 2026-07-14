CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_active_caleprocure_title_recovery
  ON public.agent_tasks ((payload->>'candidate_id'))
  WHERE task_type = 'caleprocure_title_recovery'
    AND status IN ('pending', 'running', 'retrying')
    AND payload ? 'candidate_id';