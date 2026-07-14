-- Cal eProcure title recovery: prevent duplicate active recovery tasks for
-- the same candidate. Mirrors idx_agent_tasks_active_planetbids_recovery_candidate
-- (migration 20260713233000). Additive only — no table or column changes; the
-- recovery driver reuses the existing recovery_* columns on
-- opportunity_candidates and the opportunity_recovery_audits table.

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_active_caleprocure_title_recovery
  ON public.agent_tasks ((payload->>'candidate_id'))
  WHERE task_type = 'caleprocure_title_recovery'
    AND status IN ('pending', 'running', 'retrying')
    AND payload ? 'candidate_id';
