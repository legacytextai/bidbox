-- Phase 2: Admin KPI Functions (RPC)

-- Task 2.1: Get total GCs count
CREATE OR REPLACE FUNCTION public.get_total_gcs()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.profiles);
END;
$$;

-- Task 2.2: Get active GCs in last 30 days
CREATE OR REPLACE FUNCTION public.get_active_gcs_30d()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (
    SELECT COUNT(DISTINCT gc_id)::INTEGER
    FROM (
      SELECT gc_id FROM public.projects
      WHERE created_at >= NOW() - INTERVAL '30 days'
      UNION
      SELECT p.gc_id FROM public.projects p
      JOIN public.bids b ON b.project_id = p.id
      WHERE b.submitted_at >= NOW() - INTERVAL '30 days'
    ) AS active_gcs
  );
END;
$$;

-- Task 2.3: Get total projects count
CREATE OR REPLACE FUNCTION public.get_total_projects()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.projects);
END;
$$;

-- Task 2.4: Get average projects per GC
CREATE OR REPLACE FUNCTION public.get_avg_projects_per_gc()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_projects INTEGER;
  total_gcs INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  SELECT COUNT(*) INTO total_gcs FROM public.profiles;
  
  IF total_gcs = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND(total_projects::NUMERIC / total_gcs, 2);
END;
$$;

-- Task 2.5: Get total bids count
CREATE OR REPLACE FUNCTION public.get_total_bids()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COUNT(*)::INTEGER FROM public.bids);
END;
$$;

-- Task 2.6: Get average bids per project
CREATE OR REPLACE FUNCTION public.get_avg_bids_per_project()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_bids INTEGER;
  total_projects INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(*) INTO total_bids FROM public.bids;
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  
  IF total_projects = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND(total_bids::NUMERIC / total_projects, 2);
END;
$$;

-- Task 2.7: Get conversion rate (% of projects with bids)
CREATE OR REPLACE FUNCTION public.get_conversion_rate()
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  projects_with_bids INTEGER;
  total_projects INTEGER;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT COUNT(DISTINCT project_id) INTO projects_with_bids FROM public.bids;
  SELECT COUNT(*) INTO total_projects FROM public.projects;
  
  IF total_projects = 0 THEN
    RETURN 0;
  END IF;
  
  RETURN ROUND((projects_with_bids::NUMERIC / total_projects) * 100, 2);
END;
$$;

-- Task 2.8: Get total bid room views
CREATE OR REPLACE FUNCTION public.get_total_bid_room_views()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  RETURN (SELECT COALESCE(SUM(view_count), 0)::INTEGER FROM public.projects);
END;
$$;

-- Task 2.9: Combined KPI summary (single call for efficiency)
CREATE OR REPLACE FUNCTION public.get_admin_kpi_summary()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN NULL;
  END IF;
  
  SELECT json_build_object(
    'total_gcs', (SELECT COUNT(*) FROM public.profiles),
    'active_gcs_30d', (
      SELECT COUNT(DISTINCT gc_id) FROM (
        SELECT gc_id FROM public.projects WHERE created_at >= NOW() - INTERVAL '30 days'
        UNION
        SELECT p.gc_id FROM public.projects p
        JOIN public.bids b ON b.project_id = p.id
        WHERE b.submitted_at >= NOW() - INTERVAL '30 days'
      ) AS active
    ),
    'total_projects', (SELECT COUNT(*) FROM public.projects),
    'avg_projects_per_gc', COALESCE(
      ROUND((SELECT COUNT(*)::NUMERIC FROM public.projects) / 
            NULLIF((SELECT COUNT(*) FROM public.profiles), 0), 2), 0
    ),
    'total_bids', (SELECT COUNT(*) FROM public.bids),
    'avg_bids_per_project', COALESCE(
      ROUND((SELECT COUNT(*)::NUMERIC FROM public.bids) / 
            NULLIF((SELECT COUNT(*) FROM public.projects), 0), 2), 0
    ),
    'conversion_rate', COALESCE(
      ROUND((SELECT COUNT(DISTINCT project_id)::NUMERIC FROM public.bids) / 
            NULLIF((SELECT COUNT(*) FROM public.projects), 0) * 100, 2), 0
    ),
    'total_views', (SELECT COALESCE(SUM(view_count), 0) FROM public.projects)
  ) INTO result;
  
  RETURN result;
END;
$$;

-- Task 2.10: GC metrics table for admin view
CREATE OR REPLACE FUNCTION public.get_admin_gc_metrics()
RETURNS TABLE (
  id UUID,
  email TEXT,
  company_name TEXT,
  project_count BIGINT,
  bid_count BIGINT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.company_name,
    (SELECT COUNT(*) FROM public.projects pr WHERE pr.gc_id = p.id) AS project_count,
    (SELECT COUNT(*) FROM public.bids b 
     JOIN public.projects pr ON pr.id = b.project_id 
     WHERE pr.gc_id = p.id) AS bid_count,
    p.created_at
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$$;