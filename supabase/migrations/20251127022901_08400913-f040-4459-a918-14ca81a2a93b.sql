-- Allow GCs to delete bids for their projects
CREATE POLICY "GCs can delete bids for their projects"
ON public.bids
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id = bids.project_id
    AND projects.gc_id = auth.uid()
  )
);

-- Allow GCs to delete bid files for their projects
CREATE POLICY "GCs can delete bid files for their projects"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'bid-submissions' AND
  EXISTS (
    SELECT 1 FROM projects
    WHERE projects.id::text = (storage.foldername(name))[1]
    AND projects.gc_id = auth.uid()
  )
);