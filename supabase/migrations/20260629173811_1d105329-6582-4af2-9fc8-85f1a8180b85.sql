ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS projects_pursuit_status_check;

UPDATE public.projects SET pursuit_status = 'reviewing' WHERE pursuit_status IS NULL OR pursuit_status = 'active';
UPDATE public.projects SET pursuit_status = 'passed' WHERE pursuit_status IN ('won','lost','archived');

ALTER TABLE public.projects ALTER COLUMN pursuit_status SET DEFAULT 'reviewing';
ALTER TABLE public.projects ALTER COLUMN pursuit_status SET NOT NULL;

ALTER TABLE public.projects
  ADD CONSTRAINT projects_pursuit_status_check
  CHECK (pursuit_status = ANY (ARRAY['reviewing','pursuing','passed','submitted']));