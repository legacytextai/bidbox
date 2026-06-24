import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { resolveAuthoritativeBidDue, dateIdentity } from "@/lib/bidDueResolver";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import {
  DEFAULT_PROJECT_TIMEZONE,
  TIMEZONE_OPTIONS,
  formatProjectDateTime,
  formatProjectDateTimeOrNull,
  localDateTimeToUtc,
  utcToLocalDateTime,
} from "@/lib/timezoneUtils";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileDropzone } from "@/components/FileDropzone";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { BidReadinessChecklist } from "@/components/BidReadinessChecklist";
import { BidListButton } from "@/components/BidListButton";
import { CallListButton } from "@/components/CallListButton";
import { TradeType, getCategoryColor } from "@/lib/tradeTypes";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface ProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

interface Submission {
  submission_id: string;
  submitted_at: string;
  bidder_name?: string;
  company_name?: string;
  email?: string;
  bid_item?: string;
  files: {
    file_name: string;
    file_url: string;
  }[];
}

interface ProjectTrade {
  id: string;
  trade_type_id: string;
  trade_types: TradeType;
}

interface SourceOpportunity {
  id: string;
  raw_title: string | null;
  agency: string | null;
  bid_due_at: string | null;
  crawl_data: any | null;
}

interface IntelligenceReport {
  id: string;
  title: string | null;
  executive_summary: any;
  status: string;
}

interface IntelligenceFinding {
  id: string;
  category: string;
  field_key: string;
  label: string;
  value_text: string | null;
  value_jsonb: any | null;
  status: string;
  confidence: string;
  is_critical: boolean;
  sort_order: number;
}

interface IntelligenceCitation {
  id: string;
  finding_id: string;
  source_document_name: string;
  page_number: number | null;
  page_label: string | null;
  source_excerpt: string;
  citation_label: string | null;
}

interface OpportunityDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  file_type: string | null;
  document_family: string | null;
  document_class: string | null;
  acquisition_status: string;
  processing_status: string;
  storage_bucket: string;
  storage_path: string | null;
  source_url: string | null;
}

interface OpportunityIntelligenceWorkspaceProps {
  project: any;
  sourceOpportunity: SourceOpportunity | null;
  intelligenceReport: IntelligenceReport | null;
  findings: IntelligenceFinding[];
  citations: IntelligenceCitation[];
  opportunityDocuments: OpportunityDocument[];
  projectFiles: ProjectFile[];
  projectTrades: ProjectTrade[];
  submissions: Submission[];
  copied: boolean;
  newFiles: File[];
  currentUpload: string | null;
  isUploading: boolean;
  editingTrades: boolean;
  editedTradeIds: string[];
  savingTrades: boolean;
  onCopyBidLink: () => void;
  onFilesSelected: (files: File[]) => void;
  onUploadFiles: () => void;
  onDownloadInternalFile: (filePath: string, fileName: string) => void;
  onDeleteInternalFile: (fileId: string, filePath: string) => void;
  onDownloadBid: (filePath: string, fileName: string) => void;
  onDeleteSubmission: (submissionId: string) => void;
  onOverrideBidDueDate: (override: {
    bidDueAt: string;
    source: "manual" | "deadline_candidate";
    reason: string | null;
  }) => Promise<void>;
  onOverrideJobWalkDate: (override: {
    jobWalkAt: string;
    reason: string | null;
  }) => Promise<void>;
  onEditingTradesChange: (open: boolean) => void;
  onEditedTradeIdsChange: (ids: string[]) => void;
  onSaveTrades: () => void;
}

const normalizeDateTimeText = (value: string | null | undefined) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return formatProjectDateTimeOrNull(text) ?? text;
};

const formatCurrency = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
  }
  return null;
};

const formatFileSize = (size: number | null) => {
  if (!size) return "Size unavailable";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const getExecutiveBulletText = (bullet: any) => {
  if (typeof bullet === "string") return bullet;
  if (typeof bullet?.text === "string") return bullet.text;
  return null;
};

const normalizeLabel = (value: string) =>
  value.replace(/[_-]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const getFindingValue = (finding: IntelligenceFinding | undefined) => {
  if (!finding) return null;
  if (finding.status !== "found" && finding.status !== "needs_review" && finding.status !== "conflict") return null;
  return finding.value_text || null;
};

const findFirst = (findings: IntelligenceFinding[], keys: string[], categories?: string[]) =>
  findings.find((finding) => {
    const keyMatches = keys.some((key) =>
      finding.field_key?.toLowerCase().includes(key) ||
      finding.label?.toLowerCase().includes(key),
    );
    const categoryMatches = !categories || categories.includes(finding.category);
    return keyMatches && categoryMatches;
  });

const isBidDueFinding = (finding: IntelligenceFinding) => {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    /bid.*due/.test(haystack) ||
    /due.*date/.test(haystack) ||
    /bid.*opening/.test(haystack) ||
    /submission.*deadline/.test(haystack)
  );
};

const bidDueSourceLabel = (source: string | null | undefined) => {
  if (source === "manual") return "Manually Overridden";
  if (source === "deadline_candidate") return "Selected From Evidence";
  return null;
};

const MONTH_INDEX: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const normalizeHour = (hour12: string, meridiem: string) => {
  let hour = Number(hour12);
  if (!Number.isFinite(hour)) return null;
  const upper = meridiem.toUpperCase();
  if (upper === "PM" && hour !== 12) hour += 12;
  if (upper === "AM" && hour === 12) hour = 0;
  return hour;
};

const TZ_ABBR_MAP: Record<string, string> = {
  PT: "America/Los_Angeles",
  PST: "America/Los_Angeles",
  PDT: "America/Los_Angeles",
  PACIFIC: "America/Los_Angeles",
  MT: "America/Denver",
  MST: "America/Denver",
  MDT: "America/Denver",
  MOUNTAIN: "America/Denver",
  CT: "America/Chicago",
  CST: "America/Chicago",
  CDT: "America/Chicago",
  CENTRAL: "America/Chicago",
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  EASTERN: "America/New_York",
};

const buildLocalDateTime = (
  year: string | number,
  month: string | number,
  day: string | number,
  hour: number,
  minute: string | number,
) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

const coerceEvidenceDeadlineToUtc = (value: string | null | undefined, timezone: string) => {
  let text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // 1. Normalize meridiems: "a.m." / "a m" / "am" → "AM"; same for PM.
  text = text
    .replace(/\ba\.?\s*m\.?\b/gi, "AM")
    .replace(/\bp\.?\s*m\.?\b/gi, "PM");

  // 2. Detect & strip a trailing timezone abbreviation. Map to IANA zone.
  let resolvedTimezone = timezone;
  const tzMatch = text.match(
    /\s+(PT|PST|PDT|Pacific|MT|MST|MDT|Mountain|CT|CST|CDT|Central|ET|EST|EDT|Eastern)\b\.?/i,
  );
  if (tzMatch) {
    const mapped = TZ_ABBR_MAP[tzMatch[1].toUpperCase()];
    if (mapped) resolvedTimezone = mapped;
    text = (text.slice(0, tzMatch.index) + text.slice(tzMatch.index! + tzMatch[0].length)).trim();
  }

  // 3. Normalize " at " separator and collapse whitespace.
  text = text.replace(/\s+at\s+/gi, " ").replace(/\s+/g, " ").trim();

  // 4. Try patterns in order.

  // ISO date: YYYY-MM-DD[ T]HH:MM(:SS)?( AM|PM)?
  const iso = text.match(
    /\b(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::\d{2})?(?:\s*(AM|PM))?\b/i,
  );
  if (iso) {
    const [, year, month, day, hourText, minute, meridiem] = iso;
    let hour: number | null;
    if (meridiem) {
      hour = normalizeHour(hourText, meridiem);
    } else {
      const h = Number(hourText);
      hour = Number.isFinite(h) ? h : null;
    }
    if (hour !== null) {
      return localDateTimeToUtc(buildLocalDateTime(year, month, day, hour, minute), resolvedTimezone);
    }
  }

  // Slash date: M/D/YYYY H(:MM)? AM|PM
  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (slash) {
    const [, month, day, year, hourText, minute = "0", meridiem] = slash;
    const hour = normalizeHour(hourText, meridiem);
    if (hour !== null) {
      return localDateTimeToUtc(buildLocalDateTime(year, month, day, hour, minute), resolvedTimezone);
    }
  }

  // Month-name date: January D, YYYY H(:MM)? AM|PM
  const monthName = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i,
  );
  if (monthName) {
    const [, monthLabel, day, year, hourText, minute = "0", meridiem] = monthName;
    const hour = normalizeHour(hourText, meridiem);
    const month = MONTH_INDEX[monthLabel.toLowerCase()];
    if (hour !== null && month) {
      return localDateTimeToUtc(buildLocalDateTime(year, month, day, hour, minute), resolvedTimezone);
    }
  }

  // Last-resort fallback only if everything above failed.
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return null;
};

const hasDocumentNameEvidence = (documents: OpportunityDocument[], keywords: string[]) =>
  documents.some((document) => {
    const haystack = [
      document.file_name,
      document.document_family,
      document.document_class,
    ].join(" ").toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword));
  });

const isAffirmative = (value: unknown) => {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return /^(yes|true|required|mandatory)$/i.test(value.trim());
};

const isCriticalRequirementFinding = (finding: IntelligenceFinding) => {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  const requirementSignals = [
    "license",
    "bid bond",
    "performance bond",
    "payment bond",
    "insurance",
    "dir",
    "prevailing wage",
    "prequalification",
    "pre-bid",
    "prebid",
    "job walk",
    "site visit",
    "subcontractor listing",
    "bid form",
    "addenda acknowledgement",
  ];
  return finding.category === "bid_requirements" && requirementSignals.some((signal) => haystack.includes(signal));
};

const isRiskFinding = (finding: IntelligenceFinding) => {
  const haystack = `${finding.field_key} ${finding.label} ${finding.value_text ?? ""}`.toLowerCase();
  const riskSignals = [
    "liquidated damages",
    "utility",
    "restricted access",
    "environmental",
    "bmp",
    "schedule",
    "long lead",
    "dsa",
    "inspection",
    "hazard",
    "night work",
    "traffic control",
  ];
  return finding.category === "risk_flags" || riskSignals.some((signal) => haystack.includes(signal));
};

export function OpportunityIntelligenceWorkspace({
  project,
  sourceOpportunity,
  intelligenceReport,
  findings,
  citations,
  opportunityDocuments,
  projectFiles,
  projectTrades,
  submissions,
  copied,
  newFiles,
  currentUpload,
  isUploading,
  editingTrades,
  editedTradeIds,
  savingTrades,
  onCopyBidLink,
  onFilesSelected,
  onUploadFiles,
  onDownloadInternalFile,
  onDeleteInternalFile,
  onDownloadBid,
  onDeleteSubmission,
  onOverrideBidDueDate,
  onOverrideJobWalkDate,
  onEditingTradesChange,
  onEditedTradeIdsChange,
  onSaveTrades,
}: OpportunityIntelligenceWorkspaceProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [deletingProject, setDeletingProject] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [selectedEvidenceValue, setSelectedEvidenceValue] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState("");
  const [manualTime, setManualTime] = useState("");
  const [manualTimezone, setManualTimezone] = useState(project.timezone || DEFAULT_PROJECT_TIMEZONE);
  const [manualReason, setManualReason] = useState("");
  const [savingBidDueOverride, setSavingBidDueOverride] = useState(false);
  const [jobWalkOverrideOpen, setJobWalkOverrideOpen] = useState(false);
  const [jobWalkDate, setJobWalkDate] = useState("");
  const [jobWalkTime, setJobWalkTime] = useState("");
  const [jobWalkTimezone, setJobWalkTimezone] = useState(project.timezone || DEFAULT_PROJECT_TIMEZONE);
  const [jobWalkReason, setJobWalkReason] = useState("");
  const [savingJobWalkOverride, setSavingJobWalkOverride] = useState(false);
  const [countdown, setCountdown] = useState("");
  const [isExpired, setIsExpired] = useState(false);

  useEffect(() => {
    const bidDueAt = bidDueResolution.value;
    if (!bidDueAt) {
      setCountdown("");
      setIsExpired(false);
      return;
    }

    const interval = setInterval(() => {
      const now = new Date();
      const dueDate = new Date(bidDueAt);
      const diff = dueDate.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("EXPIRED");
        setIsExpired(true);
        clearInterval(interval);
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(
        `${days.toString().padStart(2, "0")}d:${hours
          .toString()
          .padStart(2, "0")}h:${minutes.toString().padStart(2, "0")}m:${seconds
          .toString()
          .padStart(2, "0")}s`,
      );
      setIsExpired(false);
    }, 1000);

    return () => clearInterval(interval);
  }, [bidDueResolution.value]);

  const reportOpportunityId = project.source_opportunity_candidate_id || sourceOpportunity?.id;
  const bidRoomUrl = `${window.location.origin}/bid/${project.public_token}`;
  const projectTimezone = project.timezone || DEFAULT_PROJECT_TIMEZONE;
  const citationsByFinding = useMemo(() => {
    const map = new Map<string, IntelligenceCitation[]>();
    citations.forEach((citation) => {
      const list = map.get(citation.finding_id) ?? [];
      list.push(citation);
      map.set(citation.finding_id, list);
    });
    return map;
  }, [citations]);

  const bidDueFindings = useMemo(
    () =>
      findings.filter((finding) => {
        const statusSupportsFact = finding.status === "found" || finding.status === "conflict";
        return statusSupportsFact && isBidDueFinding(finding);
      }),
    [findings],
  );

  const bidDueResolution = useMemo(
    () =>
      resolveAuthoritativeBidDue({
        overrideBidDueAt: project?.bid_due_override_at,
        overrideSource: project?.bid_due_override_source,
        dueDateRaw: sourceOpportunity?.crawl_data?.due_date_raw,
        candidateBidDueAt: sourceOpportunity?.bid_due_at,
        projectBidDueAt: project?.bid_due_at,
        f4ValueText: getFindingValue(findFirst(findings, ["bid due", "bid date", "deadline"], ["key_dates"])),
      }),
    [
      findings,
      project?.bid_due_at,
      project?.bid_due_override_at,
      project?.bid_due_override_source,
      sourceOpportunity?.bid_due_at,
      sourceOpportunity?.crawl_data?.due_date_raw,
    ],
  );

  const bidDueEvidenceOptions = useMemo(() => {
    const options: Array<{
      id: string;
      label: string;
      display: string;
      value: string;
      detail?: string | null;
    }> = [];

    const addOption = (option: { id: string; label: string; display: string; value: string; detail?: string | null }) => {
      if (!option.value || options.some((existing) => existing.value === option.value && existing.label === option.label)) return;
      options.push(option);
    };

    if (bidDueResolution.value && bidDueResolution.display !== "—") {
      addOption({
        id: "authoritative",
        label: project?.bid_due_override_source === "manual"
          ? "Current Manual Override"
          : project?.bid_due_override_source === "deadline_candidate"
            ? project?.bid_due_override_reason || "Current Selected Evidence"
            : "Current Authoritative Deadline",
        display: bidDueResolution.display,
        value: bidDueResolution.value,
        detail: sourceOpportunity?.crawl_data?.due_date_raw
          ? `Raw portal value: ${sourceOpportunity.crawl_data.due_date_raw}`
          : null,
      });
    }

    bidDueFindings.forEach((finding) => {
      const findingCitations = citationsByFinding.get(finding.id) ?? [];
      const firstCitation = findingCitations[0];
      const label =
        firstCitation?.citation_label ||
        (firstCitation
          ? `${firstCitation.source_document_name}${firstCitation.page_number ? `, p. ${firstCitation.page_number}` : ""}`
          : finding.label);
      const display = formatProjectDateTimeOrNull(finding.value_text) || finding.value_text;
      if (display && finding.value_text) {
        addOption({
          id: finding.id,
          label,
          display,
          value: finding.value_text,
          detail: firstCitation?.source_excerpt,
        });
      }
    });

    return options;
  }, [
    bidDueFindings,
    bidDueResolution.display,
    bidDueResolution.value,
    citationsByFinding,
    project?.bid_due_override_reason,
    project?.bid_due_override_source,
    sourceOpportunity?.crawl_data,
  ]);

  const bidDueConflictPanel = useMemo(() => {
    const authoritativeSourceLabel = (() => {
      if (project?.bid_due_override_source === "manual") return "Manual Override";
      if (project?.bid_due_override_source === "deadline_candidate") {
        return project?.bid_due_override_reason || "Selected Evidence";
      }
      if (sourceOpportunity?.crawl_data?.due_date_raw) return "Portal Metadata";
      if (sourceOpportunity?.bid_due_at) return "Portal Metadata";
      return "Project Metadata";
    })();

    const authoritativeDateId = dateIdentity(bidDueResolution.value);

    const competing = bidDueFindings
      .map((finding) => {
        const findingCitations = citationsByFinding.get(finding.id) ?? [];
        const firstCitation = findingCitations[0];
        const label =
          firstCitation?.citation_label ||
          (firstCitation
            ? `${firstCitation.source_document_name}${firstCitation.page_number ? `, p. ${firstCitation.page_number}` : ""}`
            : finding.label);
        const display = formatProjectDateTimeOrNull(finding.value_text) || finding.value_text || null;
        const excerpt = firstCitation?.source_excerpt || null;
        const findingDateId = dateIdentity(finding.value_text);
        return {
          id: finding.id,
          label,
          display,
          excerpt,
          matchesAuthoritative:
            Boolean(authoritativeDateId && findingDateId && authoritativeDateId === findingDateId),
        };
      })
      .filter((item) => Boolean(item.display));

    const hasDifferingEvidence = competing.some((item) => !item.matchesAuthoritative);
    const shouldRender = bidDueResolution.conflict || hasDifferingEvidence;

    return {
      shouldRender,
      authoritativeSourceLabel,
      authoritativeDisplay: bidDueResolution.display,
      competing,
    };
  }, [
    bidDueFindings,
    bidDueResolution.conflict,
    bidDueResolution.display,
    bidDueResolution.value,
    citationsByFinding,
    project?.bid_due_override_reason,
    project?.bid_due_override_source,
    sourceOpportunity?.bid_due_at,
    sourceOpportunity?.crawl_data?.due_date_raw,
  ]);



  const snapshot = useMemo(() => {
    const overviewBullet = Array.isArray(intelligenceReport?.executive_summary?.bullets)
      ? intelligenceReport.executive_summary.bullets
          .map(getExecutiveBulletText)
          .find((text): text is string => Boolean(text))
      : null;

    const projectOverview =
      overviewBullet?.replace(/^Project Overview:\s*/i, "") ||
      getFindingValue(findings.find((finding) => finding.category === "project_overview")) ||
      "Project overview is available in the full Intelligence Report.";

    const estimateFinding = findFirst(findings, ["engineer estimate", "engineer's estimate", "estimated value", "estimate"]);
    const licenseFinding = findFirst(findings, ["license"], ["bid_requirements", "project_overview"]);
    const durationFinding = findFirst(findings, ["duration", "calendar days", "working days"], ["key_dates", "bid_requirements"]);
    const damagesFinding = findFirst(findings, ["liquidated damages", "damages"], ["risk_flags", "bid_requirements"]);
    const jobWalkFinding = findFirst(findings, ["job walk", "pre-bid", "prebid"], ["key_dates"]);
    const jobWalkMetadata =
      sourceOpportunity?.crawl_data?.job_walk_at ||
      sourceOpportunity?.crawl_data?.pre_bid_meeting_at ||
      sourceOpportunity?.crawl_data?.prebid_meeting_at;
    const hasJobWalkMetadata =
      Boolean(jobWalkMetadata) ||
      isAffirmative(sourceOpportunity?.crawl_data?.pre_bid_meeting) ||
      isAffirmative(sourceOpportunity?.crawl_data?.job_walk_exists) ||
      isAffirmative(sourceOpportunity?.crawl_data?.attendance_required) ||
      isAffirmative(sourceOpportunity?.crawl_data?.job_walk_mandatory);
    const hasJobWalkDocumentEvidence = hasDocumentNameEvidence(opportunityDocuments, [
      "job walk",
      "pre-bid",
      "pre bid",
      "prebid",
      "site visit",
      "attendance list",
      "sign in",
      "sign-in",
    ]);

    const jobWalkValue =
      normalizeDateTimeText(getFindingValue(jobWalkFinding)) ||
      normalizeDateTimeText(jobWalkMetadata);

    return {
      projectOverview,
      engineerEstimate:
        getFindingValue(estimateFinding) ||
        formatCurrency(sourceOpportunity?.crawl_data?.estimated_value) ||
        "Not available",
      requiredLicense:
        getFindingValue(licenseFinding) ||
        sourceOpportunity?.crawl_data?.license_requirements ||
        "Not available",
      contractDuration:
        getFindingValue(durationFinding) ||
        sourceOpportunity?.crawl_data?.contract_duration ||
        "Not available",
      liquidatedDamages:
        getFindingValue(damagesFinding) ||
        sourceOpportunity?.crawl_data?.liquidated_damages ||
        "Not available",
      bidDue:
        bidDueResolution.display || "Not available",
      jobWalk:
        normalizeDateTimeText(jobWalkValue) ||
        formatProjectDateTimeOrNull(project.job_walk_at) ||
        (hasJobWalkMetadata || hasJobWalkDocumentEvidence ? "Needs Review" : "Not available"),
    };
  }, [bidDueResolution.display, findings, intelligenceReport, opportunityDocuments, project.job_walk_at, sourceOpportunity]);

  const highlighted = useMemo(() => {
    const found = findings.filter((finding) =>
      finding.status === "found" || finding.status === "needs_review" || finding.status === "conflict",
    );

    return {
      criticalRequirements: found
        .filter(isCriticalRequirementFinding)
        .slice(0, 5),
      risks: found
        .filter(isRiskFinding)
        .slice(0, 5),
      trades: found
        .filter((finding) => finding.category === "trade_breakdown" || finding.category === "scope_summary")
        .slice(0, 5),
    };
  }, [findings]);

  const overrideBadge = bidDueSourceLabel(project?.bid_due_override_source);

  const saveSelectedEvidenceOverride = async () => {
    const selected = bidDueEvidenceOptions.find((option) => option.id === selectedEvidenceValue);
    if (!selected) {
      toast({
        title: "Select deadline evidence",
        description: "Choose an evidence item first, or set the deadline manually.",
        variant: "destructive",
      });
      return;
    }

    const utcValue = coerceEvidenceDeadlineToUtc(selected.value, projectTimezone);
    if (!utcValue) {
      toast({
        title: "Could not parse deadline",
        description: "Use Set Manually for this evidence item.",
        variant: "destructive",
      });
      return;
    }

    setSavingBidDueOverride(true);
    try {
      await onOverrideBidDueDate({
        bidDueAt: utcValue,
        source: "deadline_candidate",
        reason: selected.label,
      });
      setOverrideOpen(false);
    } finally {
      setSavingBidDueOverride(false);
    }
  };

  const saveManualOverride = async () => {
    if (!manualDate || !manualTime) {
      toast({
        title: "Date and time required",
        description: "Choose both a date and time before saving.",
        variant: "destructive",
      });
      return;
    }

    setSavingBidDueOverride(true);
    try {
      await onOverrideBidDueDate({
        bidDueAt: localDateTimeToUtc(`${manualDate}T${manualTime}`, manualTimezone || projectTimezone),
        source: "manual",
        reason: manualReason.trim() || null,
      });
      setOverrideOpen(false);
      setManualReason("");
    } finally {
      setSavingBidDueOverride(false);
    }
  };

  const openJobWalkOverride = () => {
    const tz = project.timezone || DEFAULT_PROJECT_TIMEZONE;
    const existing = project.job_walk_at as string | null | undefined;
    if (existing) {
      const local = utcToLocalDateTime(existing, tz);
      const [d, t] = local.split("T");
      setJobWalkDate(d ?? "");
      setJobWalkTime(t ?? "");
    } else {
      setJobWalkDate("");
      setJobWalkTime("");
    }
    setJobWalkTimezone(tz);
    setJobWalkReason(project.job_walk_override_reason ?? "");
    setJobWalkOverrideOpen(true);
  };

  const saveJobWalkOverride = async () => {
    if (!jobWalkDate || !jobWalkTime) {
      toast({
        title: "Date and time required",
        description: "Choose both a date and time before saving.",
        variant: "destructive",
      });
      return;
    }

    setSavingJobWalkOverride(true);
    try {
      await onOverrideJobWalkDate({
        jobWalkAt: localDateTimeToUtc(`${jobWalkDate}T${jobWalkTime}`, jobWalkTimezone || projectTimezone),
        reason: jobWalkReason.trim() || null,
      });
      setJobWalkOverrideOpen(false);
    } finally {
      setSavingJobWalkOverride(false);
    }
  };

  const downloadSourceDocument = async (sourceDocument: OpportunityDocument) => {
    if (!sourceDocument.storage_path) {
      toast({
        title: "Document unavailable",
        description: "No stored file path is available for this source document.",
        variant: "destructive",
      });
      return;
    }

    const { data, error } = await supabase.storage
      .from(sourceDocument.storage_bucket || "opportunity-documents")
      .download(sourceDocument.storage_path);

    if (error || !data) {
      toast({
        title: "Download failed",
        description: "Could not download the source document.",
        variant: "destructive",
      });
      return;
    }

    const url = URL.createObjectURL(data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sourceDocument.file_name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const renderFindingList = (items: IntelligenceFinding[], empty: string) => {
    if (items.length === 0) {
      return <p className="text-sm text-muted-foreground">{empty}</p>;
    }

    return (
      <div className="space-y-3">
        {items.map((finding) => (
          <div key={finding.id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-foreground">{finding.label}</p>
              {finding.status !== "found" && (
                <Badge variant="outline" className="shrink-0">
                  {normalizeLabel(finding.status)}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
              {finding.value_text || "Review in full report."}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const handleDeleteProject = async () => {
    setDeletingProject(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-opportunity-intelligence", {
        body: {
          action: "delete_project",
          project_id: project.id,
        },
      });
      if (error || data?.success === false) {
        throw new Error(data?.error ?? error?.message ?? "Failed to delete project");
      }
      toast({
        title: "Project deleted",
        description: "The Intelligence Report remains available from Opportunities.",
      });
      navigate("/projects");
    } catch (e: any) {
      toast({
        title: "Failed to delete project",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDeletingProject(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <Button variant="ghost" onClick={() => navigate("/projects")} className="mb-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Projects
      </Button>

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Opportunity Intelligence</Badge>
              <Badge variant={project.status === "LIVE" ? "default" : "outline"}>
                {project.status === "LIVE" ? "Active" : normalizeLabel(project.status || "Unknown")}
              </Badge>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground">{project.name}</h1>
              <p className="text-sm text-muted-foreground">
                {[project.agency, project.county].filter(Boolean).join(" · ") || "Agency details unavailable"}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {reportOpportunityId && (
              <Button
                onClick={() => navigate(`/opportunities/${reportOpportunityId}`)}
                className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                View Intelligence Report
              </Button>
            )}
            {project.source_url && (
              <Button variant="outline" onClick={() => window.open(project.source_url, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-4 w-4 mr-2" />
                Source Portal
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/calendar")}>
              <CalendarDays className="h-4 w-4 mr-2" />
              Open Calendar
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive" disabled={deletingProject}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Project
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will remove the project from Projects, Calendar, and Bid HQ. The Intelligence Report will remain available.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteProject} disabled={deletingProject}>
                    {deletingProject ? "Deleting..." : "Delete Project"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Due</p>
            <p className="font-medium">{snapshot.bidDue}</p>
            {overrideBadge && (
              <p className="mt-1 text-xs text-[hsl(var(--bidbox-blue))]">
                {overrideBadge}
                {project.bid_due_override_reason ? `: ${project.bid_due_override_reason}` : ""}
              </p>
            )}
            {bidDueConflictPanel.shouldRender && (
              <Collapsible className="mt-3">
                <div className="flex items-center gap-2 text-xs text-amber-600">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  <span>Conflicting deadline evidence detected</span>
                </div>
                <CollapsibleTrigger className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--bidbox-blue))] hover:underline data-[state=open]:[&>svg]:rotate-180">
                  View Conflicting Evidence
                  <ChevronDown className="h-3.5 w-3.5 transition-transform" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-3 rounded-md border border-border bg-muted/30 p-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Selected as Authoritative
                    </p>
                    <p className="mt-0.5 text-sm font-medium text-foreground">
                      {bidDueConflictPanel.authoritativeSourceLabel}
                    </p>
                    <p className="text-sm text-foreground">{bidDueConflictPanel.authoritativeDisplay}</p>
                  </div>
                  {bidDueConflictPanel.competing.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Competing Evidence
                      </p>
                      <div className="mt-2 space-y-3">
                        {bidDueConflictPanel.competing.map((item) => (
                          <div key={item.id} className="text-sm">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-foreground">{item.label}</p>
                              {item.matchesAuthoritative && (
                                <Badge variant="outline" className="border-[hsl(var(--bidbox-blue))] text-[hsl(var(--bidbox-blue))]">
                                  Currently Authoritative
                                </Badge>
                              )}
                            </div>
                            <p className="text-foreground">{item.display}</p>
                            {item.excerpt && (
                              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.excerpt}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
            <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="mt-3">
                  Edit Bid Due Date
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Bid Due Date</DialogTitle>
                  <DialogDescription>
                    Select a cited deadline or set the date manually. The project, calendar, and Bid HQ will use the saved value.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-semibold">Use Existing Evidence</h3>
                    {bidDueEvidenceOptions.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No cited deadline evidence is available. Set the deadline manually instead.
                      </p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {bidDueEvidenceOptions.map((option) => (
                          <label key={option.id} className="flex cursor-pointer gap-3 rounded border border-border p-3">
                            <input
                              type="radio"
                              name="bid-due-evidence"
                              value={option.id}
                              checked={selectedEvidenceValue === option.id}
                              onChange={() => setSelectedEvidenceValue(option.id)}
                              className="mt-1"
                            />
                            <span>
                              <span className="block text-sm font-medium text-foreground">{option.label}</span>
                              <span className="block text-sm text-foreground">{option.display}</span>
                              {option.detail && (
                                <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                                  {option.detail}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <Button
                      type="button"
                      className="mt-3"
                      variant="outline"
                      onClick={saveSelectedEvidenceOverride}
                      disabled={savingBidDueOverride || !selectedEvidenceValue}
                    >
                      {savingBidDueOverride ? "Saving..." : "Use Selected Evidence"}
                    </Button>
                  </div>

                  <div className="rounded border border-border p-3">
                    <h3 className="text-sm font-semibold">Set Manually</h3>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <Label htmlFor="manual-bid-date">Date</Label>
                        <Input
                          id="manual-bid-date"
                          type="date"
                          value={manualDate}
                          onChange={(event) => setManualDate(event.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="manual-bid-time">Time</Label>
                        <Input
                          id="manual-bid-time"
                          type="time"
                          value={manualTime}
                          onChange={(event) => setManualTime(event.target.value)}
                        />
                      </div>
                      <div>
                        <Label htmlFor="manual-bid-timezone">Timezone</Label>
                        <select
                          id="manual-bid-timezone"
                          value={manualTimezone}
                          onChange={(event) => setManualTimezone(event.target.value)}
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {TIMEZONE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="mt-3">
                      <Label htmlFor="manual-bid-reason">Reason</Label>
                      <Textarea
                        id="manual-bid-reason"
                        value={manualReason}
                        onChange={(event) => setManualReason(event.target.value)}
                        placeholder="Example: Addendum 2 changed the bid deadline."
                      />
                    </div>
                    <Button
                      type="button"
                      className="mt-3"
                      onClick={saveManualOverride}
                      disabled={savingBidDueOverride}
                    >
                      {savingBidDueOverride ? "Saving..." : "Save Manual Override"}
                    </Button>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setOverrideOpen(false)} disabled={savingBidDueOverride}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Job Walk</p>
            <p className="font-medium">{snapshot.jobWalk}</p>
            {project.job_walk_override_at && (
              <p className="mt-1 text-xs text-[hsl(var(--bidbox-blue))]">
                Manual Override
                {project.job_walk_override_reason ? `: ${project.job_walk_override_reason}` : ""}
              </p>
            )}
            <Dialog open={jobWalkOverrideOpen} onOpenChange={(open) => (open ? openJobWalkOverride() : setJobWalkOverrideOpen(false))}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="mt-3">
                  Edit Job Walk Date
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Edit Job Walk Date</DialogTitle>
                  <DialogDescription>
                    Update the job walk date when the agency changes the schedule. The project and calendar will use the saved value.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <Label htmlFor="job-walk-date">Date</Label>
                      <Input
                        id="job-walk-date"
                        type="date"
                        value={jobWalkDate}
                        onChange={(event) => setJobWalkDate(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="job-walk-time">Time</Label>
                      <Input
                        id="job-walk-time"
                        type="time"
                        value={jobWalkTime}
                        onChange={(event) => setJobWalkTime(event.target.value)}
                      />
                    </div>
                    <div>
                      <Label htmlFor="job-walk-timezone">Timezone</Label>
                      <select
                        id="job-walk-timezone"
                        value={jobWalkTimezone}
                        onChange={(event) => setJobWalkTimezone(event.target.value)}
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {TIMEZONE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="job-walk-reason">Reason (optional)</Label>
                    <Textarea
                      id="job-walk-reason"
                      value={jobWalkReason}
                      onChange={(event) => setJobWalkReason(event.target.value)}
                      placeholder="Example: Agency updated the mandatory job walk date."
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setJobWalkOverrideOpen(false)} disabled={savingJobWalkOverride}>
                    Cancel
                  </Button>
                  <Button onClick={saveJobWalkOverride} disabled={savingJobWalkOverride}>
                    {savingJobWalkOverride ? "Saving..." : "Save Job Walk Date"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Report</p>
            <p className="font-medium">{intelligenceReport?.status ? normalizeLabel(intelligenceReport.status) : "Not linked"}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Pursuit Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Project Overview</p>
              <p className="mt-1 text-sm text-foreground">{snapshot.projectOverview}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Engineer Estimate</p>
                <p className="font-medium">{snapshot.engineerEstimate}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Required License</p>
                <p className="font-medium">{snapshot.requiredLicense}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Contract Duration</p>
                <p className="font-medium">{snapshot.contractDuration}</p>
              </div>
              <div className="rounded-md bg-muted/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Liquidated Damages</p>
                <p className="font-medium">{snapshot.liquidatedDamages}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <BidReadinessChecklist projectId={project.id} />
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle>Intelligence Highlights</CardTitle>
          {reportOpportunityId && (
            <Button variant="outline" size="sm" onClick={() => navigate(`/opportunities/${reportOpportunityId}`)}>
              View Full Intelligence Report
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <h3 className="font-medium">Critical Requirements</h3>
            </div>
            {renderFindingList(highlighted.criticalRequirements, "No critical requirements surfaced yet.")}
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="font-medium">Risks</h3>
            </div>
            {renderFindingList(highlighted.risks, "No risks surfaced yet.")}
          </div>
          <div>
            <div className="mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-600" />
              <h3 className="font-medium">Trades & Scope</h3>
            </div>
            {renderFindingList(highlighted.trades, "No trade or scope highlights surfaced yet.")}
          </div>
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Source Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {opportunityDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No acquired source documents are linked to this opportunity.</p>
            ) : (
              opportunityDocuments.map((document) => (
                <div key={document.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{document.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {[normalizeLabel(document.document_family || "source document"), formatFileSize(document.file_size)].join(" · ")}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => downloadSourceDocument(document)}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Internal Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {projectFiles.length === 0 ? (
                <p className="text-sm text-muted-foreground">No internal working files uploaded yet.</p>
              ) : (
                projectFiles.map((file) => (
                  <div key={file.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
                    <p className="truncate text-sm font-medium">{file.file_name}</p>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onDownloadInternalFile(file.file_url, file.file_name)}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete File</AlertDialogTitle>
                            <AlertDialogDescription>
                              Delete this internal working file? This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => onDeleteInternalFile(file.id, file.file_url)}>
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))
              )}
            </div>
            <FileDropzone
              onFilesSelected={onFilesSelected}
              accept=".pdf,.dwg,.xls,.xlsx"
              multiple={true}
              disabled={isUploading}
              className={`border-2 border-dashed border-border rounded-lg p-4 ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Upload className="h-4 w-4 mr-2 inline" />
              <span className="text-sm text-muted-foreground">
                {isUploading ? "Uploading..." : "Upload takeoffs, estimates, notes, or schedules"}
              </span>
            </FileDropzone>
            {newFiles.length > 0 && (
              <div className="space-y-3">
                {newFiles.map((file, i) => (
                  <div key={`${file.name}-${i}`} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{file.name}</p>
                      {currentUpload === file.name && <span className="text-xs text-muted-foreground">(Uploading...)</span>}
                    </div>
                    {currentUpload === file.name && <div className="h-1 rounded bg-muted" />}
                  </div>
                ))}
                <Button onClick={onUploadFiles} size="sm" disabled={isUploading}>
                  Upload Files
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <CardTitle>Required Trades</CardTitle>
          <Dialog open={editingTrades} onOpenChange={onEditingTradesChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Trades
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]" onWheel={(e) => e.stopPropagation()}>
              <DialogHeader>
                <DialogTitle>Edit Required Trades</DialogTitle>
                <DialogDescription>Select the trades required for this project.</DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <TradeMultiSelect selectedTradeIds={editedTradeIds} onSelectionChange={onEditedTradeIdsChange} stateCode="CA" />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    onEditedTradeIdsChange(projectTrades.map((trade) => trade.trade_type_id));
                    onEditingTradesChange(false);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={onSaveTrades} disabled={savingTrades}>
                  {savingTrades ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Trades"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {projectTrades.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {projectTrades.map((trade) => (
                <Badge key={trade.id} variant="outline" className={cn("px-2 py-1 text-xs font-medium border", getCategoryColor(trade.trade_types?.category))}>
                  <span className="font-mono mr-1">{trade.trade_types?.code}</span>
                  {trade.trade_types?.name}
                </Badge>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {highlighted.trades.length > 0 && (
                <div className="rounded-md border border-dashed border-border p-3">
                  <p className="text-sm font-medium">Suggested Trades from Intelligence</p>
                  <div className="mt-2 space-y-2">
                    {highlighted.trades.map((finding) => (
                      <p key={finding.id} className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{finding.label}:</span>{" "}
                        {finding.value_text || "Review in Intelligence Report"}
                      </p>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground">No editable required trades selected yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Coverage / Subs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projectTrades.length === 0 ? (
              <p className="text-sm text-muted-foreground">Add required trades to start tracking coverage.</p>
            ) : (
              projectTrades.map((trade) => {
                const quoteCount = submissions.filter((submission) =>
                  submission.bid_item === trade.trade_types?.name ||
                  submission.bid_item === trade.trade_types?.code,
                ).length;
                return (
                  <div key={trade.id} className="flex items-center justify-between rounded-md border border-border p-3">
                    <div>
                      <p className="font-medium">{trade.trade_types?.name}</p>
                      <p className="text-xs text-muted-foreground">Invites not tracked yet</p>
                    </div>
                    <Badge variant={quoteCount > 0 ? "default" : "outline"}>
                      {quoteCount} quote{quoteCount === 1 ? "" : "s"} received
                    </Badge>
                  </div>
                );
              })
            )}
            <div className="flex flex-wrap gap-2 pt-2">
              <CallListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} />
              <BidListButton projectId={project.id} projectName={project.name} gcId={project.gc_id} hasSelectedTrades={projectTrades.length > 0} projectCounty={project.county} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bid Room</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Room Link</p>
              <p className="mt-1 break-all text-sm">{bidRoomUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onCopyBidLink}>
                  {copied ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                  {copied ? "Copied" : "Copy Link"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(bidRoomUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open Bid Room
                </Button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium">Submissions</h3>
                </div>
                <Badge variant="outline">{submissions.length}</Badge>
              </div>
              <div className="space-y-2">
                {submissions.length === 0 ? (
                  <p className="rounded-md border border-border p-4 text-center text-sm text-muted-foreground">
                    No bid submissions yet.
                  </p>
                ) : (
                  submissions.map((submission) => (
                    <div key={submission.submission_id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{submission.bidder_name || "Unknown Bidder"}</p>
                          {submission.company_name && <p className="text-sm text-muted-foreground">{submission.company_name}</p>}
                          {submission.bid_item && <p className="text-sm text-muted-foreground">Division: {submission.bid_item}</p>}
                          <p className="text-xs text-muted-foreground">
                            {formatProjectDateTime(submission.submitted_at, { fallback: "Submitted date unavailable" })}
                          </p>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Submission</AlertDialogTitle>
                              <AlertDialogDescription>
                                Delete this bid submission and its files? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => onDeleteSubmission(submission.submission_id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                      <div className="mt-3 space-y-2">
                        {submission.files.map((file, index) => (
                          <Button key={`${submission.submission_id}-${index}`} variant="outline" size="sm" onClick={() => onDownloadBid(file.file_url, file.file_name)} className="w-full justify-start">
                            <Download className="h-4 w-4 mr-2" />
                            {file.file_name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
