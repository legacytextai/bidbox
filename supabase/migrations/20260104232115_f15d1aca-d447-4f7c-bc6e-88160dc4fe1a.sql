-- Add optional job_walk_at column to projects table
ALTER TABLE public.projects
ADD COLUMN job_walk_at timestamptz DEFAULT NULL;