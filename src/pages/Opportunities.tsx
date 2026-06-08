import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, RefreshCw, ChevronDown } from "lucide-react";
import { Layout } from "@/components/Layout";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ActiveScansPanel } from "@/components/ActiveScansPanel";

type CandidateStatus = "pending" | "red" | "yellow" | "green" | "converted";
type AutoStatus = "green" | "yellow" | "red" | null;

interface Candidate {
  id: string;
  source_url: string;
  portal_type: string | null;
  raw_title: string | null;
  agency: string | null;
  bid_due_at: string | null;
  scope_text: string | null;
  status: CandidateStatus;
  review_notes: string | null;
  reviewed_at: string | null;
  converted_project_id: string | null;
  created_at: string;
  source_name: string | null;
  auto_status: AutoStatus;
  auto_status_reason: string | null;
  qualification_score: number | null;
  qualified_at: string | null;
  crawl_data: any | null;
}

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Yes", value: "green" },
  { label: "Maybe", value: "yellow" },
  { label: "No", value: "red" },
  { label: "Converted", value: "converted" },
];

const STATUS_STYLES: Record<CandidateStatus, string> = {
  pending: "bg-gray-500/10 text-gray-600",
  red: "bg-red-500/10 text-red-600",
  yellow: "bg-yellow-500/10 text-yellow-700",
  green: "bg-green-500/10 text-green-600",
  converted: "bg-blue-500/10 text-blue-600",
};

const PORTAL_STYLES: Record<string, string> = {
  caltrans: "bg-blue-500/10 text-blue-700",
  planetbids: "bg-purple-500/10 text-purple-700",
  epro: "bg-teal-500/10 text-teal-700",
  ersp: "bg-orange-500/10 text-orange-700",
  bonfirehub: "bg-pink-500/10 text-pink-700",
  ramp: "bg-indigo-500/10 text-indigo-700",
};

const AUTO_STATUS_DOT: Record<NonNullable<AutoStatus>, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
};

const AUTO_RANK: Record<string, number> = {
  green: 0,
  yellow: 1,
  null: 2,
  red: 3,
};

function formatBidDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatEstimatedValue(value: number | null | undefined): string | null {
  if (typeof value !== "number" || value <= 0) return null;
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${value.toLocaleString("en-US")}`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const Opportunities = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [scanLoading, setScanLoading] = useState(false);
  
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [filteredOutOpen, setFilteredOutOpen] = useState(false);
  const [activeScanTaskIds, setActiveScanTaskIds] = useState<string[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const mapRow = useCallback((row: any): Candidate => ({
    id: row.id,
    source_url: row.source_url,
    portal_type: row.portal_type,
    raw_title: row.raw_title,
    agency: row.agency,
    bid_due_at: row.bid_due_at,
    scope_text: row.scope_text,
    status: row.status as CandidateStatus,
    review_notes: row.review_notes,
    reviewed_at: row.reviewed_at,
    converted_project_id: row.converted_project_id,
    created_at: row.created_at,
    source_name: row.opportunity_sources?.name ?? null,
    auto_status: (row.auto_status ?? null) as AutoStatus,
    auto_status_reason: row.auto_status_reason ?? null,
    qualification_score: row.qualification_score ?? null,
    qualified_at: row.qualified_at ?? null,
    crawl_data: row.crawl_data ?? null,
  }), []);

  const loadCandidates = useCallback(async () => {
    const { data, error } = await supabase
      .from("opportunity_candidates")
      .select("*, opportunity_sources(name, last_scanned_at)")
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Error", description: "Failed to load opportunities", variant: "destructive" });
      setLoading(false);
      return;
    }

    const rows: Candidate[] = (data || []).map(mapRow);

    setCandidates(rows);

    const scannedDates: string[] = (data || [])
      .map((r: any) => r.opportunity_sources?.last_scanned_at)
      .filter(Boolean);
    if (scannedDates.length > 0) {
      setLastScannedAt(scannedDates.sort().reverse()[0]);
    }

    const initialNotes: Record<string, string> = {};
    rows.forEach((r) => { initialNotes[r.id] = r.review_notes ?? ""; });
    setNotes(initialNotes);
    setLoading(false);
  }, [toast, mapRow]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      loadCandidates();
    };
    checkAuth();
  }, [navigate, loadCandidates]);

  // Realtime: opportunity_candidates INSERT/UPDATE
  useEffect(() => {
    const channel = supabase
      .channel("opportunity-candidates-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "opportunity_candidates" },
        async (payload) => {
          const newRow: any = payload.new;
          // Fetch joined source name
          const { data: src } = await supabase
            .from("opportunity_sources")
            .select("name, last_scanned_at")
            .eq("id", newRow.source_id)
            .maybeSingle();
          const mapped = mapRow({ ...newRow, opportunity_sources: src ?? null });
          setCandidates((prev) =>
            prev.some((c) => c.id === mapped.id) ? prev : [mapped, ...prev],
          );
          if (src?.last_scanned_at) setLastScannedAt(src.last_scanned_at);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "opportunity_candidates" },
        (payload) => {
          const updated: any = payload.new;
          setCandidates((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? mapRow({ ...updated, opportunity_sources: { name: c.source_name } })
                : c,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mapRow]);

  const handleScanNow = async () => {
    setScanLoading(true);
    const scanStartedAt = new Date().toISOString();
    try {
      const { data, error } = await supabase.functions.invoke("scan-opportunities");
      if (error) throw error;

      const totalQueued: number = data?.total_queued ?? 0;
      const sourcesScanned: number = data?.sources_scanned ?? 0;

      // Look up newly-queued PlanetBids task IDs by timestamp (temporary; see plan)
      if (totalQueued > 0) {
        const { data: queuedTasks } = await supabase
          .from("agent_tasks")
          .select("id")
          .eq("task_type", "planetbids_scan")
          .gte("created_at", scanStartedAt);
        if (queuedTasks && queuedTasks.length > 0) {
          setActiveScanTaskIds(queuedTasks.map((t: any) => t.id));
        }
      }

      if (totalQueued > 0) {
        toast({
          title: "Scan Started",
          description: `${totalQueued} source${totalQueued === 1 ? "" : "s"} queued for scanning. Results will appear automatically as opportunities are discovered.`,
        });
      } else if (sourcesScanned === 0) {
        toast({
          title: "No sources due",
          description: "All sources were scanned recently. Try again later.",
        });
      } else {
        toast({
          title: "Scan complete",
          description: `${data?.total_candidates_new ?? 0} new opportunities found.`,
        });
        await loadCandidates();
      }
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setScanLoading(false);
    }
  };




  const handleStatusChange = async (id: string, newStatus: CandidateStatus) => {
    const { data: { session } } = await supabase.auth.getSession();
    const { error } = await supabase
      .from("opportunity_candidates")
      .update({
        status: newStatus,
        reviewed_by: session?.user.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      toast({ title: "Error", description: "Failed to update status", variant: "destructive" });
      return;
    }
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: newStatus } : c))
    );
  };

  const handleNotesSave = async (id: string) => {
    const note = notes[id] ?? "";
    const { error } = await supabase
      .from("opportunity_candidates")
      .update({ review_notes: note || null })
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: "Failed to save notes", variant: "destructive" });
    }
  };

  const handleConvert = async (candidate: Candidate) => {
    setConvertingId(candidate.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      const bidDueAt = candidate.bid_due_at
        ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const { data: newProject, error: insertError } = await supabase
        .from("projects")
        .insert({
          gc_id: session.user.id,
          name: candidate.raw_title ?? `Project from ${candidate.source_url}`,
          source_url: candidate.source_url,
          bid_due_at: bidDueAt,
          status: "LIVE",
          portal_type: candidate.portal_type ?? undefined,
          agency: candidate.agency ?? undefined,
          scope_text: candidate.scope_text ?? undefined,
        })
        .select("id")
        .single();

      if (insertError || !newProject) throw insertError ?? new Error("Insert returned no data");

      supabase.functions.invoke("crawl-project", {
        body: { project_id: newProject.id, source_url: candidate.source_url },
      });

      await supabase
        .from("opportunity_candidates")
        .update({ status: "converted", converted_project_id: newProject.id })
        .eq("id", candidate.id);

      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id
            ? { ...c, status: "converted", converted_project_id: newProject.id }
            : c
        )
      );

      toast({
        title: "Project created",
        description: "Crawling details in the background — check the project shortly.",
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/projects/${newProject.id}`)}
          >
            View Project
          </Button>
        ) as any,
      });
    } catch (e: any) {
      toast({ title: "Conversion failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setConvertingId(null);
    }
  };

  // Filter by manual status (filter tabs unchanged)
  const filtered = useMemo(
    () => candidates.filter((c) => (activeFilter === "all" ? true : c.status === activeFilter)),
    [candidates, activeFilter]
  );

  // For "All" view: sort by auto_status (green→yellow→null→red), keep created_at DESC within bucket,
  // and split out auto-Red into a "Filtered Out" section.
  const { visibleCards, filteredOutCards } = useMemo(() => {
    if (activeFilter !== "all") {
      return { visibleCards: filtered, filteredOutCards: [] as Candidate[] };
    }
    const sorted = [...filtered].sort((a, b) => {
      const ra = AUTO_RANK[String(a.auto_status)] ?? 2;
      const rb = AUTO_RANK[String(b.auto_status)] ?? 2;
      if (ra !== rb) return ra - rb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return {
      visibleCards: sorted.filter((c) => c.auto_status !== "red"),
      filteredOutCards: sorted.filter((c) => c.auto_status === "red"),
    };
  }, [filtered, activeFilter]);

  const renderCard = (candidate: Candidate) => (
    <div
      key={candidate.id}
      className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
    >
      {/* Title + external link */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-base text-foreground leading-snug">
          {candidate.raw_title ?? "Untitled Opportunity"}
        </h3>
        <a
          href={candidate.source_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title="Open source page"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        {candidate.portal_type && (
          <span
            className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
              PORTAL_STYLES[candidate.portal_type] ?? "bg-gray-500/10 text-gray-600"
            }`}
          >
            {candidate.portal_type}
          </span>
        )}
        <span
          className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLES[candidate.status]}`}
        >
          {candidate.status}
        </span>
        {candidate.auto_status && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border border-border bg-background text-muted-foreground cursor-help">
                <span className={`h-1.5 w-1.5 rounded-full ${AUTO_STATUS_DOT[candidate.auto_status]}`} />
                System: {candidate.auto_status}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                {candidate.auto_status_reason ?? "No reason provided"}
              </p>
              {candidate.qualification_score !== null && (
                <p className="text-xs text-muted-foreground mt-1">
                  Score: {candidate.qualification_score}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Meta */}
      <div className="text-sm text-muted-foreground space-y-0.5">
        {candidate.agency && <p>{candidate.agency}</p>}
        <p>Bid Due: {formatBidDate(candidate.bid_due_at)}</p>
        {(() => {
          const ev = formatEstimatedValue(candidate.crawl_data?.estimated_value);
          return ev ? <p>Estimated Value: {ev}</p> : null;
        })()}
        {candidate.source_name && (
          <p className="text-xs">Source: {candidate.source_name}</p>
        )}
      </div>

      {/* Status selector */}
      {candidate.status !== "converted" && (
        <div className="flex gap-1">
          {(["red", "yellow", "green"] as CandidateStatus[]).map((s) => {
            const label = s === "red" ? "No" : s === "yellow" ? "Maybe" : "Yes";
            return (
            <button
              key={s}
              onClick={() => handleStatusChange(candidate.id, s)}
              className={`flex-1 py-1 rounded text-xs font-semibold transition-colors border ${
                candidate.status === s
                  ? s === "red"
                    ? "bg-red-500 text-white border-red-500"
                    : s === "yellow"
                    ? "bg-yellow-400 text-yellow-900 border-yellow-400"
                    : "bg-green-500 text-white border-green-500"
                  : "bg-transparent text-muted-foreground border-border hover:bg-accent"
              }`}
            >
              {label}
            </button>
            );
          })}

        </div>
      )}

      {/* Notes */}
      {candidate.status !== "converted" && (
        <input
          type="text"
          value={notes[candidate.id] ?? ""}
          onChange={(e) =>
            setNotes((prev) => ({ ...prev, [candidate.id]: e.target.value }))
          }
          onBlur={() => handleNotesSave(candidate.id)}
          placeholder="Add review notes..."
          className="w-full text-sm bg-muted/50 border border-border rounded px-2 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[hsl(var(--bidbox-blue))]"
        />
      )}

      {/* Convert to Project */}
      {candidate.status === "converted" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/projects/${candidate.converted_project_id}`)}
        >
          View Project
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={convertingId === candidate.id}
          onClick={() => handleConvert(candidate)}
          className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90 disabled:opacity-40"
        >
          {convertingId === candidate.id ? "Converting..." : "Convert to Project"}
        </Button>
      )}
    </div>
  );

  return (
    <Layout showSidebar={true}>
      <TooltipProvider delayDuration={150}>
        {loading ? (
          <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
            <p className="text-muted-foreground">Loading opportunities...</p>
          </div>
        ) : (
          <div className="p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Opportunities</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Last scanned: {timeAgo(lastScannedAt)}
                </p>
              </div>
              <div className="flex gap-2">

                <Button
                  onClick={handleScanNow}
                  disabled={scanLoading}
                  className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${scanLoading ? "animate-spin" : ""}`} />
                  {scanLoading ? "Scanning..." : "Scan Now"}
                </Button>
              </div>
            </div>

            {activeScanTaskIds.length > 0 && (
              <ActiveScansPanel
                taskIds={activeScanTaskIds}
                onDismiss={() => setActiveScanTaskIds([])}
              />
            )}

            {/* Filter tabs */}
            <div className="flex gap-2 mb-6 flex-wrap">
              {FILTERS.map((f) => {
                const count = f.value === "all"
                  ? candidates.length
                  : candidates.filter((c) => c.status === f.value).length;
                return (
                  <button
                    key={f.value}
                    onClick={() => setActiveFilter(f.value)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activeFilter === f.value
                        ? "bg-[hsl(var(--bidbox-blue))] text-white"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {f.label} <span className="ml-1 opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Cards */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-lg font-medium text-foreground mb-2">No opportunities found</p>
                <p className="text-sm text-muted-foreground mb-6">
                  {activeFilter === "all"
                    ? "Click Scan Now to discover new bids from Caltrans and PlanetBids."
                    : `No candidates with status "${activeFilter}".`}
                </p>
                {activeFilter === "all" && (
                  <Button
                    onClick={handleScanNow}
                    disabled={scanLoading}
                    className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${scanLoading ? "animate-spin" : ""}`} />
                    {scanLoading ? "Scanning..." : "Scan Now"}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {visibleCards.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {visibleCards.map(renderCard)}
                  </div>
                )}

                {activeFilter === "all" && filteredOutCards.length > 0 && (
                  <Collapsible
                    open={filteredOutOpen}
                    onOpenChange={setFilteredOutOpen}
                    className="mt-10"
                  >
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${filteredOutOpen ? "rotate-0" : "-rotate-90"}`}
                      />
                      Filtered Out ({filteredOutCards.length})
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-70">
                        {filteredOutCards.map(renderCard)}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </>
            )}
          </div>
        )}
      </TooltipProvider>
    </Layout>
  );
};

export default Opportunities;
