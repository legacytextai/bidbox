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
      
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, agency, bid_due_at")
        .eq("gc_id", user.id)
        .gte("bid_due_at", new Date().toISOString())
        .order("bid_due_at", { ascending: true });

      if (error) throw error;
      return data as Project[];
    },
    enabled: !!user,
  });

  if (authLoading || isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </Layout>
    );
  }

  const projectCount = projects.length;

  return (
    <Layout>
      <div className="space-y-8">
        {/* Top Metrics Row */}
        <div className="flex justify-center">
          <div className="flex items-center justify-center gap-16 max-w-3xl w-full">
            {/* Projects Scheduled */}
            <div className="text-center">
              <div className="text-5xl font-bold text-foreground">{projectCount}</div>
              <div className="text-sm text-muted-foreground mt-1">Projects Scheduled</div>
            </div>

            {/* Bids Submitted (Placeholder) */}
            <div className="text-center">
              <div className="text-5xl font-bold text-muted-foreground/50">0</div>
              <div className="text-sm text-muted-foreground mt-1">Bids Submitted</div>
            </div>

            {/* Top 3 (Placeholder) */}
            <div className="text-center">
              <div className="text-5xl font-bold text-muted-foreground/50">0</div>
              <div className="text-sm text-muted-foreground mt-1">Top 3</div>
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
