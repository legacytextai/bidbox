-- Backfill legacy bids with unique submission_ids
UPDATE public.bids 
SET submission_id = gen_random_uuid() 
WHERE submission_id IS NULL;

-- Create function to count unique submissions per project
CREATE OR REPLACE FUNCTION public.get_submission_count(p_project_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(DISTINCT submission_id)::integer
  FROM public.bids
  WHERE project_id = p_project_id;
$$;