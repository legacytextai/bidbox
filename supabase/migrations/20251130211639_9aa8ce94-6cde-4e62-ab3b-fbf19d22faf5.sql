-- Create RPC function to increment view count for a project
-- This is a public function (no admin check) since it's called from the public bid room
CREATE OR REPLACE FUNCTION public.increment_view_count(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.projects
  SET view_count = view_count + 1
  WHERE id = p_project_id;
END;
$$;