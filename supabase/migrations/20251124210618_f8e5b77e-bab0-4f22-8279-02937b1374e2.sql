-- Drop the overly permissive RLS policy that exposes all project file metadata
DROP POLICY IF EXISTS "Anyone can view project files" ON public.project_files;