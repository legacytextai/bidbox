-- Add missing columns to subcontractors for CSLB Master License ingestion
ALTER TABLE public.subcontractors 
ADD COLUMN IF NOT EXISTS county text,
ADD COLUMN IF NOT EXISTS last_cslb_update timestamp with time zone;

-- Add unique constraint on license_number for upsert operations
-- First, handle any potential duplicates by keeping the most recently updated one
DELETE FROM public.subcontractors a
USING public.subcontractors b
WHERE a.id > b.id 
  AND a.license_number = b.license_number 
  AND a.license_number IS NOT NULL;

-- Now add the unique constraint
ALTER TABLE public.subcontractors 
ADD CONSTRAINT subcontractors_license_number_key UNIQUE (license_number);

-- Create index for faster lookups during ingestion
CREATE INDEX IF NOT EXISTS idx_subcontractors_license_number 
ON public.subcontractors(license_number);

-- Create index for classification mapping lookups
CREATE INDEX IF NOT EXISTS idx_trade_types_code 
ON public.trade_types(code);