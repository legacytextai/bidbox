import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Plus, Copy, CheckCircle2, Lock } from "lucide-react";
import { Layout } from "@/components/Layout";
import { formatInProjectTimezone } from "@/lib/timezoneUtils";
import { useSubscription } from "@/hooks/useSubscription";
import { ENFORCE_FREE_PROJECT_LIMIT, FREE_PROJECT_LIMIT } from "@/lib/featureFlags";
import { resolveEstimatedValue, resolveEstimatedValueRaw } from "@/lib/opportunityDomain";


interface Project {
  id: string;
  name: string;
  status: string;
  bid_due_at: string;
  public_token: string;
  timezone: string;
  is_ready_to_bid: boolean | null;
  pursuit_status: string | null;
  submission_count?: number;
  estimated_value_display?: string | null;
  estimated_value_raw?: number | null;
}


type TabKey = "all" | "live" | "submitted" | "passed";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "submitted", label: "Submitted" },
  { key: "passed", label: "Passed" },
];

function formatBidDateParts(iso: string | null, timezone: string): { date: string; time: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return {
    date: formatInProjectTimezone(d.toISOString(), timezone, "MM/dd/yyyy"),
    time: formatInProjectTimezone(d.toISOString(), timezone, "h:mm a zzz"),
  };
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
  const [activeTab, setActiveTab] = useState<TabKey>("live");

  const filteredProjects = useMemo(() => {
    if (activeTab === "all") return projects;
    if (activeTab === "submitted") return projects.filter((p) => p.pursuit_status === "submitted");
    if (activeTab === "passed") return projects.filter((p) => p.pursuit_status === "passed");
    // live: not past bid date AND not passed
    const now = Date.now();
    return projects.filter((p) => {
      if (p.pursuit_status === "passed") return false;
      if (!p.bid_due_at) return true;
      const t = new Date(p.bid_due_at).getTime();
      return Number.isNaN(t) || t >= now;
    });
  }, [projects, activeTab]);

  const tabSummary = useMemo(() => {
    const count = filteredProjects.length;
    const total = filteredProjects.reduce(
      (sum, p) => sum + (typeof p.estimated_value_raw === "number" ? p.estimated_value_raw : 0),
      0,
    );
    const hasAnyEstimate = filteredProjects.some(
      (p) => typeof p.estimated_value_raw === "number" && p.estimated_value_raw > 0,
    );
    let totalDisplay: string | null = null;
    if (hasAnyEstimate) {
      if (total >= 1_000_000) totalDisplay = `$${(total / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
      else if (total >= 1_000) totalDisplay = `$${Math.round(total / 1_000)}K`;
      else totalDisplay = `$${total.toLocaleString("en-US")}`;
    }
    return { count, totalDisplay };
  }, [filteredProjects]);

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
        is_ready_to_bid,
        pursuit_status,
        source_opportunity_candidate:opportunity_candidates!source_opportunity_candidate_id(estimated_value, crawl_data)
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
      (data || []).map(async (project: any) => {
        const { data: count } = await supabase.rpc('get_submission_count', {
          p_project_id: project.id
        });
        const cand = project.source_opportunity_candidate;
        const estimated_value_display = cand
          ? resolveEstimatedValue(cand.crawl_data, cand.estimated_value)
          : null;
        const estimated_value_raw = cand
          ? resolveEstimatedValueRaw(cand.crawl_data, cand.estimated_value)
          : null;
        return {
          ...project,
          submission_count: count || 0,
          estimated_value_display,
          estimated_value_raw,
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
          <div className="flex items-center justify-between mb-8 gap-4">
            <h1 className="text-3xl font-bold text-foreground">My Projects</h1>
            <div className="flex items-center gap-3">
              {ENFORCE_FREE_PROJECT_LIMIT && !isSubscribed && (
                <p className="text-sm text-muted-foreground">
                  {projects.length}/{FREE_PROJECT_LIMIT} free projects used
                </p>
              )}
              <button
                onClick={handleNewProject}
                className="group inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:text-foreground"
              >
                {isOverLimit ? (
                  <Lock className="h-4 w-4 text-bidbox-blue transition-transform duration-200 group-hover:translate-x-0.5" />
                ) : (
                  <Plus className="h-4 w-4 text-bidbox-blue transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
                New Project
              </button>
            </div>
          </div>

          {/* Tab navigation — identical to OpportunityReport / ProjectWorkspace */}
          <div className="flex border-b border-border mb-8 gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {filteredProjects.length === 0 && (
            <p className="text-sm text-muted-foreground mb-6">No projects in this tab.</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => {
              const tz = project.timezone || "America/Los_Angeles";
              const countdown = daysUntilBidDue(project.bid_due_at, tz);
              return (
              <div
                key={project.id}
                onClick={() => navigate(`/projects/${project.id}`)}
                className="bg-card border border-border rounded-lg p-6 hover:shadow-lg transition-all cursor-pointer flex flex-col min-h-[220px]"
              >
                <div className="flex-1">
                  <div className="flex items-start justify-between mb-2 gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-lg text-foreground break-words">
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
                      const status = project.pursuit_status ?? "";
                      const label = status.charAt(0).toUpperCase() + status.slice(1);
                      const className =
                        status === "pursuing"
                          ? "bg-green-500/10 text-green-600"
                          : status === "passed"
                          ? "bg-destructive/10 text-destructive"
                          : status === "reviewing"
                          ? "bg-gray-500/10 text-gray-600"
                          : status === "submitted"
                          ? "bg-blue-500/10 text-blue-600"
                          : "bg-gray-500/10 text-gray-600";
                      return (
                        <span className={`shrink-0 whitespace-nowrap px-2 py-1 text-xs font-medium rounded ${className}`}>
                          {label || "—"}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Engineer's estimate — matches Opportunities card treatment */}
                {project.estimated_value_display && (
                  <p className="text-2xl font-bold text-foreground leading-none mb-3">
                    {project.estimated_value_display}
                  </p>
                )}


                {/* Bid due + countdown — anchored above CTA */}
                {(() => {
                  const parts = formatBidDateParts(project.bid_due_at, tz);
                  return (
                    <div className="mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm text-foreground font-medium">
                          Bid Due: {parts?.date ?? "—"}
                        </p>
                        {countdown && (
                          <span className={`inline-block whitespace-nowrap text-[10px] font-semibold px-2 py-0.5 rounded-full ${countdown.bgClass} ${countdown.colorClass}`}>
                            {countdown.text}
                          </span>
                        )}
                      </div>
                      {parts?.time && (
                        <p className="text-sm text-muted-foreground">
                          Time: {parts.time}
                        </p>
                      )}
                    </div>
                  );
                })()}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyBidLink(project.public_token, project.id);
                  }}
                  className="w-full"
                >
                  {copiedId === project.id ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Copy Bid Room Link
                    </>
                  )}
                </Button>
              </div>
              );
            })}

          </div>
        </div>
      )}
    </Layout>
  );
};

export default Projects;
