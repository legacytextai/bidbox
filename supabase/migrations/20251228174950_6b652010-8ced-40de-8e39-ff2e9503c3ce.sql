-- Add unique index on license_number for subcontractors (allows NULLs, enforces uniqueness on non-null values)
CREATE UNIQUE INDEX IF NOT EXISTS idx_subcontractors_license_number_unique 
ON public.subcontractors (license_number) 
WHERE license_number IS NOT NULL;

-- Add index on sub_trade_mappings for faster lookups
CREATE INDEX IF NOT EXISTS idx_sub_trade_mappings_sub_id 
ON public.sub_trade_mappings (sub_id);

CREATE INDEX IF NOT EXISTS idx_sub_trade_mappings_trade_type_id 
ON public.sub_trade_mappings (trade_type_id);