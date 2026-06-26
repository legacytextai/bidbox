import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { dateIdentity, resolveAuthoritativeBidDue } from "@/lib/bidDueResolver";
import { formatProjectDateTime, formatProjectDateTimeOrNull } from "@/lib/timezoneUtils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  ExternalLink,
  CalendarPlus,
  Loader2,
  Clock,
  AlertTriangle,
  FileText,
  Sparkles,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  RotateCcw,
  Trash2,
} from "lucide-react";

type AnalysisStatus =
  | "not_requested"
  | "queued"
  | "analyzing"
  | "ready"
  | "failed";

type FindingStatus =
  | "found"
  | "unknown"
  | "conflict"
  | "not_applicable"
  | "needs_review";

interface Candidate {
  id: string;
  source_url: string;
  portal_type: string | null;
  raw_title: string | null;
  agency: string | null;
  bid_due_at: string | null;
  scope_text: string | null;
  status: string;
  converted_project_id: string | null;
  crawl_data: any | null;
  analysis_status: AnalysisStatus;
  analysis_error: string | null;
  document_acquisition_status: string;
  document_acquisition_error: string | null;
  document_processing_status: string;
  document_processing_error: string | null;
  opportunity_lifecycle_status?: string | null;
  opportunity_intelligence_status?: string | null;
  opportunity_intelligence_task_id?: string | null;
  opportunity_intelligence_ready_at?: string | null;
  opportunity_intelligence_error?: string | null;
}

interface ReportRow {
  id: string;
  status: string;
  title: string | null;
  executive_summary: any;
  confidence_score: number | null;
  error: string | null;
  completed_at: string | null;
  generation_metadata: any | null;
}

interface Finding {
  id: string;
  category: string;
  field_key: string;
  label: string;
  value_text: string | null;
  value_jsonb: any | null;
  status: FindingStatus;
  confidence: "high" | "medium" | "low";
  is_critical: boolean;
  sort_order: number;
  notes: string | null;
}

interface Citation {
  id: string;
  finding_id: string;
  source_document_name: string;
  page_number: number | null;
  page_label: string | null;
  source_excerpt: string;
  citation_label: string | null;
  opportunity_document_chunk_id: string;
}

interface DocumentRow {
  id: string;
  file_name: string | null;
  document_class: string | null;
  document_family: string | null;
  text_page_count: number | null;
  processing_status: string | null;
}

interface ActiveAnalysisTask {
  id: string;
  task_type: string;
  status: string;
  payload: any | null;
}

const REPORT_SECTIONS = [
  { key: "project_overview", title: "Project Overview", icon: Sparkles },
  { key: "scope_summary", title: "Scope Summary", icon: FileText },
  { key: "trade_breakdown", title: "Trade Breakdown", icon: FileText },
  { key: "key_dates", title: "Key Dates", icon: Clock },
  { key: "bid_requirements", title: "Bid Requirements", icon: CheckCircle2 },
  { key: "addenda_summary", title: "Addenda Summary", icon: FileText },
  { key: "risk_flags", title: "Risk Flags", icon: AlertTriangle },
];

const ACTIVE_TASK_STATUSES = ["pending", "running", "retrying"];
const ACTIVE_ANALYSIS_STATUSES = ["queued", "analyzing"];
const ACTIVE_DOCUMENT_STATUSES = ["queued", "acquiring"];
const ACTIVE_PROCESSING_STATUSES = ["queued", "processing"];
const ANALYSIS_STAGES = ["metadata_refresh", "report_generation", "validation", "complete"] as const;

type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

const formatDate = (value: string | null) =>
  formatProjectDateTime(value, { fallback: "—" });

const isUniqueViolation = (error: any) =>
  error?.code === "23505" ||
  String(error?.message ?? "").toLowerCase().includes("duplicate key");

const reanalysisFailureReason = (candidate: Candidate | null) => {
  if (!candidate) return null;
  return (
    candidate.analysis_error ||
    candidate.document_acquisition_error ||
    candidate.document_processing_error ||
    null
  );
};

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i;
const MONTH_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;

const normalizeTimeToken = (text: string | null | undefined) => {
  const match = String(text ?? "").match(TIME_RE);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3].toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (meridiem.startsWith("p") && hour !== 12) hour += 12;
  if (meridiem.startsWith("a") && hour === 12) hour = 0;
  return hour * 60 + minute;
};

const extractDateTimeDisplay = (text: string | null | undefined) => {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return null;
  const formatted = formatProjectDateTimeOrNull(source);
  if (formatted) return formatted;
  const date = source.match(MONTH_DATE_RE)?.[0] ?? null;
  const time = source.match(TIME_RE)?.[0] ?? null;
  if (date && time) {
    const cleanedTime = time
      .replace(/\./g, "")
      .replace(/\s+/g, " ")
      .toUpperCase();
    return `${date} at ${cleanedTime}`;
  }
  return source;
};

const isBidDueFinding = (finding: Finding) => {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    /bid.*due/.test(haystack) ||
    /due.*date/.test(haystack) ||
    /bid.*opening/.test(haystack) ||
    /submission.*deadline/.test(haystack)
  );
};

const isProjectOverviewBullet = (text: string | null | undefined) =>
  /^project overview\s*:/i.test(String(text ?? "").trim());

const normalizeExecutiveBulletText = (
  text: string | null | undefined,
  index: number,
  bidDue?: { display: string; value: string | null; source: string | null; warning?: string | null },
) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return value;
  const mentionsBidDue = /\b(bid\s*(due|date|deadline)|deadline)\b/i.test(value);
  const hasStructuredBidDue = bidDue?.source && bidDue.source !== "F4 fallback" && bidDue.display !== "—";
  if (mentionsBidDue && hasStructuredBidDue) {
    const bulletDate = dateIdentity(value);
    const authoritativeDate = dateIdentity(bidDue.value);
    if (!bulletDate || !authoritativeDate || bulletDate !== authoritativeDate || bidDue.warning) {
      return bidDue.warning
        ? `Key Bid Facts: ${bidDue.warning}`
        : `Key Bid Facts: Bid Due: ${bidDue.display}`;
    }
  }
  if (index === 0) {
    if (/^scope text\s*:/i.test(value)) {
      return value.replace(/^scope text\s*:/i, "Project Overview:");
    }
    if (!isProjectOverviewBullet(value)) {
      return `Project Overview: ${value}`;
    }
  }
  return value;
};

const bidDueSourceLabel = (source: string | null | undefined) => {
  if (source === "manual_override") return "Manual override";
  if (source === "deadline_candidate_override") return "Selected evidence override";
  if (source === "portal_metadata") return "Portal metadata";
  if (source === "candidate_metadata") return "Candidate metadata";
  if (source === "project_metadata") return "Project metadata";
  if (source === "f4_fallback") return "F4 fallback";
  return null;
};

const ANALYSIS_BADGE: Record<AnalysisStatus, string> = {
  not_requested: "bg-gray-500/10 text-gray-600",
  queued: "bg-blue-500/10 text-blue-700",
  analyzing: "bg-indigo-500/10 text-indigo-700",
  ready: "bg-green-500/10 text-green-700",
  failed: "bg-red-500/10 text-red-700",
};

const ANALYSIS_LABEL: Record<AnalysisStatus, string> = {
  not_requested: "Not analyzed",
  queued: "Queued",
  analyzing: "Generating report",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_STYLE: Record<FindingStatus, string> = {
  found: "bg-green-500/10 text-green-700",
  unknown: "bg-gray-500/10 text-gray-600",
  conflict: "bg-red-500/10 text-red-700",
  not_applicable: "bg-gray-500/10 text-gray-600",
  needs_review: "bg-yellow-500/10 text-yellow-700",
};

const OpportunityReport = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [linkedProjectBidDueAt, setLinkedProjectBidDueAt] = useState<string | null>(null);
  const [linkedProjectBidDueOverrideAt, setLinkedProjectBidDueOverrideAt] = useState<string | null>(null);
  const [linkedProjectBidDueOverrideSource, setLinkedProjectBidDueOverrideSource] = useState<string | null>(null);
  const [linkedProjectBidDueOverrideReason, setLinkedProjectBidDueOverrideReason] = useState<string | null>(null);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);
  const [reanalysisFailureNotice, setReanalysisFailureNotice] = useState<string | null>(null);
  const [activeAnalysisTask, setActiveAnalysisTask] = useState<ActiveAnalysisTask | null>(null);
  const wasAnalysisActiveRef = useRef(false);

  const load = useCallback(async () => {
    if (!id) return;
    const sb = supabase as any;
    const candRes = await sb
      .from("opportunity_candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (candRes.error || !candRes.data) {
      toast({
        title: "Not found",
        description: "Opportunity could not be loaded.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    const reportRes = await sb
      .from("opportunity_intelligence_reports")
      .select("*")
      .eq("opportunity_candidate_id", id)
      .in("status", ["ready", "partial"])
      .order("report_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const docsRes = await sb
      .from("opportunity_documents")
      .select(
        "id, file_name, document_class, document_family, text_page_count, processing_status",
      )
      .eq("opportunity_candidate_id", id)
      .order("document_source_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    let projectBidDueAt: string | null = null;
    if (candRes.data?.converted_project_id) {
      const projectRes = await sb
        .from("projects")
        .select("bid_due_at, bid_due_override_at, bid_due_override_source, bid_due_override_reason")
        .eq("id", candRes.data.converted_project_id)
        .maybeSingle();
      projectBidDueAt = projectRes.data?.bid_due_at ?? null;
      setLinkedProjectBidDueOverrideAt(projectRes.data?.bid_due_override_at ?? null);
      setLinkedProjectBidDueOverrideSource(projectRes.data?.bid_due_override_source ?? null);
      setLinkedProjectBidDueOverrideReason(projectRes.data?.bid_due_override_reason ?? null);
    }
    if (!projectBidDueAt) {
      const projectRes = await sb
        .from("projects")
        .select("bid_due_at, bid_due_override_at, bid_due_override_source, bid_due_override_reason")
        .eq("origin", "opportunity_intelligence")
        .eq("source_opportunity_candidate_id", id)
        .maybeSingle();
      projectBidDueAt = projectRes.data?.bid_due_at ?? null;
      setLinkedProjectBidDueOverrideAt(projectRes.data?.bid_due_override_at ?? null);
      setLinkedProjectBidDueOverrideSource(projectRes.data?.bid_due_override_source ?? null);
      setLinkedProjectBidDueOverrideReason(projectRes.data?.bid_due_override_reason ?? null);
    }

    const activeTaskRes = await sb
      .from("agent_tasks")
      .select("id, task_type, status, payload")
      .in("task_type", ["project_analysis", "document_processing", "project_intelligence"])
      .in("status", ACTIVE_TASK_STATUSES)
      .contains("payload", { candidate_id: id })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let findingRows: Finding[] = [];
    let citationRows: Citation[] = [];
    if (reportRes.data?.id) {
      const findingsRes = await sb
        .from("opportunity_intelligence_findings")
        .select("*")
        .eq("report_id", reportRes.data.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      const citationsRes = await sb
        .from("opportunity_intelligence_citations")
        .select("*")
        .eq("report_id", reportRes.data.id)
        .order("created_at", { ascending: true });

      findingRows = (findingsRes.data ?? []) as Finding[];
      citationRows = (citationsRes.data ?? []) as Citation[];
    }

    setCandidate(candRes.data as Candidate);
    setLinkedProjectBidDueAt(projectBidDueAt);
    setReport((reportRes.data ?? null) as ReportRow | null);
    setDocuments((docsRes.data ?? []) as DocumentRow[]);
    setActiveAnalysisTask((activeTaskRes.data ?? null) as ActiveAnalysisTask | null);
    setFindings(findingRows);
    setCitations(citationRows);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }
      load();
    })();
  }, [navigate, load]);

  const citationsByFinding = useMemo(() => {
    const map = new Map<string, Citation[]>();
    citations.forEach((citation) => {
      const list = map.get(citation.finding_id) ?? [];
      list.push(citation);
      map.set(citation.finding_id, list);
    });
    return map;
  }, [citations]);

  const findingsByCategory = useMemo(() => {
    const map = new Map<string, Finding[]>();
    findings.forEach((finding) => {
      const list = map.get(finding.category) ?? [];
      list.push(finding);
      map.set(finding.category, list);
    });
    return map;
  }, [findings]);

  const bidDueFindings = useMemo(
    () =>
      findings.filter((finding) => {
      const statusSupportsFact = finding.status === "found" || finding.status === "conflict";
      return statusSupportsFact && isBidDueFinding(finding) && (citationsByFinding.get(finding.id)?.length ?? 0) > 0;
      }),
    [findings, citationsByFinding],
  );

  const safeBidDue = useMemo(() => {
    const sourceDisplays = bidDueFindings
      .map((finding) => extractDateTimeDisplay(finding.value_text))
      .filter((value): value is string => Boolean(value));

    const sourceTimes = [
      ...new Set(
        bidDueFindings
          .map((finding) => normalizeTimeToken(finding.value_text))
        .filter((value): value is number => value !== null),
      ),
    ];

    const f4ValueText = bidDueFindings[0]?.value_text ?? null;
    const resolved = resolveAuthoritativeBidDue({
      overrideBidDueAt: linkedProjectBidDueOverrideAt,
      overrideSource: linkedProjectBidDueOverrideSource,
      dueDateRaw: candidate?.crawl_data?.due_date_raw as string | null | undefined,
      candidateBidDueAt: candidate?.bid_due_at ?? null,
      projectBidDueAt: linkedProjectBidDueAt,
      f4ValueText,
    });
    const findingDate = bidDueFindings
      .map((finding) => dateIdentity(finding.value_text))
      .find(Boolean);
    const hasSourceConflict = sourceTimes.length > 1;
    const hasMetadataConflict =
      resolved.conflict ||
      Boolean(dateIdentity(resolved.value) && findingDate && dateIdentity(resolved.value) !== findingDate);

    if (hasSourceConflict) {
      return {
        ...resolved,
        display: resolved.display !== "—" ? resolved.display : sourceDisplays[0] || "—",
        source: bidDueSourceLabel(resolved.source),
        warning: "Conflicting deadline evidence detected. Showing the authoritative structured deadline.",
      };
    }

    return {
      ...resolved,
      source: bidDueSourceLabel(resolved.source),
      warning: hasMetadataConflict
        ? resolved.conflictMessage ?? "F4 cited deadline conflicts with structured portal metadata. Showing structured deadline."
        : null,
    };
  }, [
    candidate?.bid_due_at,
    candidate?.crawl_data,
    linkedProjectBidDueAt,
    linkedProjectBidDueOverrideAt,
    linkedProjectBidDueOverrideSource,
    bidDueFindings,
  ]);

  const bidDueEvidence = useMemo(() => {
    const selectedDetail =
      linkedProjectBidDueOverrideSource === "manual" && linkedProjectBidDueOverrideReason
        ? `Reason: ${linkedProjectBidDueOverrideReason}`
        : linkedProjectBidDueOverrideSource === "deadline_candidate" && linkedProjectBidDueOverrideReason
          ? linkedProjectBidDueOverrideReason
          : candidate?.crawl_data?.due_date_raw
            ? `Raw portal value: ${candidate.crawl_data.due_date_raw}`
            : null;

    const competing = bidDueFindings.map((finding) => {
      const findingCitations = citationsByFinding.get(finding.id) ?? [];
      const firstCitation = findingCitations[0];
      const label =
        firstCitation?.citation_label ||
        (firstCitation
          ? `${firstCitation.source_document_name}${firstCitation.page_number ? `, p. ${firstCitation.page_number}` : ""}`
          : finding.label);
      const display = extractDateTimeDisplay(finding.value_text) || finding.value_text || "Deadline evidence captured";
      return {
        id: finding.id,
        label,
        display,
        status: finding.status,
        citations: findingCitations,
      };
    });

    return {
      selected: {
        label: safeBidDue.source || "Authoritative deadline",
        display: safeBidDue.display,
        detail: selectedDetail,
      },
      competing,
    };
  }, [
    bidDueFindings,
    candidate?.crawl_data,
    citationsByFinding,
    linkedProjectBidDueOverrideReason,
    linkedProjectBidDueOverrideSource,
    safeBidDue.display,
    safeBidDue.source,
  ]);

  const displayedFindingsByCategory = useMemo(() => {
    const hasStructuredBidDue =
      Boolean(candidate?.crawl_data?.due_date_raw || candidate?.bid_due_at || linkedProjectBidDueAt);
    const map = new Map<string, Finding[]>();
    findingsByCategory.forEach((items, category) => {
      map.set(category, hasStructuredBidDue ? items.filter((finding) => !isBidDueFinding(finding)) : [...items]);
    });

    const keyDateFindings = map.get("key_dates") ?? [];

    if (hasStructuredBidDue && safeBidDue.display !== "—") {
      const structuredBidDueFinding: Finding = {
        id: "__structured_bid_due__",
        category: "key_dates",
        field_key: "bid_due_date",
        label: "Bid Due Date",
        value_text: safeBidDue.display,
        value_jsonb: null,
        status: "found",
        confidence: safeBidDue.warning ? "medium" : "high",
        is_critical: true,
        sort_order: -1,
        notes: [
          safeBidDue.source ? `Source: ${safeBidDue.source}` : null,
          safeBidDue.warning,
          linkedProjectBidDueOverrideReason && linkedProjectBidDueOverrideSource
            ? linkedProjectBidDueOverrideSource === "manual"
              ? `Manually overridden. Reason: ${linkedProjectBidDueOverrideReason}`
              : `Selected from evidence: ${linkedProjectBidDueOverrideReason}`
            : null,
        ].filter(Boolean).join(" "),
      };
      map.set("key_dates", [structuredBidDueFinding, ...keyDateFindings]);
    }

    return map;
  }, [
    candidate?.bid_due_at,
    candidate?.crawl_data?.due_date_raw,
    findingsByCategory,
    linkedProjectBidDueAt,
    safeBidDue.display,
    safeBidDue.source,
    safeBidDue.warning,
  ]);

  const crawl = candidate?.crawl_data ?? {};
  const estimatedValue = crawl?.estimated_value as number | undefined;
  const acquisitionSummary = crawl?.acquisition_summary as
    | {
        status?: string;
        documents_found?: number;
        documents_acquired?: number;
        documents_skipped?: number;
        documents_failed?: number;
        warning_message?: string | null;
      }
    | undefined;
  const jobWalkAt = crawl?.job_walk_at as string | undefined;
  const preBidMeetingAt = crawl?.pre_bid_meeting_at as string | undefined;
  const licenseRequirements = crawl?.license_requirements as string | undefined;
  const contractDuration = crawl?.contract_duration as string | undefined;
  const liquidatedDamages = crawl?.liquidated_damages as string | undefined;
  const department = crawl?.department as string | undefined;
  const projectAddress = crawl?.project_address as string | undefined;
  const reportReady = candidate?.analysis_status === "ready" && report;
  const partialAcquisitionNotice = useMemo(() => {
    if (!reportReady || !acquisitionSummary || acquisitionSummary.status !== "acquired") return null;
    const found = Number(acquisitionSummary.documents_found ?? 0);
    const acquired = Number(acquisitionSummary.documents_acquired ?? 0);
    const skipped = Number(acquisitionSummary.documents_skipped ?? 0);
    const failed = Number(acquisitionSummary.documents_failed ?? 0);
    if (!found || failed <= 0 || acquired + skipped <= 0) return null;
    return {
      analyzed: acquired + skipped,
      total: found,
      message:
        acquisitionSummary.warning_message ||
        `BidBox successfully analyzed ${acquired + skipped} of ${found} available documents.`,
    };
  }, [acquisitionSummary, reportReady]);
  const analysisWorkActive = Boolean(
    activeAnalysisTask ||
      (candidate && ACTIVE_ANALYSIS_STATUSES.includes(candidate.analysis_status)) ||
      (candidate && ACTIVE_DOCUMENT_STATUSES.includes(candidate.document_acquisition_status)) ||
      (candidate && ACTIVE_PROCESSING_STATUSES.includes(candidate.document_processing_status)),
  );

  const activeAnalysisStage = useMemo<AnalysisStage | null>(() => {
    if (!analysisWorkActive) return null;
    const payloadStage = activeAnalysisTask?.payload?.stage;
    if (ANALYSIS_STAGES.includes(payloadStage)) {
      return payloadStage;
    }
    const taskType = activeAnalysisTask?.task_type;
    if (taskType === "project_analysis" || ACTIVE_DOCUMENT_STATUSES.includes(candidate?.document_acquisition_status ?? "")) {
      return "metadata_refresh";
    }
    if (taskType === "document_processing" || ACTIVE_PROCESSING_STATUSES.includes(candidate?.document_processing_status ?? "")) {
      return "metadata_refresh";
    }
    if (taskType === "project_intelligence" || candidate?.analysis_status === "analyzing") {
      return "report_generation";
    }
    return "metadata_refresh";
  }, [
    activeAnalysisTask?.payload?.stage,
    activeAnalysisTask?.task_type,
    analysisWorkActive,
    candidate?.analysis_status,
    candidate?.document_acquisition_status,
    candidate?.document_processing_status,
  ]);

  const stageProgress = useMemo(() => {
    const rank: Record<AnalysisStage, number> = {
      metadata_refresh: 1,
      report_generation: 2,
      validation: 3,
      complete: 4,
    };
    const currentRank = activeAnalysisStage ? rank[activeAnalysisStage] : 1;
    const currentStep = activeAnalysisStage === "metadata_refresh" ? 1 : activeAnalysisStage === "report_generation" ? 2 : 3;
    return {
      currentStep,
      steps: [
        {
          key: "metadata_refresh",
          label: "Refreshing Source Data",
          state: currentRank > 1 ? "complete" : "active",
        },
        {
          key: "report_generation",
          label: "Generating Intelligence Report",
          state: currentRank > 2 ? "complete" : currentRank === 2 ? "active" : "pending",
        },
        {
          key: "validation",
          label: activeAnalysisStage === "complete" ? "Complete" : "Validating Findings",
          state: currentRank > 3 ? "complete" : currentRank === 3 ? "active" : "pending",
        },
      ],
    };
  }, [activeAnalysisStage]);

  const displayedReanalysisFailure = useMemo(() => {
    if (analysisWorkActive || !reportReady) return null;
    return reanalysisFailureNotice || reanalysisFailureReason(candidate);
  }, [analysisWorkActive, candidate, reanalysisFailureNotice, reportReady]);

  useEffect(() => {
    if (!candidate || !analysisWorkActive) return;
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [analysisWorkActive, candidate, load]);

  useEffect(() => {
    if (!candidate || loading) return;
    if (wasAnalysisActiveRef.current && !analysisWorkActive) {
      const failureReason = reanalysisFailureReason(candidate);
      if (failureReason) {
        setReanalysisFailureNotice(failureReason);
        toast({
          title: "Re-analysis failed",
          description: "The previous report is still available.",
          variant: "destructive",
        });
      } else {
        setReanalysisFailureNotice(null);
        toast({
          title: "Re-analysis complete",
          description: "Project Intelligence has been refreshed.",
        });
        load();
      }
    }
    wasAnalysisActiveRef.current = analysisWorkActive;
  }, [analysisWorkActive, candidate, load, loading, toast]);

  const isAffirmative = (value: unknown) => {
    if (value === true) return true;
    if (typeof value !== "string") return false;
    return /^(yes|true|required|mandatory)$/i.test(value.trim());
  };

  const normalizeDateTimeText = (value: string | null | undefined) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;
    return formatProjectDateTimeOrNull(text) ?? text;
  };

  const isJobWalkFinding = (finding: Finding) => {
    const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
    return (
      haystack.includes("job walk") ||
      haystack.includes("pre-bid") ||
      haystack.includes("prebid") ||
      haystack.includes("site visit")
    );
  };

  const hasJobWalkDocumentEvidence = documents.some((document) => {
    const haystack = [
      document.file_name,
      document.document_class,
      document.document_family,
    ].join(" ").toLowerCase();
    return [
      "job walk",
      "pre-bid",
      "pre bid",
      "prebid",
      "site visit",
      "attendance list",
      "sign in",
      "sign-in",
    ].some((signal) => haystack.includes(signal));
  });

  const safeJobWalk = useMemo(() => {
    const finding = findings.find((item) =>
      (item.status === "found" || item.status === "needs_review" || item.status === "conflict") &&
      isJobWalkFinding(item) &&
      (citationsByFinding.get(item.id)?.length ?? 0) > 0
    );
    const citedDisplay = normalizeDateTimeText(finding?.value_text);
    if (citedDisplay) return citedDisplay;

    const metadataDisplay =
      normalizeDateTimeText(jobWalkAt) ||
      normalizeDateTimeText(preBidMeetingAt);
    if (metadataDisplay) return metadataDisplay;

    const hasMetadataEvidence =
      isAffirmative(crawl?.pre_bid_meeting) ||
      isAffirmative(crawl?.attendance_required) ||
      isAffirmative(crawl?.job_walk_exists) ||
      isAffirmative(crawl?.job_walk_mandatory);

    if (hasMetadataEvidence || hasJobWalkDocumentEvidence) return "Needs Review";
    return null;
  }, [citationsByFinding, crawl, documents, findings, hasJobWalkDocumentEvidence, jobWalkAt, preBidMeetingAt]);

  const handleAddToCalendar = async () => {
    if (!candidate) return;
    setAdding(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        navigate("/auth");
        return;
      }

      const sb = supabase as any;
      const scopeFinding = findings.find((f) => f.category === "scope_summary" && f.status === "found");

      const syncCandidateLink = async (projectId: string) => {
        const { error: updateError } = await sb
          .from("opportunity_candidates")
          .update({
            status: "converted",
            converted_project_id: projectId,
            opportunity_lifecycle_status: "added_to_calendar",
          })
          .eq("id", candidate.id);

        if (updateError) throw updateError;

        setCandidate((current) =>
          current
            ? {
                ...current,
                status: "converted",
                converted_project_id: projectId,
                opportunity_lifecycle_status: "added_to_calendar",
              }
            : current,
        );
      };

      const findExistingProject = async () => {
        const { data: freshCandidate, error: freshCandidateError } = await sb
          .from("opportunity_candidates")
          .select("converted_project_id")
          .eq("id", candidate.id)
          .maybeSingle();

        if (freshCandidateError) throw freshCandidateError;
        if (freshCandidate?.converted_project_id) {
          const { data: projectByCandidateLink, error: projectByCandidateLinkError } = await sb
            .from("projects")
            .select("id, origin, source_opportunity_candidate_id, opportunity_intelligence_report_id, bid_due_at")
            .eq("id", freshCandidate.converted_project_id)
            .maybeSingle();

          if (projectByCandidateLinkError) throw projectByCandidateLinkError;
          return projectByCandidateLink;
        }

        const { data: projectBySource, error: projectBySourceError } = await sb
          .from("projects")
          .select("id, origin, source_opportunity_candidate_id, opportunity_intelligence_report_id, bid_due_at")
          .eq("origin", "opportunity_intelligence")
          .eq("source_opportunity_candidate_id", candidate.id)
          .maybeSingle();

        if (projectBySourceError) throw projectBySourceError;
        return projectBySource;
      };

      const existingProject = await findExistingProject();
      if (existingProject?.id) {
        const projectUpdates: Record<string, string> = {};
        if (existingProject.origin !== "opportunity_intelligence") {
          projectUpdates.origin = "opportunity_intelligence";
        }
        if (!existingProject.source_opportunity_candidate_id) {
          projectUpdates.source_opportunity_candidate_id = candidate.id;
        }
        if (!existingProject.opportunity_intelligence_report_id && report?.id) {
          projectUpdates.opportunity_intelligence_report_id = report.id;
        }
        if (safeBidDue.value && existingProject.bid_due_at !== safeBidDue.value) {
          projectUpdates.bid_due_at = safeBidDue.value;
        }
        projectUpdates.project_lifecycle_status = "project_intelligence_ready";
        projectUpdates.project_intelligence_status = "ready";
        projectUpdates.project_intelligence_ready_at = new Date().toISOString();

        if (Object.keys(projectUpdates).length > 0) {
          const { error: projectLinkError } = await sb
            .from("projects")
            .update(projectUpdates)
            .eq("id", existingProject.id);

          if (projectLinkError) throw projectLinkError;
        }

        await syncCandidateLink(existingProject.id);
        navigate(`/projects/${existingProject.id}`);
        return;
      }

      if (!report?.id) {
        throw new Error("Project Intelligence report is required before adding this opportunity to the calendar.");
      }

      if (!safeBidDue.value) {
        toast({
          title: "Missing bid due date",
          description:
            "This opportunity has no bid due date. Open the source to confirm.",
          variant: "destructive",
        });
        return;
      }

      const { data: project, error } = await sb
        .from("projects")
        .insert({
          gc_id: session.user.id,
          name: candidate.raw_title ?? "Untitled Project",
          agency: candidate.agency,
          bid_due_at: safeBidDue.value,
          source_url: candidate.source_url,
          portal_type: candidate.portal_type,
          scope_text: scopeFinding?.value_text ?? candidate.scope_text,
          job_walk_at: jobWalkAt ?? null,
          origin: "opportunity_intelligence",
          source_opportunity_candidate_id: candidate.id,
          opportunity_intelligence_report_id: report.id,
          added_to_calendar_at: new Date().toISOString(),
          added_to_calendar_by: session.user.id,
          project_lifecycle_status: "project_intelligence_ready",
          project_intelligence_status: "ready",
          project_intelligence_ready_at: new Date().toISOString(),
          pursuit_status: "active",
          pursuit_status_updated_at: new Date().toISOString(),
          pursuit_status_updated_by: session.user.id,
          status: "LIVE",
        })
        .select("id")
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          const recoveredProject = await findExistingProject();
          if (recoveredProject?.id) {
            await syncCandidateLink(recoveredProject.id);
            navigate(`/projects/${recoveredProject.id}`);
            return;
          }
        }

        throw error;
      }

      await syncCandidateLink(project.id);

      toast({
        title: "Added to Calendar",
        description: "Project created and added to your active pursuits.",
      });
      navigate(`/projects/${project.id}`);
    } catch (e: any) {
      toast({
        title: "Failed to add",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const handleReanalyze = async () => {
    if (!candidate) return;
    if (analysisWorkActive) return;
    setReanalyzing(true);
    setReanalysisFailureNotice(null);
    try {
      const { data, error } = await supabase.functions.invoke("manage-opportunity-intelligence", {
        body: {
          action: "reanalyze",
          candidate_id: candidate.id,
        },
      });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? error?.message ?? "Failed to queue re-analysis");
      }
      toast({
        title: "Re-analysis queued",
        description: "BidBox will regenerate Project Intelligence from the current processed evidence.",
      });
      await load();
    } catch (e: any) {
      toast({
        title: "Failed to re-analyze",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDeleteAnalysis = async () => {
    if (!candidate) return;
    if (analysisWorkActive) return;
    setDeletingAnalysis(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-opportunity-intelligence", {
        body: {
          action: "delete_analysis",
          candidate_id: candidate.id,
        },
      });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? error?.message ?? "Failed to delete analysis");
      }
      toast({
        title: "Analysis deleted",
        description: "The opportunity was returned to Not Analyzed.",
      });
      navigate("/opportunities");
    } catch (e: any) {
      toast({
        title: "Failed to delete analysis",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingAnalysis(false);
    }
  };

  const pendingSectionMessage = useMemo(() => {
    if (!candidate) return "";
    switch (candidate.analysis_status) {
      case "queued":
        return "Project Intelligence is queued. The report will appear after document processing and report generation finish.";
      case "analyzing":
        return "Generating Project Intelligence from processed document evidence.";
      case "failed":
        return candidate.analysis_error ?? "Project Intelligence failed.";
      default:
        return "Project Intelligence has not been generated yet.";
    }
  }, [candidate]);

  if (loading) {
    return (
      <Layout showSidebar={true}>
        <div className="flex items-center justify-center min-h-[calc(100vh-4rem)]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!candidate) {
    return (
      <Layout showSidebar={true}>
        <div className="p-8">
          <Button variant="ghost" onClick={() => navigate("/opportunities")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Opportunities
          </Button>
          <p className="mt-8 text-muted-foreground">Opportunity not found.</p>
        </div>
      </Layout>
    );
  }

  const status = candidate.analysis_status;
  const executiveBullets = Array.isArray(report?.executive_summary?.bullets)
    ? report?.executive_summary?.bullets
    : [];

  return (
    <Layout showSidebar={true}>
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/opportunities")}
            className="mb-3 -ml-2"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Opportunities
          </Button>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground leading-tight">
                {candidate.raw_title ?? "Untitled Opportunity"}
              </h1>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded ${ANALYSIS_BADGE[status]}`}
                >
                  {status === "analyzing" || status === "queued" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : status === "ready" ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : status === "failed" ? (
                    <XCircle className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                  {ANALYSIS_LABEL[status]}
                </span>
                {report?.status && (
                  <span className="text-xs text-muted-foreground">
                    Report: {report.status}
                    {typeof report.confidence_score === "number"
                      ? ` · Confidence ${(report.confidence_score * 100).toFixed(0)}%`
                      : ""}
                  </span>
                )}
                {candidate.source_url && (
                  <a
                    href={candidate.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    Source <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>

            <Button
              size="lg"
              onClick={handleAddToCalendar}
              disabled={adding || (!reportReady && !candidate.converted_project_id)}
              className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90 disabled:opacity-40"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : candidate.converted_project_id ? (
                <ExternalLink className="h-4 w-4 mr-2" />
              ) : (
                <CalendarPlus className="h-4 w-4 mr-2" />
              )}
              {candidate.converted_project_id
                ? "View Project"
                : "Add Project to Calendar"}
            </Button>
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={reanalyzing || analysisWorkActive || !candidate}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Re-Analyze Project
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Re-Analyze Project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will regenerate Project Intelligence from the currently processed evidence. The current
                      report stays available while the new report runs, and it will only be replaced after the new report
                      succeeds.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReanalyze} disabled={reanalyzing || analysisWorkActive}>
                      {reanalyzing ? "Queueing..." : "Re-Analyze"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive hover:text-destructive" disabled={deletingAnalysis || analysisWorkActive || !candidate}>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Analysis
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Analysis?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove the Intelligence Report, findings, citations, source documents,
                      and processed document data. The opportunity will remain in Opportunities as Not Analyzed. Any
                      linked Opportunity Intelligence project, Calendar entry, and Bid HQ workspace will also be
                      removed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteAnalysis} disabled={deletingAnalysis || analysisWorkActive}>
                      {deletingAnalysis ? "Deleting..." : "Delete Analysis"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>

        {analysisWorkActive && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-blue-950">
            <div className="flex items-start gap-3">
              <Loader2 className="h-5 w-5 animate-spin mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Re-Analysis In Progress</p>
                <p className="text-sm text-blue-900">
                  Step {stageProgress.currentStep} of 3
                </p>
                <div className="mt-3 space-y-2">
                  {stageProgress.steps.map((step) => (
                    <div key={step.key} className="flex items-center gap-2 text-sm">
                      {step.state === "complete" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : step.state === "active" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-700" />
                      ) : (
                        <span className="h-4 w-4 rounded-full border border-blue-300" />
                      )}
                      <span className={step.state === "pending" ? "text-blue-700" : "font-medium"}>
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1 text-xs text-blue-800">
                  <p>This usually takes 2–5 minutes.</p>
                  <p>You can leave this page and come back later.</p>
                  <p>The current report will remain available until the new report is ready.</p>
                  {activeAnalysisStage === "complete" && (
                    <p className="font-medium">Refreshing report...</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {displayedReanalysisFailure && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-red-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-red-700" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Re-Analysis Failed</p>
                <p className="mt-1 text-sm">The previous report is still available.</p>
                <div className="mt-3 rounded-md border border-red-200 bg-white/70 p-3 text-sm">
                  <p className="font-medium">Reason:</p>
                  <p className="mt-1 break-words text-red-900">{displayedReanalysisFailure}</p>
                </div>
                <p className="mt-3 text-sm text-red-800">You may retry re-analysis at any time.</p>
              </div>
            </div>
          </div>
        )}

        {partialAcquisitionNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">Some source documents could not be acquired.</p>
                <p className="mt-1 text-sm">
                  BidBox successfully analyzed {partialAcquisitionNotice.analyzed} of {partialAcquisitionNotice.total} available documents.
                </p>
                <p className="mt-1 text-sm">
                  This report was generated using the successfully acquired documents. Missing supporting documents may be retried later.
                </p>
              </div>
            </div>
          </div>
        )}

        {!reportReady && (
          <Section title="Project Intelligence" icon={<Sparkles className="h-4 w-4" />}>
            <Pending message={pendingSectionMessage} />
            {candidate.analysis_status === "failed" && (
              <p className="mt-3 text-sm text-red-700">
                {candidate.analysis_error ?? report?.error}
              </p>
            )}
          </Section>
        )}

        <Section title="Executive Summary" icon={<Sparkles className="h-4 w-4" />}>
          {executiveBullets.length > 0 ? (
            <ul className="space-y-2 text-sm text-foreground">
              {executiveBullets.map((bullet: any, index: number) => (
                <li key={`${bullet.text}-${index}`} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[hsl(var(--bidbox-blue))] shrink-0" />
                  <span>{normalizeExecutiveBulletText(bullet.text, index, safeBidDue)}</span>
                </li>
              ))}
            </ul>
          ) : reportReady ? (
            <Unknown message="No cited executive summary was generated." />
          ) : (
            <Pending message={pendingSectionMessage} />
          )}
        </Section>

        <Section title="Project Snapshot" icon={<FileText className="h-4 w-4" />}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <Field label="Agency" value={candidate.agency} />
            <Field label="Department" value={department} />
            <Field label="Bid Due" value={safeBidDue.display} />
            <Field label="Job Walk / Pre-Bid" value={safeJobWalk} />
            <Field
              label="Estimated Value"
              value={
                typeof estimatedValue === "number" && estimatedValue > 0
                  ? `$${estimatedValue.toLocaleString("en-US")}`
                  : null
              }
            />
            <Field label="Required License" value={licenseRequirements} />
            <Field label="Contract Duration" value={contractDuration} />
            <Field label="Liquidated Damages" value={liquidatedDamages} />
            <Field label="Location" value={projectAddress} />
            <Field label="Portal" value={candidate.portal_type} />
          </dl>
          {safeBidDue.source && (
            <p className="mt-3 text-xs text-muted-foreground">
              Bid due source: {safeBidDue.source}
            </p>
          )}
          {safeBidDue.warning && (
            <details className="mt-3 rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-950">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-medium">
                <span className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Conflicting deadline evidence detected
                </span>
                <span className="text-xs text-yellow-800">
                  View Conflicting Evidence ({bidDueEvidence.competing.length})
                </span>
              </summary>
              <div className="border-t border-yellow-200 px-3 py-3">
                <div className="rounded bg-white/70 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-yellow-800">
                    Selected as Authoritative
                  </p>
                  <p className="mt-1 font-medium text-foreground">{bidDueEvidence.selected.label}</p>
                  <p className="text-sm text-foreground">{bidDueEvidence.selected.display}</p>
                  {bidDueEvidence.selected.detail && (
                    <p className="mt-1 text-xs text-muted-foreground">{bidDueEvidence.selected.detail}</p>
                  )}
                </div>

                {bidDueEvidence.competing.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-yellow-800">
                      Competing Evidence
                    </p>
                    {bidDueEvidence.competing.map((evidence) => (
                      <div key={evidence.id} className="rounded bg-white/70 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{evidence.label}</p>
                          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLE[evidence.status]}`}>
                            {evidence.status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">{evidence.display}</p>
                        <CitationList citations={evidence.citations} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
        </Section>

        {REPORT_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Section key={section.key} title={section.title} icon={<Icon className="h-4 w-4" />}>
              <FindingsList
                findings={displayedFindingsByCategory.get(section.key) ?? []}
                citationsByFinding={citationsByFinding}
                pendingMessage={pendingSectionMessage}
                ready={Boolean(reportReady)}
              />
            </Section>
          );
        })}

        <Section title="Source Documents" icon={<FileText className="h-4 w-4" />}>
          {documents.length === 0 ? (
            <Pending message="Documents have not been acquired yet." />
          ) : (
            <ul className="space-y-2 text-sm">
              {documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 border border-border rounded p-2.5"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {d.file_name ?? "Untitled document"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[d.document_class, d.document_family]
                        .filter(Boolean)
                        .join(" · ") || "Uncategorized"}
                      {typeof d.text_page_count === "number"
                        ? ` · ${d.text_page_count} pages`
                        : ""}
                    </p>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {d.processing_status ?? "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Layout>
  );
};

const Section = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="bg-card border border-border rounded-lg p-5">
    <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
      {icon}
      {title}
    </h2>
    {children}
  </section>
);

const Field = ({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) => (
  <div>
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground mt-0.5">{value ?? "—"}</dd>
  </div>
);

const FindingsList = ({
  findings,
  citationsByFinding,
  pendingMessage,
  ready,
}: {
  findings: Finding[];
  citationsByFinding: Map<string, Citation[]>;
  pendingMessage: string;
  ready: boolean;
}) => {
  if (!ready) return <Pending message={pendingMessage} />;
  if (findings.length === 0) {
    return <Unknown message="No cited findings were generated for this section." />;
  }

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <article
          key={finding.id}
          className="border border-border rounded-md p-3 bg-background"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">
                  {finding.label}
                </h3>
                {finding.is_critical && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-700">
                    <ShieldAlert className="h-3 w-3" />
                    Critical
                  </span>
                )}
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLE[finding.status]}`}>
                  {finding.status.replace("_", " ")}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {finding.confidence} confidence
                </span>
              </div>
              <p className="text-sm text-foreground mt-1 whitespace-pre-wrap">
                {finding.status === "found" || finding.status === "conflict"
                  ? finding.value_text ?? "Value captured in structured data"
                  : finding.notes ?? "Not found in processed documents."}
              </p>
              {finding.id.startsWith("__structured_") && finding.notes && (
                <p className="mt-1 text-xs text-muted-foreground">{finding.notes}</p>
              )}
            </div>
          </div>

          {!finding.id.startsWith("__structured_") && (
            <CitationList citations={citationsByFinding.get(finding.id) ?? []} />
          )}
        </article>
      ))}
    </div>
  );
};

const CitationList = ({ citations }: { citations: Citation[] }) => {
  if (citations.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground italic">
        No citation attached. This item is not presented as a source-backed fact.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {citations.map((citation) => (
        <details key={citation.id} className="group">
          <summary className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--bidbox-blue))] hover:underline">
            <FileText className="h-3 w-3" />
            {citation.citation_label ??
              `${citation.source_document_name}${citation.page_number ? `, p. ${citation.page_number}` : ""}`}
          </summary>
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground leading-relaxed">
            {citation.source_excerpt}
          </blockquote>
        </details>
      ))}
    </div>
  );
};

const Pending = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />
    <p>{message}</p>
  </div>
);

const Unknown = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 text-sm text-muted-foreground">
    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
    <p>{message}</p>
  </div>
);

export default OpportunityReport;
