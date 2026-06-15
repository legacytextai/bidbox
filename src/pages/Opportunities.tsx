import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, RefreshCw, ChevronDown, Clock, Loader2, RotateCcw, Sparkles } from "lucide-react";
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
type AnalysisStatus = "not_requested" | "queued" | "analyzing" | "ready" | "failed";
type DocumentAcquisitionStatus = "not_requested" | "queued" | "acquiring" | "acquired" | "failed";

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
  converted_project_id: string | null;
  created_at: string;
  source_name: string | null;
  auto_status: AutoStatus;
  auto_status_reason: string | null;
  qualification_score: number | null;
  qualified_at: string | null;
  crawl_data: any | null;
  analysis_status: AnalysisStatus;
  analysis_task_id: string | null;
  analysis_requested_at: string | null;
  analysis_started_at: string | null;
  analysis_completed_at: string | null;
  analysis_error: string | null;
  document_acquisition_status: DocumentAcquisitionStatus;
  document_acquisition_started_at: string | null;
  document_acquisition_completed_at: string | null;
  document_acquisition_error: string | null;
}

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Converted", value: "converted" },
];

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

const ANALYSIS_STYLES: Record<AnalysisStatus, string> = {
  not_requested: "bg-gray-500/10 text-gray-600",
  queued: "bg-blue-500/10 text-blue-700",
  analyzing: "bg-indigo-500/10 text-indigo-700",
  ready: "bg-green-500/10 text-green-700",
  failed: "bg-red-500/10 text-red-700",
};

const ANALYSIS_LABELS: Record<AnalysisStatus, string> = {
  not_requested: "Not analyzed",
  queued: "Analysis queued",
  analyzing: "Analysis queued",
  ready: "Ready for document processing",
  failed: "Analysis failed",
};

const DOCUMENT_ACQUISITION_STYLES: Record<DocumentAcquisitionStatus, string> = {
  not_requested: "bg-gray-500/10 text-gray-600",
  queued: "bg-blue-500/10 text-blue-700",
  acquiring: "bg-indigo-500/10 text-indigo-700",
  acquired: "bg-green-500/10 text-green-700",
  failed: "bg-red-500/10 text-red-700",
};

const DOCUMENT_ACQUISITION_LABELS: Record<DocumentAcquisitionStatus, string> = {
  not_requested: "Documents not requested",
  queued: "Document acquisition queued",
  acquiring: "Acquiring documents",
  acquired: "Documents acquired",
  failed: "Document acquisition failed",
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

function isBidClosed(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d.getTime()) && d.getTime() < Date.now();
}

const Opportunities = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [scanLoading, setScanLoading] = useState(false);
  
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
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
    converted_project_id: row.converted_project_id,
    created_at: row.created_at,
    source_name: row.opportunity_sources?.name ?? null,
    auto_status: (row.auto_status ?? null) as AutoStatus,
    auto_status_reason: row.auto_status_reason ?? null,
    qualification_score: row.qualification_score ?? null,
    qualified_at: row.qualified_at ?? null,
    crawl_data: row.crawl_data ?? null,
    analysis_status: (row.analysis_status ?? "not_requested") as AnalysisStatus,
    analysis_task_id: row.analysis_task_id ?? null,
    analysis_requested_at: row.analysis_requested_at ?? null,
    analysis_started_at: row.analysis_started_at ?? null,
    analysis_completed_at: row.analysis_completed_at ?? null,
    analysis_error: row.analysis_error ?? null,
    document_acquisition_status: (row.document_acquisition_status ?? "not_requested") as DocumentAcquisitionStatus,
    document_acquisition_started_at: row.document_acquisition_started_at ?? null,
    document_acquisition_completed_at: row.document_acquisition_completed_at ?? null,
    document_acquisition_error: row.document_acquisition_error ?? null,
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

  // Realtime: stream agent_tasks INSERTs into the panel as soon as scan-opportunities queues them
  useEffect(() => {
    if (!scanActive || !scanStartedAt) return;
    const startedMs = new Date(scanStartedAt).getTime();
    const channel = supabase
      .channel(`scan-task-inserts-${startedMs}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_tasks" },
        (payload) => {
          const row: any = payload.new;
          if (row?.task_type !== "planetbids_scan") return;
          const createdMs = new Date(row.created_at).getTime();
          if (createdMs < startedMs - 1000) return;
          setActiveScanTaskIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scanActive, scanStartedAt]);

  const handleScanNow = async () => {
    setScanLoading(true);
    const startedAt = new Date().toISOString();
    setScanStartedAt(startedAt);
    setActiveScanTaskIds([]);
    setScanActive(true);

    try {
      const { data, error } = await supabase.functions.invoke("scan-opportunities");
      if (error) throw error;

      const totalQueued: number = data?.total_queued ?? 0;
      const sourcesScanned: number = data?.sources_scanned ?? 0;

      // Backstop: catch any tasks that the INSERT subscription missed (e.g. before it subscribed)
      if (totalQueued > 0) {
        const { data: queuedTasks } = await supabase
          .from("agent_tasks")
          .select("id")
          .eq("task_type", "planetbids_scan")
          .gte("created_at", startedAt);
        if (queuedTasks && queuedTasks.length > 0) {
          setActiveScanTaskIds((prev) => {
            const merged = new Set(prev);
            queuedTasks.forEach((t: any) => merged.add(t.id));
            return Array.from(merged);
          });
        }
        toast({
          title: "Scan Started",
          description: `${totalQueued} source${totalQueued === 1 ? "" : "s"} queued. Results appear as opportunities are discovered.`,
        });
      } else if (sourcesScanned === 0) {
        toast({
          title: "No sources due",
          description: "All sources were scanned recently. Try again later.",
        });
        setScanActive(false);
      } else {
        toast({
          title: "Scan complete",
          description: `${data?.total_candidates_new ?? 0} new opportunities found.`,
        });
        setScanActive(false);
        await loadCandidates();
      }
    } catch (e: any) {
      toast({ title: "Scan failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      setScanActive(false);
    } finally {
      setScanLoading(false);
    }
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

  const handleAnalyzeProject = async (candidate: Candidate) => {
    setAnalyzingId(candidate.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      const { data, error } = await supabase.functions.invoke("analyze-project", {
        body: { candidate_id: candidate.id },
      });

      if (error) throw error;
      if (data?.success === false) throw new Error(data.error ?? "Failed to queue analysis");

      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                analysis_status: (data?.analysis_status ?? "queued") as AnalysisStatus,
                analysis_task_id: data?.task_id ?? c.analysis_task_id,
                analysis_error: null,
                analysis_requested_at: new Date().toISOString(),
                document_acquisition_status: (data?.document_acquisition_status ?? "queued") as DocumentAcquisitionStatus,
                document_acquisition_error: null,
              }
            : c,
        ),
      );

      toast({
        title: data?.duplicate
          ? data?.document_acquisition_status === "acquired"
            ? "Documents already acquired"
            : "Analysis already queued"
          : "Analysis queued",
        description: data?.document_acquisition_status === "acquired"
          ? "Documents are ready for processing. Project Intelligence has not been generated yet."
          : "Document acquisition queued. Project Intelligence has not been generated yet.",
      });
    } catch (e: any) {
      toast({ title: "Analysis request failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setAnalyzingId(null);
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

  const renderCard = (candidate: Candidate) => {
    const acquisitionActive = candidate.document_acquisition_status === "queued" || candidate.document_acquisition_status === "acquiring";
    const acquisitionComplete = candidate.document_acquisition_status === "acquired";
    const bidClosed = isBidClosed(candidate.bid_due_at);
    const analyzeDisabled = analyzingId === candidate.id || acquisitionActive || acquisitionComplete || bidClosed;
    const analyzeLabel = analyzingId === candidate.id
      ? "Queueing..."
      : candidate.document_acquisition_status === "failed"
      ? "Retry Analysis"
      : candidate.document_acquisition_status === "acquired"
      ? "Documents Acquired"
      : acquisitionActive
      ? candidate.document_acquisition_status === "acquiring" ? "Acquiring Documents" : "Document Acquisition Queued"
      : "Analyze Project";

    return (
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
        {candidate.status === "converted" && (
          <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">
            Converted
          </span>
        )}
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
        {candidate.analysis_status !== "not_requested" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded cursor-help ${ANALYSIS_STYLES[candidate.analysis_status]}`}>
                {candidate.analysis_status === "failed" ? (
                  <RotateCcw className="h-3 w-3" />
                ) : candidate.analysis_status === "analyzing" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                {ANALYSIS_LABELS[candidate.analysis_status]}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                {candidate.analysis_status === "failed"
                  ? candidate.analysis_error ?? "Analysis failed. Retry when ready."
                  : "Project Intelligence has not been generated yet."}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {candidate.document_acquisition_status !== "not_requested" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded cursor-help ${DOCUMENT_ACQUISITION_STYLES[candidate.document_acquisition_status]}`}>
                {candidate.document_acquisition_status === "failed" ? (
                  <RotateCcw className="h-3 w-3" />
                ) : candidate.document_acquisition_status === "acquiring" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                {DOCUMENT_ACQUISITION_LABELS[candidate.document_acquisition_status]}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">
                {candidate.document_acquisition_status === "failed"
                  ? candidate.document_acquisition_error ?? "Document acquisition failed. Retry when ready."
                  : candidate.document_acquisition_status === "acquired"
                  ? "Source documents are stored. Project Intelligence has not been generated yet."
                  : "The worker is preparing source documents. Project Intelligence has not been generated yet."}
              </p>
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

      {/* Analyze Project */}
      {candidate.status === "converted" ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/projects/${candidate.converted_project_id}`)}
        >
          View Project
        </Button>
      ) : (
        <div className="space-y-1.5">
          <Button
            size="sm"
            disabled={analyzeDisabled}
            onClick={() => handleAnalyzeProject(candidate)}
            className="w-full bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90 disabled:opacity-40"
          >
            {analyzingId === candidate.id ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : candidate.document_acquisition_status === "failed" ? (
              <RotateCcw className="h-4 w-4 mr-2" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            {bidClosed ? "Bid Closed" : analyzeLabel}
          </Button>
          {candidate.analysis_status !== "not_requested" && (
            <p className="text-xs text-muted-foreground">
              {candidate.document_acquisition_status === "failed"
                ? "Documents were not acquired. You can retry analysis."
                : candidate.document_acquisition_status === "acquired"
                ? "Documents acquired. Ready for document processing. Project Intelligence not generated yet."
                : "Document acquisition queued. Project Intelligence not generated yet."}
            </p>
          )}
        </div>
      )}
    </div>
    );
  };

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

            {scanActive && (
              <ActiveScansPanel
                taskIds={activeScanTaskIds}
                isQueuing={scanLoading}
                onDismiss={() => {
                  setActiveScanTaskIds([]);
                  setScanActive(false);
                  setScanStartedAt(null);
                }}
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
                    : "No opportunities in this view."}
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
