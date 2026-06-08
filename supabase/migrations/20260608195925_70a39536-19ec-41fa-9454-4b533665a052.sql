ALTER PUBLICATION supabase_realtime ADD TABLE public.opportunity_candidates;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_tasks;
ALTER TABLE public.opportunity_candidates REPLICA IDENTITY FULL;
ALTER TABLE public.agent_tasks REPLICA IDENTITY FULL;