-- Make location and agency optional as per masterplan.md v1 requirements
ALTER TABLE public.projects ALTER COLUMN location DROP NOT NULL;
ALTER TABLE public.projects ALTER COLUMN agency DROP NOT NULL;