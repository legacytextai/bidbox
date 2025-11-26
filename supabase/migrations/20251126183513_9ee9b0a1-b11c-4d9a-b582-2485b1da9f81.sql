-- Add timezone column to projects table
ALTER TABLE public.projects 
ADD COLUMN timezone text DEFAULT 'America/Los_Angeles';

-- Backfill existing projects with PST
UPDATE public.projects 
SET timezone = 'America/Los_Angeles' 
WHERE timezone IS NULL;