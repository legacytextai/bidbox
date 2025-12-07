-- ============================================
-- Phase 3.5A: Future-Proof Trade Types Architecture
-- ============================================

-- Task 3.5.0: Create universal trade_types reference table
CREATE TABLE public.trade_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_code text,                    -- "CA", "TX", "FL", null for national
  code text NOT NULL,                 -- "C-10", "E1", "Roofing"
  name text NOT NULL,                 -- "Electrical"
  category text,                      -- "Mechanical", "Civil", etc.
  source text,                        -- "CSLB", "TDLR", "DBPR", "CUSTOM"
  is_default boolean DEFAULT true,    -- Show in default dropdowns
  created_at timestamptz DEFAULT now(),
  UNIQUE(state_code, code)            -- Prevent duplicates per state
);

-- RLS: Everyone can read trade types, only admins can modify
ALTER TABLE public.trade_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view trade types"
  ON public.trade_types FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage trade types"
  ON public.trade_types FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Task 3.5.1: Create project_trades linking table with FK to trade_types
CREATE TABLE public.project_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  trade_type_id uuid REFERENCES public.trade_types(id) NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, trade_type_id)
);

ALTER TABLE public.project_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "GCs can view trades for their projects"
  ON public.project_trades FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_trades.project_id
    AND projects.gc_id = auth.uid()
  ));

CREATE POLICY "GCs can add trades to their projects"
  ON public.project_trades FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_trades.project_id
    AND projects.gc_id = auth.uid()
  ));

CREATE POLICY "GCs can delete trades from their projects"
  ON public.project_trades FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.projects
    WHERE projects.id = project_trades.project_id
    AND projects.gc_id = auth.uid()
  ));

-- Task 3.5.2: Seed California CSLB trade types
INSERT INTO public.trade_types (state_code, code, name, category, source, is_default) VALUES
  ('CA', 'A', 'General Engineering', 'General', 'CSLB', true),
  ('CA', 'B', 'General Building', 'General', 'CSLB', true),
  ('CA', 'C-4', 'Boiler, Hot Water Heating & Steam Fitting', 'Mechanical', 'CSLB', true),
  ('CA', 'C-5', 'Framing and Rough Carpentry', 'Structural', 'CSLB', true),
  ('CA', 'C-6', 'Cabinet, Millwork and Finish Carpentry', 'Finishes', 'CSLB', true),
  ('CA', 'C-7', 'Low Voltage Systems', 'Electrical', 'CSLB', true),
  ('CA', 'C-8', 'Concrete', 'Structural', 'CSLB', true),
  ('CA', 'C-9', 'Drywall', 'Finishes', 'CSLB', true),
  ('CA', 'C-10', 'Electrical', 'Electrical', 'CSLB', true),
  ('CA', 'C-11', 'Elevator', 'Specialty', 'CSLB', true),
  ('CA', 'C-12', 'Earthwork and Paving', 'Civil', 'CSLB', true),
  ('CA', 'C-13', 'Fencing', 'Site Work', 'CSLB', true),
  ('CA', 'C-15', 'Flooring and Floor Covering', 'Finishes', 'CSLB', true),
  ('CA', 'C-16', 'Fire Protection', 'Fire/Life Safety', 'CSLB', true),
  ('CA', 'C-17', 'Glazing', 'Finishes', 'CSLB', true),
  ('CA', 'C-20', 'HVAC', 'Mechanical', 'CSLB', true),
  ('CA', 'C-21', 'Building Moving/Demolition', 'Demolition', 'CSLB', true),
  ('CA', 'C-22', 'Asbestos Abatement', 'Specialty', 'CSLB', true),
  ('CA', 'C-23', 'Ornamental Metal', 'Metals', 'CSLB', true),
  ('CA', 'C-27', 'Landscaping', 'Site Work', 'CSLB', true),
  ('CA', 'C-28', 'Lock and Security Equipment', 'Specialty', 'CSLB', true),
  ('CA', 'C-29', 'Masonry', 'Structural', 'CSLB', true),
  ('CA', 'C-31', 'Construction Zone Traffic Control', 'Site Work', 'CSLB', true),
  ('CA', 'C-32', 'Parking and Highway Improvement', 'Civil', 'CSLB', true),
  ('CA', 'C-33', 'Painting and Decorating', 'Finishes', 'CSLB', true),
  ('CA', 'C-34', 'Pipeline', 'Civil', 'CSLB', true),
  ('CA', 'C-35', 'Lathing and Plastering', 'Finishes', 'CSLB', true),
  ('CA', 'C-36', 'Plumbing', 'Mechanical', 'CSLB', true),
  ('CA', 'C-38', 'Refrigeration', 'Mechanical', 'CSLB', true),
  ('CA', 'C-39', 'Roofing', 'Exterior', 'CSLB', true),
  ('CA', 'C-42', 'Sanitation System', 'Civil', 'CSLB', true),
  ('CA', 'C-43', 'Sheet Metal', 'Mechanical', 'CSLB', true),
  ('CA', 'C-45', 'Electrical Sign', 'Electrical', 'CSLB', true),
  ('CA', 'C-46', 'Solar', 'Electrical', 'CSLB', true),
  ('CA', 'C-47', 'General Manufactured Housing', 'Specialty', 'CSLB', true),
  ('CA', 'C-50', 'Reinforcing Steel', 'Structural', 'CSLB', true),
  ('CA', 'C-51', 'Structural Steel', 'Structural', 'CSLB', true),
  ('CA', 'C-53', 'Swimming Pool', 'Specialty', 'CSLB', true),
  ('CA', 'C-54', 'Ceramic and Mosaic Tile', 'Finishes', 'CSLB', true),
  ('CA', 'C-55', 'Water Conditioning', 'Mechanical', 'CSLB', true),
  ('CA', 'C-57', 'Well Drilling', 'Civil', 'CSLB', true),
  ('CA', 'C-60', 'Welding', 'Metals', 'CSLB', true),
  ('CA', 'C-61', 'Limited Specialty', 'Specialty', 'CSLB', true);