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
        .select("id, name, agency, bid_due_at, job_walk_at")
        .eq("gc_id", user.id)
        .or(`bid_due_at.gte.${now},job_walk_at.gte.${now}`)
        .order("bid_due_at", { ascending: true });

      if (error) throw error;
      return data as Project[];
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

  return (
    <Layout showSidebar>
      <div className="space-y-6 p-4">
        {/* Top Metrics Row */}
        <div className="flex justify-center print:hidden">
          <div className="flex items-center justify-center gap-8 max-w-4xl w-full">
            {/* Projects Scheduled */}
            <div className="text-center bg-card border border-border rounded-xl px-8 py-6 min-w-[180px]">
              <div className="text-5xl font-bold text-foreground">{projectCount}</div>
              <div className="text-base text-muted-foreground mt-2">Projects Scheduled</div>
            </div>

            {/* Bids Submitted (Placeholder) */}
            <div className="text-center bg-card border border-border rounded-xl px-8 py-6 min-w-[180px] opacity-50">
              <div className="text-5xl font-bold text-muted-foreground">0</div>
              <div className="text-base text-muted-foreground mt-2">Bids Submitted</div>
            </div>

            {/* Top 3 (Placeholder) */}
            <div className="text-center bg-card border border-border rounded-xl px-8 py-6 min-w-[180px] opacity-50">
              <div className="text-5xl font-bold text-muted-foreground">0</div>
              <div className="text-base text-muted-foreground mt-2">Top 3</div>
            </div>
          </div>
        </div>

        {/* Calendar Grid */}
        <CalendarGrid projects={projects} />
      </div>
    </Layout>
  );
};

export default CalendarDashboard;
