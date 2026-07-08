import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2, ExternalLink, RefreshCw, ChevronDown, Check, Filter, CalendarCheck2, Bookmark } from "lucide-react";
import { resolveEstimatedValue, resolvePortalStyle } from "@/lib/opportunityDomain";
import { fetchCompanyPursuits, upsertPursuit, type PursuitLite } from "@/lib/tenant";
import { Layout } from "@/components/Layout";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
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

// Transient (per-tab) anchor for restoring list position when navigating back
// from a detail page. Session-only by design — never persisted across browser
// sessions. Survives a hard refresh of the detail page because it lives in
// sessionStorage rather than component/router state.
const SCROLL_ANCHOR_KEY = "bidbox:opportunities:scrollAnchor";

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
  { label: "Saved", value: "saved" },
  { label: "Closed", value: "closed" },
];

const isClosedCandidate = (c: { bid_due_at: string | null }) => {
  if (!c.bid_due_at) return false;
  const t = new Date(c.bid_due_at).getTime();
  return !isNaN(t) && t < Date.now();
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
    "MM/dd/yyyy"
  );
}

function daysUntilBidDue(iso: string | null): { text: string; colorClass: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due.getTime())) return null;
  const nowYmd = formatInProjectTimezone(new Date().toISOString(), "America/Los_Angeles", "yyyy-MM-dd");
  const dueYmd = formatInProjectTimezone(due.toISOString(), "America/Los_Angeles", "yyyy-MM-dd");
  const toUTC = (ymd: string) =>
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  const days = Math.round((toUTC(dueYmd) - toUTC(nowYmd)) / 86_400_000);
  if (days < 0) return { text: "Closed", colorClass: "text-muted-foreground" };
  if (days === 0) return { text: "Today", colorClass: "text-red-600" };
  if (days === 1) return { text: "Tomorrow", colorClass: "text-red-600" };
  if (days <= 3) return { text: `${days} days`, colorClass: "text-red-600" };
  if (days <= 7) return { text: `${days} days`, colorClass: "text-amber-500" };
  return { text: `${days} days`, colorClass: "text-green-600" };
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

type SortKey = "due_asc" | "due_desc" | "added_desc" | "added_asc";

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "Bid Due (Soonest First)", value: "due_asc" },
  { label: "Bid Due (Latest First)", value: "due_desc" },
  { label: "Recently Added", value: "added_desc" },
  { label: "Oldest Added", value: "added_asc" },
];


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
  const [savedCandidateIds, setSavedCandidateIds] = useState<Set<string>>(new Set());
  // Tenant boundary: company-scoped pursuit rows overlaid on canonical
  // candidates (dual-read; legacy candidate columns remain the fallback).
  const [pursuitByCandidate, setPursuitByCandidate] = useState<Map<string, PursuitLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("due_asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
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
    const { data: { session } } = await supabase.auth.getSession();
    // Paginated fetch — REQUIRED. A single unranged `.select()` is silently
    // capped at Supabase/PostgREST's default 1000-row limit. Once
    // opportunity_candidates crossed 1000 rows (nightly multi-portal scans), an
    // unpaginated fetch ordered by created_at DESC returned only the 1000 NEWEST
    // rows and silently dropped the oldest — including saved and project-backing
    // candidates — so the Saved tab (which filters this client-side array)
    // rendered empty and old opportunities vanished from "All". We loop with an
    // explicit page size until a short page is returned, with a hard safety
    // ceiling so a runaway table can never paginate forever.
    const PAGE_SIZE = 1000;
    const MAX_CANDIDATE_ROWS = 50000; // safety ceiling, far above realistic volume
    const data: any[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error } = await supabase
        .from("opportunity_candidates")
        .select("*, opportunity_sources(name, last_scanned_at)")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        if (!silent) {
          toast({ title: "Error", description: "Failed to load opportunities", variant: "destructive" });
          setLoading(false);
        }
        return;
      }

      const batch = page ?? [];
      data.push(...batch);
      if (batch.length < PAGE_SIZE) break; // last (short) page reached — all rows loaded
      if (data.length >= MAX_CANDIDATE_ROWS) {
        console.warn(`[opps] candidate pagination hit the ${MAX_CANDIDATE_ROWS}-row safety ceiling; some rows may be omitted`);
        break;
      }
    }

    const rows: Candidate[] = (data || []).map(mapRow);
    let pursuits = new Map<string, PursuitLite>();
    if (session) {
      const { data: savedRows, error: savedError } = await (supabase as any)
        .from("saved_opportunities")
        .select("opportunity_candidate_id")
        .eq("user_id", session.user.id);
      if (!savedError) {
        setSavedCandidateIds(new Set((savedRows ?? []).map((r: any) => r.opportunity_candidate_id).filter(Boolean)));
      }
      pursuits = await fetchCompanyPursuits();
      setPursuitByCandidate(pursuits);
    }

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
            p.status !== r.status ||
            p.converted_project_id !== r.converted_project_id
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
      // Dual-read: pursuit notes take precedence; legacy column is the fallback.
      rows.forEach((r) => {
        initialNotes[r.id] = pursuits.get(r.id)?.triage_notes ?? r.review_notes ?? "";
      });
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
      const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
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

  // Restore scroll position to the last-clicked opportunity card once, per
  // mount, after the list has finished loading (and the cards have therefore
  // committed to the DOM). Runs identically whether the user arrived via the
  // browser Back button or the "Back to Opportunities" button, since both
  // simply remount this component at the /opportunities route.
  const scrollRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (loading || scrollRestoreAttemptedRef.current) return;
    scrollRestoreAttemptedRef.current = true;

    const raw = sessionStorage.getItem(SCROLL_ANCHOR_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCROLL_ANCHOR_KEY);

    let anchor: { id: string; scrollY: number } | null = null;
    try {
      anchor = JSON.parse(raw);
    } catch {
      return;
    }
    if (!anchor) return;

    const target = document.querySelector(`[data-candidate-id="${CSS.escape(anchor.id)}"]`);
    if (target) {
      target.scrollIntoView({ block: "center" });
    } else if (typeof anchor.scrollY === "number") {
      // Card no longer present (e.g. filters changed) — fall back to the raw
      // offset rather than leaving the user at the top.
      window.scrollTo({ top: anchor.scrollY });
    }
  }, [loading]);

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
    // Dual-write: pursuits (tenant boundary) + legacy candidate column.
    // Legacy stays authoritative until the cleanup phase; pursuit write is
    // fail-soft and never blocks the save.
    const { error } = await supabase
      .from("opportunity_candidates")
      .update({ review_notes: note || null })
      .eq("id", id);
    if (error) {
      toast({ title: "Error", description: "Failed to save notes", variant: "destructive" });
      return;
    }
    const wrote = await upsertPursuit(id, { triage_notes: note || null });
    if (wrote) {
      setPursuitByCandidate((prev) => {
        const next = new Map(prev);
        const existing = next.get(id);
        if (existing) next.set(id, { ...existing, triage_notes: note || null });
        return next;
      });
    }
  };

  const handleToggleSaved = async (candidate: Candidate) => {
    const wasSaved = savedCandidateIds.has(candidate.id);
    setSavedCandidateIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      if (wasSaved) {
        const { error } = await (supabase as any)
          .from("saved_opportunities")
          .delete()
          .eq("user_id", session.user.id)
          .eq("opportunity_candidate_id", candidate.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("saved_opportunities")
          .upsert(
            { user_id: session.user.id, opportunity_candidate_id: candidate.id },
            { onConflict: "user_id,opportunity_candidate_id" },
          );
        if (error) throw error;
      }

      toast({
        title: wasSaved ? "Removed from Saved" : "Saved opportunity",
        description: wasSaved ? "This opportunity was removed from your Saved tab." : "This opportunity now appears in Saved.",
      });
    } catch (e: any) {
      setSavedCandidateIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(candidate.id);
        else next.delete(candidate.id);
        return next;
      });
      toast({
        title: wasSaved ? "Failed to unsave" : "Failed to save",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
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
      if (agencyFilter.length > 0) {
        const ag = (c.agency ?? "").trim();
        const key = ag || NO_VALUE_SENTINEL;
        if (!agencyFilter.includes(key)) return false;
      }
      return true;
    },
    [agencyFilter],
  );

  // Filter by tab + agency facet.
  const filtered = useMemo(
    () =>
      candidates.filter((c) => {
        const closed = isClosedCandidate(c);
        if (activeFilter === "closed") {
          if (!closed) return false;
        } else {
          if (closed) return false;
          if (activeFilter === "saved" && !savedCandidateIds.has(c.id)) return false;
        }
        return matchesFacets(c);
      }),
    [candidates, activeFilter, matchesFacets, savedCandidateIds],
  );

  const buildComparator = useCallback((key: SortKey) => {
    return (a: Candidate, b: Candidate): number => {
      if (key === "added_desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (key === "added_asc") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      const aDue = a.bid_due_at ? new Date(a.bid_due_at).getTime() : null;
      const bDue = b.bid_due_at ? new Date(b.bid_due_at).getTime() : null;
      if (aDue === null && bDue === null) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (aDue === null) return 1;
      if (bDue === null) return -1;
      if (key === "due_desc") return bDue - aDue;
      return aDue - bDue;
    };
  }, []);

  // Separate auto-Red / low-relevance into Filtered Out; sort remainder.
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

    const cmp = buildComparator(sortKey);
    visible.sort(cmp);
    filteredOut.sort(cmp);

    return { visibleCards: visible, filteredOutCards: filteredOut };
  }, [filtered, activeFilter, sortKey, buildComparator]);

  const hasActiveFacetFilters = agencyFilter.length > 0;

  // Ordered ID list for the current visible set — passed as nav context when
  // navigating to the detail page so Prev/Next arrows stay within this view.
  const visibleCardIds = useMemo(() => visibleCards.map((c) => c.id), [visibleCards]);

  const tabCounts = useMemo(() => {
    const isHiddenFromMainAll = (candidate: Candidate) =>
      candidate.auto_status === "red" ||
      classifyOpportunityTitle(candidate.raw_title).relevance === "low";
    const matching = candidates.filter(matchesFacets);
    return {
      all: matching.filter((c) => !isClosedCandidate(c) && !isHiddenFromMainAll(c)).length,
      saved: matching.filter((c) => !isClosedCandidate(c) && savedCandidateIds.has(c.id)).length,
      closed: matching.filter(isClosedCandidate).length,
    };
  }, [candidates, matchesFacets, savedCandidateIds]);

  const renderCard = (candidate: Candidate, _index: number, navIds?: string[]) => {
    // Dual-read: pursuit linkage first, legacy converted columns as fallback.
    const pursuitProjectId = pursuitByCandidate.get(candidate.id)?.project_id ?? null;
    const onCalendar = Boolean(pursuitProjectId) ||
      (candidate.status === "converted" && !!candidate.converted_project_id);
    const estimatedValue = formatEstimatedValue(candidate.crawl_data);
    const goToOpportunity = () => {
      sessionStorage.setItem(
        SCROLL_ANCHOR_KEY,
        JSON.stringify({ id: candidate.id, scrollY: window.scrollY }),
      );
      navigate(
        `/opportunities/${candidate.id}`,
        navIds ? { state: { navIds } } : undefined,
      );
    };
    const saved = savedCandidateIds.has(candidate.id);

    return (
      <div
        key={candidate.id}
        data-candidate-id={candidate.id}
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
        {/* Top content — grows to push button to bottom */}
        <div className="flex-1 flex flex-col gap-3">
          {/* Title + actions */}
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
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleSaved(candidate);
                }}
                className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                  saved ? "text-blue-700 bg-blue-50 hover:bg-blue-100" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                aria-label={saved ? "Unsave opportunity" : "Save opportunity"}
                title={saved ? "Unsave opportunity" : "Save opportunity"}
              >
                <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
              </button>
              <a
                href={candidate.source_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Open source page"
                aria-label="Open source page"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Portal pill */}
          {candidate.portal_type && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${resolvePortalStyle(candidate.portal_type)}`}
              >
                {candidate.portal_type}
              </span>
            </div>
          )}

          {/* Estimated value — prominent */}
          {estimatedValue && (
            <p className="text-2xl font-bold text-foreground leading-none">{estimatedValue}</p>
          )}
        </div>

        {/* Bid due + countdown — anchored directly above button */}
        <div className="flex items-center gap-2">
          <p className="text-sm text-foreground font-medium">
            Bid Due: {formatBidDate(candidate.bid_due_at)}
          </p>
          {(() => {
            const countdown = daysUntilBidDue(candidate.bid_due_at);
            if (!countdown) return null;
            const bgMap: Record<string, string> = {
              "text-red-600": "bg-red-50",
              "text-amber-500": "bg-amber-50",
              "text-green-600": "bg-green-50",
              "text-muted-foreground": "bg-muted",
            };
            return (
              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${bgMap[countdown.colorClass] ?? "bg-muted"} ${countdown.colorClass}`}>
                {countdown.text}
              </span>
            );
          })()}
        </div>

        {/* CTA — unified, always at bottom */}
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
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Opportunities</h1>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleScanNow}
                        disabled={scanLoading}
                        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${scanLoading ? "animate-spin" : ""}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Re-Scan</TooltipContent>
                  </Tooltip>
                  Last scanned: {timeAgo(lastScannedAt)}
                </p>
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
                  const count = tabCounts[f.value as keyof typeof tabCounts];
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
                <Popover open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-2">
                      <Filter className="h-3.5 w-3.5" />
                      <span>Filter</span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-1 w-[220px]" align="end">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setSortKey(opt.value);
                          setSortMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent ${
                          sortKey === opt.value ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        <Check
                          className={`h-4 w-4 ${sortKey === opt.value ? "opacity-100" : "opacity-0"}`}
                        />
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
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
                    onClick={() => setAgencyFilter([])}
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
                    {visibleCards.map((c, i) => renderCard(c, i, visibleCardIds))}
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
                        {filteredOutCards.map((c, i) => renderCard(c, i))}
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
