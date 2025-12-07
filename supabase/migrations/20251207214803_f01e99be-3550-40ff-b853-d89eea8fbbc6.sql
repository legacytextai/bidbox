-- Phase 4.0: Subcontractor Directory Schema

-- 1. CSLB Cache Table (for caching license lookups)
CREATE TABLE public.cslb_cache (
  license_number text PRIMARY KEY,
  company_name text,
  license_status text,
  expiration_date date,
  classifications jsonb DEFAULT '[]'::jsonb,
  city text,
  state_code text DEFAULT 'CA',
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 days')
);

-- Enable RLS on cslb_cache
ALTER TABLE public.cslb_cache ENABLE ROW LEVEL SECURITY;

-- Anyone can read cache (for edge functions)
CREATE POLICY "Anyone can read cslb_cache"
ON public.cslb_cache FOR SELECT
USING (true);

-- Service role can manage cache (edge functions use service role)
CREATE POLICY "Service role can manage cslb_cache"
ON public.cslb_cache FOR ALL
USING (true)
WITH CHECK (true);

-- 2. Network Subcontractors Table (BidBox curated pool)
CREATE TABLE public.subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  license_number text,
  license_status text,
  license_expiration date,
  contact_name text,
  email text,
  phone text,
  city text,
  state_code text DEFAULT 'CA',
  is_verified boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

-- Admins can manage network subcontractors
CREATE POLICY "Admins can manage network subcontractors"
ON public.subcontractors FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Anyone can view network subcontractors (for future network pool UI)
CREATE POLICY "Anyone can view network subcontractors"
ON public.subcontractors FOR SELECT
USING (true);

-- 3. Network Subcontractor Trade Mappings (junction table)
CREATE TABLE public.sub_trade_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_id uuid REFERENCES public.subcontractors(id) ON DELETE CASCADE NOT NULL,
  trade_type_id uuid REFERENCES public.trade_types(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sub_id, trade_type_id)
);

-- Enable RLS
ALTER TABLE public.sub_trade_mappings ENABLE ROW LEVEL SECURITY;

-- Admins can manage mappings
CREATE POLICY "Admins can manage sub_trade_mappings"
ON public.sub_trade_mappings FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Anyone can view mappings
CREATE POLICY "Anyone can view sub_trade_mappings"
ON public.sub_trade_mappings FOR SELECT
USING (true);

-- 4. GC Private Subcontractors Table
CREATE TABLE public.gc_subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_id uuid NOT NULL,
  company_name text NOT NULL,
  license_number text,
  license_status text,
  license_expiration date,
  contact_name text,
  email text,
  phone text,
  city text,
  state_code text DEFAULT 'CA',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.gc_subcontractors ENABLE ROW LEVEL SECURITY;

-- GCs can view their own subcontractors
CREATE POLICY "GCs can view own subcontractors"
ON public.gc_subcontractors FOR SELECT
USING (auth.uid() = gc_id);

-- GCs can insert their own subcontractors
CREATE POLICY "GCs can insert own subcontractors"
ON public.gc_subcontractors FOR INSERT
WITH CHECK (auth.uid() = gc_id);

-- GCs can update their own subcontractors
CREATE POLICY "GCs can update own subcontractors"
ON public.gc_subcontractors FOR UPDATE
USING (auth.uid() = gc_id);

-- GCs can delete their own subcontractors
CREATE POLICY "GCs can delete own subcontractors"
ON public.gc_subcontractors FOR DELETE
USING (auth.uid() = gc_id);

-- 5. GC Subcontractor Trade Mappings (junction table)
CREATE TABLE public.gc_sub_trade_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gc_sub_id uuid REFERENCES public.gc_subcontractors(id) ON DELETE CASCADE NOT NULL,
  trade_type_id uuid REFERENCES public.trade_types(id) ON DELETE CASCADE NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(gc_sub_id, trade_type_id)
);

-- Enable RLS
ALTER TABLE public.gc_sub_trade_mappings ENABLE ROW LEVEL SECURITY;

-- GCs can view their own trade mappings
CREATE POLICY "GCs can view own gc_sub_trade_mappings"
ON public.gc_sub_trade_mappings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.gc_subcontractors
    WHERE gc_subcontractors.id = gc_sub_trade_mappings.gc_sub_id
    AND gc_subcontractors.gc_id = auth.uid()
  )
);

-- GCs can insert their own trade mappings
CREATE POLICY "GCs can insert own gc_sub_trade_mappings"
ON public.gc_sub_trade_mappings FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.gc_subcontractors
    WHERE gc_subcontractors.id = gc_sub_trade_mappings.gc_sub_id
    AND gc_subcontractors.gc_id = auth.uid()
  )
);

-- GCs can delete their own trade mappings
CREATE POLICY "GCs can delete own gc_sub_trade_mappings"
ON public.gc_sub_trade_mappings FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.gc_subcontractors
    WHERE gc_subcontractors.id = gc_sub_trade_mappings.gc_sub_id
    AND gc_subcontractors.gc_id = auth.uid()
  )
);

-- Create updated_at triggers for tables that need it
CREATE TRIGGER update_subcontractors_updated_at
  BEFORE UPDATE ON public.subcontractors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_gc_subcontractors_updated_at
  BEFORE UPDATE ON public.gc_subcontractors
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();