import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import CalendarGrid from "@/components/CalendarGrid";

interface Project {
  id: string;
  name: string;
  agency: string | null;
  bid_due_at: string;
  job_walk_at: string | null;
  is_ready_to_bid: boolean;
  pursuit_status: string | null;
}

const CalendarDashboard = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["calendar-projects", user?.id],
    queryFn: async () => {
      if (!user) return [];
      
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, agency, bid_due_at, job_walk_at, is_ready_to_bid, pursuit_status")
        .eq("gc_id", user.id)
        .or(`bid_due_at.gte.${now},job_walk_at.gte.${now}`)
        .order("bid_due_at", { ascending: true });

      if (error) throw error;
      return ((data ?? []) as Project[]).filter((p) => p.pursuit_status !== "passed");
    },
    enabled: !!user,
  });

  if (authLoading || isLoading) {
  return (
    <Layout showSidebar>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </Layout>
    );
  }

  const projectCount = projects.length;
  const readyCount = projects.filter(p => p.is_ready_to_bid).length;

  return (
    <Layout showSidebar>
      <div className="flex flex-col h-[calc(100vh-2rem)] p-4 calendar-container">
        {/* Top Metrics Row */}
        <div className="flex justify-center print:hidden flex-shrink-0 mb-4">
          <div className="flex items-center justify-center gap-6 max-w-4xl w-full">
            {/* Projects Scheduled */}
            <div className="text-center bg-card border border-border rounded-xl px-6 py-4 min-w-[160px]">
              <div className="text-4xl font-bold text-foreground">{projectCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Projects Scheduled</div>
            </div>

            {/* Projects Ready for Bid */}
            <div className="text-center bg-card border border-border rounded-xl px-6 py-4 min-w-[160px]">
              <div className="text-4xl font-bold text-green-600">{readyCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Projects Ready for Bid</div>
            </div>

            {/* Bids Submitted (Placeholder) */}
            <div className="text-center bg-card border border-border rounded-xl px-6 py-4 min-w-[160px] opacity-50">
              <div className="text-4xl font-bold text-muted-foreground">0</div>
              <div className="text-sm text-muted-foreground mt-1">Bids Submitted</div>
            </div>
          </div>
        </div>

        {/* Calendar Grid - fills remaining height */}
        <div className="flex-1 min-h-0">
          <CalendarGrid projects={projects} />
        </div>
      </div>
    </Layout>
  );
};

export default CalendarDashboard;
