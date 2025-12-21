-- Add new columns to trade_types table
ALTER TABLE public.trade_types 
ADD COLUMN IF NOT EXISTS parent_code text,
ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS notes text;

-- Add index for parent_code lookups
CREATE INDEX IF NOT EXISTS idx_trade_types_parent_code ON public.trade_types(parent_code);

-- Update existing C-61 record
UPDATE public.trade_types 
SET is_active = true, 
    notes = 'Parent classification for Limited Specialty D-codes'
WHERE code = 'C-61' AND state_code = 'CA';

-- Insert all 29 authoritative D-codes
INSERT INTO public.trade_types (code, name, state_code, category, source, parent_code, is_active, is_default)
VALUES
  ('C-61/D-3', 'Awnings Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-4', 'Central Vacuum Systems Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-6', 'Concrete-Related Services Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-9', 'Drilling, Blasting and Oil Field Work Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-10', 'Elevated Floors Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-12', 'Synthetic Products Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-16', 'Hardware, Locks and Safes Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-21', 'Machinery and Pumps Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-24', 'Metal Products Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-28', 'Doors, Gates and Activating Devices Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-29', 'Paperhanging Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-30', 'Pile Driving and Pressure Foundation Jacking Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-31', 'Pole Installation and Maintenance Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-34', 'Prefabricated Equipment Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-35', 'Pool and Spa Maintenance Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-38', 'Sand and Water Blasting Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-39', 'Scaffolding Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-40', 'Service Station Equipment and Maintenance Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-41', 'Siding and Decking Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-42', 'Non-Electrical Sign Installation Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-49', 'Tree Service Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-50', 'Suspended Ceilings Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-52', 'Window Coverings Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-53', 'Wood Tanks Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-56', 'Trenching Only Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-59', 'Hydroseed Spraying Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-62', 'Air and Water Balancing Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-63', 'Construction Clean-up Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-64', 'Non-specialized Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true),
  ('C-61/D-65', 'Weatherization and Energy Conservation Contractor', 'CA', 'Specialty', 'CSLB', 'C-61', true, true)
ON CONFLICT (id) DO NOTHING;