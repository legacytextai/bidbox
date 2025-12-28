-- Add county column to projects table for regional filtering
ALTER TABLE public.projects 
ADD COLUMN county text;

COMMENT ON COLUMN public.projects.county IS 'California county for regional filtering of network subcontractors';