
CREATE TABLE public.landing_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  form_type text NOT NULL CHECK (form_type IN ('guide','trial_request','newsletter')),
  source_path text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.landing_leads TO authenticated;
GRANT INSERT ON public.landing_leads TO anon, authenticated;
GRANT ALL ON public.landing_leads TO service_role;

ALTER TABLE public.landing_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a landing lead"
  ON public.landing_leads FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read all landing leads"
  ON public.landing_leads FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_landing_leads_created_at ON public.landing_leads (created_at DESC);
CREATE INDEX idx_landing_leads_form_type ON public.landing_leads (form_type);
