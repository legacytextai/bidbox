import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface KPISummary {
  total_gcs: number;
  active_gcs_30d: number;
  total_projects: number;
  avg_projects_per_gc: number;
  total_bids: number;
  avg_bids_per_project: number;
  conversion_rate: number;
  total_views: number;
}

export interface GCMetric {
  id: string;
  email: string;
  company_name: string | null;
  project_count: number;
  bid_count: number;
  created_at: string;
}

export function useAdminKPIs() {
  const { user } = useAuth();

  // Check if user is admin
  const { data: isAdmin, isLoading: isCheckingAdmin } = useQuery({
    queryKey: ["admin-check", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (error) {
        console.error("Error checking admin role:", error);
        return false;
      }
      return data === true;
    },
    enabled: !!user?.id,
  });

  // Fetch KPI summary
  const {
    data: kpiSummary,
    isLoading: isLoadingKPIs,
    error: kpiError,
    refetch: refetchKPIs,
  } = useQuery({
    queryKey: ["admin-kpi-summary"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_kpi_summary");
      if (error) throw error;
      return data as unknown as KPISummary;
    },
    enabled: isAdmin === true,
  });

  // Fetch GC metrics
  const {
    data: gcMetrics,
    isLoading: isLoadingGCMetrics,
    error: gcMetricsError,
    refetch: refetchGCMetrics,
  } = useQuery({
    queryKey: ["admin-gc-metrics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_admin_gc_metrics");
      if (error) throw error;
      return data as unknown as GCMetric[];
    },
    enabled: isAdmin === true,
  });

  return {
    isAdmin,
    isCheckingAdmin,
    kpiSummary,
    isLoadingKPIs,
    kpiError,
    gcMetrics,
    isLoadingGCMetrics,
    gcMetricsError,
    refetch: () => {
      refetchKPIs();
      refetchGCMetrics();
    },
  };
}
