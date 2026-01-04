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

const FREE_PROJECT_LIMIT = 3;

interface Project {
  id: string;
  name: string;
  status: string;
  bid_due_at: string;
  public_token: string;
  timezone: string;
  submission_count?: number;
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
        timezone
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
    if (!isSubscribed && projects.length >= FREE_PROJECT_LIMIT) {
      navigate("/settings");
      return;
    }
    navigate("/projects/new");
  };

  const canCreateProject = isSubscribed || projects.length < FREE_PROJECT_LIMIT;
  const isOverLimit = !isSubscribed && projects.length >= FREE_PROJECT_LIMIT;

  return (
    <Layout showSidebar={true}>
      {loading || subscriptionLoading ? (
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <p className="text-muted-foreground">Loading projects...</p>
        </div>
      ) : (
        <div className="p-8">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-foreground">Projects</h1>
            {!isSubscribed && (
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
                <div className="flex items-start justify-between mb-4">
                  <h3 className="font-semibold text-lg text-foreground">
                    {project.name}
                  </h3>
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
                
                <p className="text-sm text-muted-foreground mb-2">
                  Bid Date: {formatInProjectTimezone(project.bid_due_at, project.timezone || "America/Los_Angeles", "MMM d, yyyy h:mm a zzz")}
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
