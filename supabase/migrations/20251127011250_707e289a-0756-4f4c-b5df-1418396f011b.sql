-- Add submission_id column to group files together
ALTER TABLE public.bids 
ADD COLUMN submission_id uuid;

-- Add index for efficient grouping by submission_id
CREATE INDEX idx_bids_submission_id ON public.bids(submission_id);

-- Add comment for documentation
COMMENT ON COLUMN public.bids.submission_id IS 'Groups multiple file uploads into a single bid submission';