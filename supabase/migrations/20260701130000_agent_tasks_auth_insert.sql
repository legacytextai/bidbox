-- Allow authenticated users to queue project_analysis tasks directly.
--
-- Previously only service_role could INSERT into agent_tasks.
-- The "Add to Calendar" flow triggers preparation via force_prepare, which
-- used to call the manage-opportunity-intelligence edge function (service_role).
-- This policy lets the frontend insert the task directly with the user's JWT,
-- eliminating the edge-function round-trip and the deployment dependency.
--
-- Scoped to task_type = 'project_analysis' only.  All other task types still
-- require service_role (workers, edge functions with service key).
CREATE POLICY "Authenticated users can queue project_analysis tasks"
  ON public.agent_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (task_type = 'project_analysis');
