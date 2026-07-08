
UPDATE public.agent_tasks
SET status='failed', completed_at=now(), updated_at=now(),
    error=COALESCE(NULLIF(error,'') || ' | ','') || 'manual cancel: worker paused, queue cleanup 2026-07-08'
WHERE id IN (
  '0f101041-2451-4994-979e-c8e3326e0f32',
  '04b7a81d-63fe-40aa-9db5-98d046aa1855'
)
   OR (task_type='document_prefetch' AND status='running' AND started_at < now() - interval '30 minutes')
   OR (task_type='document_prefetch' AND status='pending')
   OR (task_type='planetbids_scan' AND status='pending');
