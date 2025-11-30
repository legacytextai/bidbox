CREATE OR REPLACE FUNCTION public.get_admin_kpi_summary()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'projects_with_bids', (SELECT COUNT(DISTINCT project_id) FROM public.bids),
    'conversion_rate', COALESCE(
      ROUND((SELECT COUNT(DISTINCT project_id)::NUMERIC FROM public.bids) / 
            NULLIF((SELECT COUNT(*) FROM public.projects), 0) * 100, 2), 0
    ),
    'total_views', (SELECT COALESCE(SUM(view_count), 0) FROM public.projects)
  ) INTO result;
  
  RETURN result;
END;
$function$;