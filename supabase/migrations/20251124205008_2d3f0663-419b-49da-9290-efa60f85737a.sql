-- Drop the overly permissive RLS policy that exposes all projects
DROP POLICY IF EXISTS "Anyone can view projects by public token" ON public.projects;