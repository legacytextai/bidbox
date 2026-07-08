
UPDATE public.agent_tasks
SET status='failed', completed_at=now(), updated_at=now(),
    error=COALESCE(NULLIF(error,'') || ' | ','') || 'manual cancel: worker paused, final queue cleanup'
WHERE task_type='document_prefetch' AND status='running';
