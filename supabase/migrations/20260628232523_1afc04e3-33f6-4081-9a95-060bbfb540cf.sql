CREATE TABLE public.project_readiness_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  key text NOT NULL,
  derived_status text NOT NULL DEFAULT 'unknown' CHECK (derived_status IN ('unknown','detected','missing','conflicting')),
  manual_status text NOT NULL DEFAULT 'unset' CHECK (manual_status IN ('unset','needs_review','confirmed')),
  derived_source jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, key)
);

CREATE INDEX project_readiness_items_project_id_idx ON public.project_readiness_items(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_readiness_items TO authenticated;
GRANT ALL ON public.project_readiness_items TO service_role;

ALTER TABLE public.project_readiness_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "GCs can view own project readiness items"
ON public.project_readiness_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_readiness_items.project_id AND p.gc_id = auth.uid()));

CREATE POLICY "GCs can insert own project readiness items"
ON public.project_readiness_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_readiness_items.project_id AND p.gc_id = auth.uid()));

CREATE POLICY "GCs can update own project readiness items"
ON public.project_readiness_items FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_readiness_items.project_id AND p.gc_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_readiness_items.project_id AND p.gc_id = auth.uid()));

CREATE POLICY "GCs can delete own project readiness items"
ON public.project_readiness_items FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_readiness_items.project_id AND p.gc_id = auth.uid()));

CREATE TRIGGER project_readiness_items_set_updated_at
BEFORE UPDATE ON public.project_readiness_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();