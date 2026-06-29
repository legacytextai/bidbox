import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Copy, CheckCircle2, Lock } from "lucide-react";
import { Layout } from "@/components/Layout";
import { formatInProjectTimezone } from "@/lib/timezoneUtils";
import { useSubscription } from "@/hooks/useSubscription";
import { getProjectDisplayStatus } from "@/lib/projectStatus";
import { ENFORCE_FREE_PROJECT_LIMIT, FREE_PROJECT_LIMIT } from "@/lib/featureFlags";


interface Project {
  id: string;
  name: string;
  status: string;
  bid_due_at: string;
  public_token: string;
  timezone: string;
  is_ready_to_bid: boolean | null;
  submission_count?: number;
}

function formatBidDateTime(iso: string | null, timezone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return formatInProjectTimezone(d.toISOString(), timezone, "MM/dd/yyyy 'at' h:mm a zzz");
}

function daysUntilBidDue(iso: string | null, timezone: string): { text: string; colorClass: string; bgClass: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due.getTime())) return null;
  const nowYmd = formatInProjectTimezone(new Date().toISOString(), timezone, "yyyy-MM-dd");
  const dueYmd = formatInProjectTimezone(due.toISOString(), timezone, "yyyy-MM-dd");
  const toUTC = (ymd: string) =>
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  const days = Math.round((toUTC(dueYmd) - toUTC(nowYmd)) / 86_400_000);
  if (days < 0) return { text: "Closed", colorClass: "text-muted-foreground", bgClass: "bg-muted" };
  if (days === 0) return { text: "Today", colorClass: "text-red-600", bgClass: "bg-red-50" };
  if (days === 1) return { text: "Tomorrow", colorClass: "text-red-600", bgClass: "bg-red-50" };
  if (days <= 3) return { text: `${days} days`, colorClass: "text-red-600", bgClass: "bg-red-50" };
  if (days <= 7) return { text: `${days} days`, colorClass: "text-amber-500", bgClass: "bg-amber-50" };
  return { text: `${days} days`, colorClass: "text-green-600", bgClass: "bg-green-50" };
}

const Projects = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isSubscribed, loading: subscriptionLoading } = useSubscription();

  // Handle payment success/canceled URL params
  useEffect(() => {
    const payment = searchParams.get("payment");
    if (payment === "success") {
      toast({
        title: "Payment Successful!",
        description: "Thank you for your purchase. Your subscription is now active.",
      });
      setSearchParams({});
    } else if (payment === "canceled") {
      toast({
        title: "Payment Canceled",
        description: "Your payment was canceled. No charges were made.",
        variant: "destructive",
      });
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, toast]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      loadProjects();
    };
    checkAuth();
  }, [navigate]);

  const loadProjects = async () => {
    const { data, error } = await supabase
      .from("projects")
      .select(`
        id,
        name,
        status,
        bid_due_at,
        public_token,
        timezone,
        is_ready_to_bid
      `)
      .order("bid_due_at", { ascending: true });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to load projects",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // Get submission counts for all projects
    const projectsWithCounts = await Promise.all(
      (data || []).map(async (project) => {
        const { data: count } = await supabase.rpc('get_submission_count', {
          p_project_id: project.id
        });
        return {
          ...project,
          submission_count: count || 0
        };
      })
    );

    setProjects(projectsWithCounts);
    setLoading(false);
  };

  const copyBidLink = (token: string, projectId: string) => {
    const link = `${window.location.origin}/bid/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(projectId);
    setTimeout(() => setCopiedId(null), 2000);
    toast({
      title: "Copied!",
      description: "Bid link copied to clipboard",
    });
  };

  const handleNewProject = () => {
    if (ENFORCE_FREE_PROJECT_LIMIT && !isSubscribed && projects.length >= FREE_PROJECT_LIMIT) {
      navigate("/settings");
      return;
    }
    navigate("/projects/new");
  };

  const canCreateProject = isSubscribed || !ENFORCE_FREE_PROJECT_LIMIT || projects.length < FREE_PROJECT_LIMIT;
  const isOverLimit = ENFORCE_FREE_PROJECT_LIMIT && !isSubscribed && projects.length >= FREE_PROJECT_LIMIT;


  return (
    <Layout showSidebar={true}>
      {loading || subscriptionLoading ? (
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      ) : (
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-foreground">My Projects</h1>
            {ENFORCE_FREE_PROJECT_LIMIT && !isSubscribed && (
              <p className="text-sm text-muted-foreground">
                {projects.length}/{FREE_PROJECT_LIMIT} free projects used
              </p>
            )}
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-lg text-foreground">
                      {project.name}
                    </h3>
                    <span
                      className={`inline-block text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded mt-1 ${
                        project.is_ready_to_bid
                          ? "bg-green-500/15 text-green-600"
                          : "bg-red-500/15 text-red-600"
                      }`}
                    >
                      {project.is_ready_to_bid ? "Ready to Submit" : "Not Ready to Submit"}
                    </span>
                  </div>
                  {(() => {
                    const displayStatus = getProjectDisplayStatus(project);
                    return (
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded ${
                          displayStatus.color === 'green'
                            ? "bg-green-500/10 text-green-600"
                            : displayStatus.color === 'red'
                            ? "bg-destructive/10 text-destructive"
                            : "bg-gray-500/10 text-gray-600"
                        }`}
                      >
                        {displayStatus.label}
                      </span>
                    );
                  })()}
                </div>
                
                <p className="text-sm text-muted-foreground mb-2 mt-2">
                  Bid Date: {formatProjectDateTime(project.bid_due_at, { timezone: project.timezone || "America/Los_Angeles" })}
                </p>
                
                <p className="text-sm text-muted-foreground mb-4">
                  Responses: {project.submission_count || 0}
                </p>
                
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyBidLink(project.public_token, project.id);
                    }}
                    className="flex-1"
                  >
                    {copiedId === project.id ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4 mr-2" />
                        Copy Link
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
            
            <div
              onClick={handleNewProject}
              className={`bg-card border-2 border-dashed rounded-lg p-6 transition-all cursor-pointer flex flex-col items-center justify-center min-h-[200px] ${
                canCreateProject
                  ? "border-border hover:border-[hsl(var(--bidbox-blue))] hover:bg-accent/5"
                  : "border-border hover:border-[hsl(var(--bidbox-blue))] hover:bg-accent/5"
              }`}
            >
              {isOverLimit ? (
                <>
                  <Lock className="h-12 w-12 text-[hsl(var(--bidbox-blue))] mb-2" />
                  <p className="text-lg font-semibold text-[hsl(var(--bidbox-blue))]">
                    Upgrade to Add More
                  </p>
                  <p className="text-sm text-[hsl(var(--bidbox-blue))] text-center mt-1">
                    Free plan limited to {FREE_PROJECT_LIMIT} projects
                  </p>
                </>
              ) : (
                <>
                  <Plus className="h-12 w-12 text-[hsl(var(--bidbox-blue))] mb-2" />
                  <p className="text-lg font-semibold text-foreground">New Project</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Projects;
