import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, RefreshCw, ChevronDown, Clock, Loader2, RotateCcw, Sparkles, Building2, Check, Filter } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ActiveScansPanel } from "@/components/ActiveScansPanel";
import { formatProjectDateTime, formatInProjectTimezone } from "@/lib/timezoneUtils";
import {
  OPPORTUNITY_FILTER_REASON_LABELS,
  classifyOpportunityTitle,
} from "@/lib/opportunityRelevance";
import { toZonedTime } from "date-fns-tz";

type CandidateStatus = "pending" | "red" | "yellow" | "green" | "converted";
type AutoStatus = "green" | "yellow" | "red" | null;
type AnalysisStatus = "not_requested" | "queued" | "analyzing" | "ready" | "failed";
type DocumentAcquisitionStatus = "not_requested" | "queued" | "acquiring" | "acquired" | "failed";
type DocumentProcessingStatus = "not_requested" | "queued" | "processing" | "processed" | "partial" | "failed";

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
  document_processing_status: DocumentProcessingStatus;
  document_processing_started_at: string | null;
  document_processing_completed_at: string | null;
  document_processing_error: string | null;
}

const FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Analyzed", value: "analyzed" },
];

const isAnalyzedCandidate = (c: {
  analysis_status: string;
  analysis_task_id?: string | null;
  document_acquisition_status?: string | null;
  document_processing_status?: string | null;
}) =>
  c.analysis_status !== "not_requested" ||
  Boolean(c.analysis_task_id) ||
  Boolean(c.document_acquisition_status && c.document_acquisition_status !== "not_requested") ||
  Boolean(c.document_processing_status && c.document_processing_status !== "not_requested");

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
  queued: "Queued",
  analyzing: "Generating report",
  ready: "Ready",
  failed: "Failed",
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

const DOCUMENT_PROCESSING_STYLES: Record<DocumentProcessingStatus, string> = {
  not_requested: "bg-gray-500/10 text-gray-600",
  queued: "bg-blue-500/10 text-blue-700",
  processing: "bg-indigo-500/10 text-indigo-700",
  processed: "bg-green-500/10 text-green-700",
  partial: "bg-yellow-500/10 text-yellow-700",
  failed: "bg-red-500/10 text-red-700",
};

const DOCUMENT_PROCESSING_LABELS: Record<DocumentProcessingStatus, string> = {
  not_requested: "Documents not processed",
  queued: "Document processing queued",
  processing: "Processing documents",
  processed: "Documents processed",
  partial: "Documents partially processed",
  failed: "Document processing failed",
};

const AUTO_RANK: Record<string, number> = {
  green: 0,
  yellow: 1,
  null: 2,
  red: 3,
};

// Active-state definitions for the realtime safety-net polling fallback.
// Extend these lists as new long-running agent statuses (e.g. F3/F4: processing,
// extracting, chunking, generating) are introduced.
const ACTIVE_DOCUMENT_STATUSES: DocumentAcquisitionStatus[] = ["queued", "acquiring"];
const ACTIVE_DOCUMENT_PROCESSING_STATUSES: DocumentProcessingStatus[] = ["queued", "processing"];
const ACTIVE_ANALYSIS_STATUSES: AnalysisStatus[] = ["queued", "analyzing"];
const POLLING_INTERVAL_MS = 7000;

function formatBidDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return formatInProjectTimezone(
    d.toISOString(),
    "America/Los_Angeles",
    "MM/dd/yyyy 'at' h:mm a zzz"
  );
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

const NO_VALUE_SENTINEL = "__none__";



type BucketKey =
  | "overdue"
  | "today"
  | "this_week"
  | "next_week"
  | "later_this_month"
  | "next_month"
  | "future"
  | "no_date";

const BUCKETS: { key: BucketKey; label: string; defaultOpen: boolean }[] = [
  { key: "overdue", label: "Overdue", defaultOpen: false },
  { key: "today", label: "Due Today", defaultOpen: true },
  { key: "this_week", label: "This Week", defaultOpen: true },
  { key: "next_week", label: "Next Week", defaultOpen: true },
  { key: "later_this_month", label: "Later This Month", defaultOpen: false },
  { key: "next_month", label: "Next Month", defaultOpen: false },
  { key: "future", label: "Future", defaultOpen: false },
  { key: "no_date", label: "No Bid Date", defaultOpen: false },
];

const PT_TZ = "America/Los_Angeles";

function getBucket(iso: string | null): BucketKey {
  if (!iso) return "no_date";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "no_date";
  const nowPt = toZonedTime(new Date(), PT_TZ);
  const duePt = toZonedTime(d, PT_TZ);

  if (duePt.getTime() < nowPt.getTime()) return "overdue";

  const endOfToday = new Date(nowPt);
  endOfToday.setHours(23, 59, 59, 999);
  if (duePt.getTime() <= endOfToday.getTime()) return "today";

  // End of this week = upcoming Sunday 23:59:59 PT
  const endOfThisWeek = new Date(endOfToday);
  const daysUntilSunday = (7 - nowPt.getDay()) % 7; // Sunday = 0
  endOfThisWeek.setDate(endOfThisWeek.getDate() + daysUntilSunday);
  if (duePt.getTime() <= endOfThisWeek.getTime()) return "this_week";

  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);
  if (duePt.getTime() <= endOfNextWeek.getTime()) return "next_week";

  const endOfThisMonth = new Date(
    nowPt.getFullYear(),
    nowPt.getMonth() + 1,
    0,
    23,
    59,
    59,
    999,
  );
  if (duePt.getTime() <= endOfThisMonth.getTime()) return "later_this_month";

  const endOfNextMonth = new Date(
    nowPt.getFullYear(),
    nowPt.getMonth() + 2,
    0,
    23,
    59,
    59,
    999,
  );
  if (duePt.getTime() <= endOfNextMonth.getTime()) return "next_month";

  return "future";
}

function getCandidateCounty(c: { crawl_data: any | null }): string | null {
  const v = c.crawl_data?.county;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function compareByDueAsc(a: Candidate, b: Candidate): number {
  const aDue = a.bid_due_at ? new Date(a.bid_due_at).getTime() : null;
  const bDue = b.bid_due_at ? new Date(b.bid_due_at).getTime() : null;
  if (aDue === null && bDue === null) {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
  if (aDue === null) return 1;
  if (bDue === null) return -1;
  if (aDue !== bDue) return aDue - bDue;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

const Opportunities = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [scanLoading, setScanLoading] = useState(false);
  const [countyFilter, setCountyFilter] = useState<string[]>([]);
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [openBuckets, setOpenBuckets] = useState<Record<BucketKey, boolean>>(
    () =>
      BUCKETS.reduce(
        (acc, b) => ({ ...acc, [b.key]: b.defaultOpen }),
        {} as Record<BucketKey, boolean>,
      ),
  );
  
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
    document_processing_status: (row.document_processing_status ?? "not_requested") as DocumentProcessingStatus,
    document_processing_started_at: row.document_processing_started_at ?? null,
    document_processing_completed_at: row.document_processing_completed_at ?? null,
    document_processing_error: row.document_processing_error ?? null,
  }), []);

  const loadCandidates = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const { data, error } = await supabase
      .from("opportunity_candidates")
      .select("*, opportunity_sources(name, last_scanned_at)")
      .order("created_at", { ascending: false });

    if (error) {
      if (!silent) {
        toast({ title: "Error", description: "Failed to load opportunities", variant: "destructive" });
        setLoading(false);
      }
      return;
    }

    const rows: Candidate[] = (data || []).map(mapRow);

    if (silent) {
      // Diff against previous state for instrumentation; only log when polling
      // actually fixed something Realtime would normally have handled.
      setCandidates((prev) => {
        const prevById = new Map(prev.map((c) => [c.id, c]));
        const changedIds: string[] = [];
        for (const r of rows) {
          const p = prevById.get(r.id);
          if (
            !p ||
            p.document_acquisition_status !== r.document_acquisition_status ||
            p.document_processing_status !== r.document_processing_status ||
            p.analysis_status !== r.analysis_status ||
            p.status !== r.status
          ) {
            changedIds.push(r.id);
          }
        }
        if (changedIds.length > 0) {
          console.info("[opps] polling applied diff", { changedIds });
        }
        return rows;
      });
    } else {
      setCandidates(rows);
    }

    const scannedDates: string[] = (data || [])
      .map((r: any) => r.opportunity_sources?.last_scanned_at)
      .filter(Boolean);
    if (scannedDates.length > 0) {
      setLastScannedAt(scannedDates.sort().reverse()[0]);
    }

    if (!silent) {
      const initialNotes: Record<string, string> = {};
      rows.forEach((r) => { initialNotes[r.id] = r.review_notes ?? ""; });
      setNotes(initialNotes);
      setLoading(false);
    }
  }, [toast, mapRow]);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      loadCandidates();

      // Rehydrate active scan panel if there are non-terminal planetbids_scan
      // tasks still running in the background (survives reloads/navigation).
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: activeTasks } = await supabase
        .from("agent_tasks")
        .select("id, created_at")
        .eq("task_type", "planetbids_scan")
        .in("status", ["pending", "running", "retrying"])
        .gte("created_at", sinceIso);
      if (activeTasks && activeTasks.length > 0) {
        setActiveScanTaskIds(activeTasks.map((t: any) => t.id));
        setScanStartedAt(
          activeTasks
            .map((t: any) => t.created_at)
            .sort()[0],
        );
        setScanActive(true);
      }
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
          console.info("[opps] realtime INSERT", { id: newRow?.id });
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
          console.info("[opps] realtime UPDATE", {
            id: updated?.id,
            doc_status: updated?.document_acquisition_status,
            processing_status: updated?.document_processing_status,
            analysis_status: updated?.analysis_status,
          });
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

  // Realtime safety-net: poll when at least one candidate is in an active
  // (non-terminal) workflow state. Stops automatically when everything is
  // terminal. Keeps Realtime as the primary update mechanism.
  const { hasActiveCandidates, activeCount } = useMemo(() => {
    let count = 0;
    for (const c of candidates) {
      const docActive = ACTIVE_DOCUMENT_STATUSES.includes(c.document_acquisition_status);
      const processingActive = ACTIVE_DOCUMENT_PROCESSING_STATUSES.includes(c.document_processing_status);
      const analysisActive = ACTIVE_ANALYSIS_STATUSES.includes(c.analysis_status);
      if (docActive || processingActive || analysisActive) count += 1;
    }
    return { hasActiveCandidates: count > 0, activeCount: count };
  }, [candidates]);

  const pollInFlightRef = useRef(false);

  useEffect(() => {
    if (!hasActiveCandidates) return;
    const tick = async () => {
      if (document.hidden) return;
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      console.info("[opps] polling refresh", { activeCount });
      try {
        await loadCandidates({ silent: true });
      } finally {
        pollInFlightRef.current = false;
      }
    };
    const intervalId = window.setInterval(tick, POLLING_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveCandidates, activeCount, loadCandidates]);

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

  // Filter by tab: "all" shows everything; "analyzed" shows any opportunity
  // where analysis has been requested, is active, completed, or failed.
  const filtered = useMemo(
    () =>
      candidates.filter((c) =>
        activeFilter === "analyzed" ? isAnalyzedCandidate(c) : true,
      ),
    [candidates, activeFilter],
  );

  // Split candidates into time-bucket sections, sort within each bucket,
  // and separate auto-Red / low-relevance into a Filtered Out section.
  const { buckets, filteredOutCards } = useMemo(() => {
    const isFilteredOut = (candidate: Candidate) =>
      activeFilter === "all" &&
      (candidate.auto_status === "red" ||
        classifyOpportunityTitle(candidate.raw_title).relevance === "low");

    const visible: Candidate[] = [];
    const filteredOut: Candidate[] = [];
    for (const c of filtered) {
      if (isFilteredOut(c)) filteredOut.push(c);
      else visible.push(c);
    }

    const empty: Record<BucketKey, Candidate[]> = {
      overdue: [], today: [], this_week: [], next_week: [],
      later_this_month: [], next_month: [], future: [], no_date: [],
    };
    for (const c of visible) {
      empty[getBucket(c.bid_due_at)].push(c);
    }
    for (const key of Object.keys(empty) as BucketKey[]) {
      empty[key].sort((a, b) => compareCandidates(a, b, sortBy));
    }
    filteredOut.sort((a, b) => compareCandidates(a, b, sortBy));

    return { buckets: empty, filteredOutCards: filteredOut };
  }, [filtered, activeFilter, sortBy]);

  const totalVisible = useMemo(
    () => (Object.values(buckets) as Candidate[][]).reduce((n, arr) => n + arr.length, 0),
    [buckets],
  );

  const renderCard = (candidate: Candidate, index: number) => {
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
    const titleClassification = classifyOpportunityTitle(candidate.raw_title);
    const titleFilterLabel = titleClassification.reason
      ? OPPORTUNITY_FILTER_REASON_LABELS[titleClassification.reason]
      : null;

    return (
    <div
      key={candidate.id}
      className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3"
    >
      {/* Title + external link */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-base text-foreground leading-snug">
            {candidate.raw_title ?? "Untitled Opportunity"}
          </h3>
          {/* Agency — Option D applied universally */}
          {candidate.agency && (
            <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {candidate.agency}
            </p>
          )}
        </div>
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
      {(candidate.portal_type || candidate.status === "converted") && (
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
        </div>
      )}

      {/* Meta */}
      <div className="text-sm text-muted-foreground space-y-0.5">
        <p>Bid Due: {formatBidDate(candidate.bid_due_at)}</p>
        {(() => {
          const ev = formatEstimatedValue(candidate.crawl_data?.estimated_value);
          return ev ? <p>Estimated Value: {ev}</p> : null;
        })()}
        {candidate.source_name && (
          <p className="text-xs">Source: {candidate.source_name}</p>
        )}
      </div>

      {/* Action: View Intelligence Report (after F4) | View Progress | View Project | Analyze Project */}
      {isAnalyzedCandidate(candidate) ? (
        <Button
          size="sm"
          onClick={() => navigate(`/opportunities/${candidate.id}`)}
          className="w-full bg-orange-500 text-white hover:bg-orange-600"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          View Intelligence Report
        </Button>
      ) : candidate.analysis_status !== "not_requested" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/opportunities/${candidate.id}`)}
          className="w-full"
        >
          <Sparkles className="h-4 w-4 mr-2" />
          View Analysis Progress
        </Button>
      ) : candidate.status === "converted" && candidate.converted_project_id ? (
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


            {/* Filter tabs + sort */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <div className="flex gap-2 flex-wrap">
                {FILTERS.map((f) => {
                  const count = f.value === "all"
                    ? candidates.length
                    : candidates.filter(isAnalyzedCandidate).length;
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
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Sort:</span>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                  <SelectTrigger className="w-[220px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
                {totalVisible === 0 && (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    No opportunities match this view.
                  </div>
                )}
                {BUCKETS.map((bucket) => {
                  const items = buckets[bucket.key];
                  if (!items || items.length === 0) return null;
                  const open = openBuckets[bucket.key];
                  return (
                    <Collapsible
                      key={bucket.key}
                      open={open}
                      onOpenChange={(v) =>
                        setOpenBuckets((prev) => ({ ...prev, [bucket.key]: v }))
                      }
                      className="mb-8"
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left group">
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${
                            open ? "rotate-0" : "-rotate-90"
                          }`}
                        />
                        <h2 className="text-base font-semibold text-foreground">
                          {bucket.label}
                        </h2>
                        <span className="text-sm text-muted-foreground">
                          ({items.length})
                        </span>
                        <Separator className="flex-1 ml-3" />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                          {items.map(renderCard)}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}

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
