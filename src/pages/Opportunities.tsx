import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2, ExternalLink, RefreshCw, ChevronDown, Loader2, Check, Filter, RotateCcw, Sparkles, CalendarCheck2 } from "lucide-react";
import { PORTAL_STYLES, resolveOIStatus, isOIReady, isOIActive, resolveEstimatedValue } from "@/lib/opportunityDomain";
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
  opportunity_lifecycle_status?: string | null;
  opportunity_intelligence_status?: string | null;
  opportunity_intelligence_task_id?: string | null;
  opportunity_intelligence_ready_at?: string | null;
  opportunity_intelligence_error?: string | null;
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
  opportunity_intelligence_status?: string | null;
}) => isOIReady(resolveOIStatus(c));


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

function formatEstimatedValue(crawlData: any): string | null {
  return resolveEstimatedValue(crawlData);
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



const PT_TZ = "America/Los_Angeles";

type DateFilter = "all" | "this_week" | "this_month";

const DATE_FILTERS: { label: string; value: DateFilter }[] = [
  { label: "All Dates", value: "all" },
  { label: "This Week", value: "this_week" },
  { label: "This Month", value: "this_month" },
];

function matchesDateFilter(iso: string | null, df: DateFilter): boolean {
  if (df === "all") return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return false;
  const nowPt = toZonedTime(new Date(), PT_TZ);
  const duePt = toZonedTime(d, PT_TZ);
  const startOfToday = new Date(nowPt);
  startOfToday.setHours(0, 0, 0, 0);
  if (df === "this_week") {
    const endOfNextWeek = new Date(startOfToday);
    const daysUntilSunday = (7 - nowPt.getDay()) % 7 || 7;
    endOfNextWeek.setDate(endOfNextWeek.getDate() + daysUntilSunday);
    endOfNextWeek.setHours(23, 59, 59, 999);
    return duePt.getTime() >= startOfToday.getTime() && duePt.getTime() <= endOfNextWeek.getTime();
  }
  if (df === "this_month") {
    const endOfMonth = new Date(nowPt.getFullYear(), nowPt.getMonth() + 1, 0, 23, 59, 59, 999);
    return duePt.getTime() >= startOfToday.getTime() && duePt.getTime() <= endOfMonth.getTime();
  }
  return true;
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

interface FacetMultiSelectProps {
  label: string;
  icon?: React.ReactNode;
  options: string[];
  hasNone: boolean;
  noneLabel: string;
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}

const FacetMultiSelect = ({
  label,
  icon,
  options,
  hasNone,
  noneLabel,
  value,
  onChange,
  searchPlaceholder,
}: FacetMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter((v) => v !== key));
    else onChange([...value, key]);
  };
  const count = value.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
        >
          {icon}
          <span>{label}</span>
          {count > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-5 text-xs">
              {count}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="end">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? "Search..."} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const selected = value.includes(opt);
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => toggle(opt)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                );
              })}
              {hasNone && (
                <CommandItem
                  value={noneLabel}
                  onSelect={() => toggle(NO_VALUE_SENTINEL)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={`h-4 w-4 ${value.includes(NO_VALUE_SENTINEL) ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="italic text-muted-foreground">{noneLabel}</span>
                </CommandItem>
              )}
            </CommandGroup>
            {count > 0 && (
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={() => onChange([])}
                >
                  Clear {label}
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const Opportunities = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [scanLoading, setScanLoading] = useState(false);
  const [countyFilter, setCountyFilter] = useState<string[]>([]);
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filteredOutOpen, setFilteredOutOpen] = useState(false);
  const [activeScanTaskIds, setActiveScanTaskIds] = useState<string[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
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
    opportunity_lifecycle_status: row.opportunity_lifecycle_status ?? null,
    opportunity_intelligence_status: row.opportunity_intelligence_status ?? null,
    opportunity_intelligence_task_id: row.opportunity_intelligence_task_id ?? null,
    opportunity_intelligence_ready_at: row.opportunity_intelligence_ready_at ?? null,
    opportunity_intelligence_error: row.opportunity_intelligence_error ?? null,
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

      // Rehydrate active scan panel if there are non-terminal portal scan
      // tasks still running in the background (survives reloads/navigation).
      // Portal-agnostic: matches any "<portal>_scan" task type.
      const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: activeTasks } = await supabase
        .from("agent_tasks")
        .select("id, created_at")
        .like("task_type", "%_scan")
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
          if (!(typeof row?.task_type === "string" && row.task_type.endsWith("_scan"))) return;
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
          .like("task_type", "%_scan")
          .gte("created_at", startedAt);
        if (queuedTasks && queuedTasks.length > 0) {
          setActiveScanTaskIds((prev) => {
            const merged = new Set(prev);
            queuedTasks.forEach((t: any) => merged.add(t.id));
            return Array.from(merged);
          });
        }
        toast({
          title: "Refresh started",
          description: `${totalQueued} source${totalQueued === 1 ? "" : "s"} queued. Opportunities update as portal metadata refreshes.`,
        });
      } else if (sourcesScanned === 0) {
        toast({
          title: "No sources due",
          description: "All sources were refreshed recently. Try again later.",
        });
        setScanActive(false);
      } else {
        toast({
          title: "Refresh complete",
          description: `${data?.total_candidates_new ?? 0} new opportunities found.`,
        });
        setScanActive(false);
        await loadCandidates();
      }
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      setScanActive(false);
    } finally {
      setScanLoading(false);
    }
  };

  const handleAnalyzeProject = async (candidate: Candidate) => {
    setAnalyzingId(candidate.id);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-project", {
        body: { candidate_id: candidate.id },
      });
      if (error) throw error;
      if (data?.success === false) {
        throw new Error(data?.error ?? "Failed to queue analysis");
      }

      setCandidates((prev) =>
        prev.map((c) =>
          c.id === candidate.id
            ? {
                ...c,
                analysis_status: (data?.analysis_status ?? "queued") as AnalysisStatus,
                analysis_task_id: data?.task_id ?? c.analysis_task_id,
                analysis_requested_at: new Date().toISOString(),
                analysis_error: null,
                document_acquisition_status: (data?.document_acquisition_status ?? "queued") as DocumentAcquisitionStatus,
                document_acquisition_error: null,
                opportunity_lifecycle_status: "opportunity_intelligence_queued",
                opportunity_intelligence_status: "queued",
                opportunity_intelligence_task_id: data?.task_id ?? c.opportunity_intelligence_task_id,
                opportunity_intelligence_error: null,
              }
            : c,
        ),
      );

      toast({
        title: data?.duplicate ? "Analysis already queued" : "Analysis queued",
        description: data?.message ?? "BidBox will acquire documents and prepare Project Intelligence.",
      });
      await loadCandidates({ silent: true });
    } catch (e: any) {
      toast({
        title: "Analysis failed",
        description: e?.message ?? "Failed to queue analysis",
        variant: "destructive",
      });
    } finally {
      setAnalyzingId(null);
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

  // Distinct county / agency options from loaded candidates.
  const { countyOptions, agencyOptions, hasNoCounty, hasNoAgency } = useMemo(() => {
    const counties = new Set<string>();
    const agencies = new Set<string>();
    let noCounty = false;
    let noAgency = false;
    for (const c of candidates) {
      const cty = getCandidateCounty(c);
      if (cty) counties.add(cty);
      else noCounty = true;
      const ag = (c.agency ?? "").trim();
      if (ag) agencies.add(ag);
      else noAgency = true;
    }
    return {
      countyOptions: Array.from(counties).sort((a, b) => a.localeCompare(b)),
      agencyOptions: Array.from(agencies).sort((a, b) => a.localeCompare(b)),
      hasNoCounty: noCounty,
      hasNoAgency: noAgency,
    };
  }, [candidates]);

  const matchesFacets = useCallback(
    (c: Candidate) => {
      if (countyFilter.length > 0) {
        const cty = getCandidateCounty(c);
        const key = cty ?? NO_VALUE_SENTINEL;
        if (!countyFilter.includes(key)) return false;
      }
      if (agencyFilter.length > 0) {
        const ag = (c.agency ?? "").trim();
        const key = ag || NO_VALUE_SENTINEL;
        if (!agencyFilter.includes(key)) return false;
      }
      return true;
    },
    [countyFilter, agencyFilter],
  );

  // Filter by tab + county/agency facets.
  const filtered = useMemo(
    () =>
      candidates.filter((c) => {
        if (activeFilter === "analyzed" && !isAnalyzedCandidate(c)) return false;
        return matchesFacets(c);
      }),
    [candidates, activeFilter, matchesFacets],
  );

  // Separate auto-Red / low-relevance into Filtered Out; sort remainder by bid date.
  const { visibleCards, filteredOutCards } = useMemo(() => {
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

    const datePassed = visible
      .filter((c) => matchesDateFilter(c.bid_due_at, dateFilter))
      .sort(compareByDueAsc);
    filteredOut.sort(compareByDueAsc);

    return { visibleCards: datePassed, filteredOutCards: filteredOut };
  }, [filtered, activeFilter, dateFilter]);

  const hasActiveFacetFilters = countyFilter.length > 0 || agencyFilter.length > 0 || dateFilter !== "all";


  const renderCard = (candidate: Candidate, _index: number) => {
    const onCalendar = candidate.status === "converted" && !!candidate.converted_project_id;
    const estimatedValue = formatEstimatedValue(candidate.crawl_data);
    const goToOpportunity = () => navigate(`/opportunities/${candidate.id}`);

    return (
      <div
        key={candidate.id}
        role="button"
        tabIndex={0}
        onClick={goToOpportunity}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goToOpportunity();
          }
        }}
        className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-300"
      >
        {/* Title + external link */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base text-foreground leading-snug">
              {candidate.raw_title ?? "Untitled Opportunity"}
            </h3>
            {candidate.agency && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {candidate.agency}
              </p>
            )}
            {onCalendar && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium text-blue-600">
                <CalendarCheck2 className="h-3 w-3 shrink-0" />
                On Calendar
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

        {/* Portal pill */}
        {candidate.portal_type && (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                PORTAL_STYLES[candidate.portal_type] ?? "bg-gray-500/10 text-gray-600"
              }`}
            >
              {candidate.portal_type}
            </span>
          </div>
        )}

        {/* Estimated value — prominent */}
        {estimatedValue && (
          <p className="text-2xl font-bold text-foreground leading-none">{estimatedValue}</p>
        )}

        {/* Meta */}
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>Bid Due: {formatBidDate(candidate.bid_due_at)}</p>
          {candidate.source_name && (
            <p className="text-xs">Source: {candidate.source_name}</p>
          )}
        </div>

        {/* CTA — unified */}
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            goToOpportunity();
          }}
          className="w-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 shadow-none"
        >
          View Project
        </Button>
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
                  {scanLoading ? "Refreshing..." : "Refresh Now"}
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
              <div className="flex items-center gap-2 flex-wrap">
                {DATE_FILTERS.map((df) => (
                  <button
                    key={df.value}
                    onClick={() => setDateFilter(df.value)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      dateFilter === df.value
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {df.label}
                  </button>
                ))}
                <FacetMultiSelect
                  label="County"
                  icon={<Filter className="h-3.5 w-3.5" />}
                  options={countyOptions}
                  hasNone={hasNoCounty}
                  noneLabel="(No county)"
                  value={countyFilter}
                  onChange={setCountyFilter}
                  searchPlaceholder="Search counties..."
                />
                <FacetMultiSelect
                  label="Agency"
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  options={agencyOptions}
                  hasNone={hasNoAgency}
                  noneLabel="(No agency)"
                  value={agencyFilter}
                  onChange={setAgencyFilter}
                  searchPlaceholder="Search agencies..."
                />
                {hasActiveFacetFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCountyFilter([]);
                      setAgencyFilter([]);
                      setDateFilter("all");
                    }}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </div>

            {/* Cards */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-lg font-medium text-foreground mb-2">No opportunities found</p>
                <p className="text-sm text-muted-foreground mb-6">
                  {activeFilter === "all"
                    ? "Click Refresh Now to discover and update bids from Caltrans and PlanetBids."
                    : "No opportunities in this view."}
                </p>
                {activeFilter === "all" && (
                  <Button
                    onClick={handleScanNow}
                    disabled={scanLoading}
                    className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${scanLoading ? "animate-spin" : ""}`} />
                    {scanLoading ? "Refreshing..." : "Refresh Now"}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {visibleCards.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    No opportunities match this view.
                  </div>
                ) : (
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
