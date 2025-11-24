-- 0.3.1: Add public read policy for project-files bucket
CREATE POLICY "Public can download project files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'project-files');

-- 0.3.2: Fix bid-submissions bucket to check project ownership
-- First drop the existing policy if it exists
DROP POLICY IF EXISTS "GCs can view bid submissions for their projects" ON storage.objects;

-- Create new policy with proper project ownership check
CREATE POLICY "GCs can view their own project bid submissions"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'bid-submissions' AND
    EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id::text = (storage.foldername(name))[1]
      AND projects.gc_id = auth.uid()
    )
  );