// Shared rendering components for the Opportunity Intelligence report.
// Used by OpportunityReport (the standalone dossier page) and the Project
// Workspace Intelligence tab. Keep data-fetching out of this file — it only
// knows how to render findings that are handed to it.

import { useMemo, useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
  Loader2,
  AlertTriangle,
  FileText,
  Sparkles,
  CheckCircle2,
  Clock,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import { dateIdentity, resolveAuthoritativeBidDue } from "@/lib/bidDueResolver";
import { formatProjectDateTime, formatProjectDateTimeOrNull } from "@/lib/timezoneUtils";
import type {
  DossierFinding,
  DossierCitation,
  DossierCandidate,
  DossierReport,
  DossierDocument,
  DossierActiveTask,
  DossierLinkedProject,
} from "@/hooks/useOpportunityDossier";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FindingStatus = "found" | "unknown" | "conflict" | "not_applicable" | "needs_review";

export const STATUS_STYLE: Record<FindingStatus, string> = {
  found: "bg-green-500/10 text-green-700",
  unknown: "bg-gray-500/10 text-gray-600",
  conflict: "bg-red-500/10 text-red-700",
  not_applicable: "bg-gray-500/10 text-gray-600",
  needs_review: "bg-yellow-500/10 text-yellow-700",
};

export const REPORT_SECTIONS = [
  { key: "project_overview", title: "Project Overview", icon: Sparkles },
  { key: "scope_summary", title: "Scope Summary", icon: FileText },
  { key: "trade_breakdown", title: "Trade Breakdown", icon: FileText },
  { key: "key_dates", title: "Key Dates", icon: Clock },
  { key: "bid_requirements", title: "Bid Requirements", icon: CheckCircle2 },
  { key: "addenda_summary", title: "Addenda Summary", icon: FileText },
  { key: "risk_flags", title: "Risk Flags", icon: AlertTriangle },
];

const ANALYSIS_STAGES = ["metadata_refresh", "report_generation", "validation", "complete"] as const;
type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

const ACTIVE_DOCUMENT_STATUSES = ["queued", "acquiring"];
const ACTIVE_PROCESSING_STATUSES = ["queued", "processing"];

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i;
const MONTH_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;

export const normalizeTimeToken = (text: string | null | undefined): number | null => {
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

export const extractDateTimeDisplay = (text: string | null | undefined): string | null => {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return null;
  const formatted = formatProjectDateTimeOrNull(source);
  if (formatted) return formatted;
  const date = source.match(MONTH_DATE_RE)?.[0] ?? null;
  const time = source.match(TIME_RE)?.[0] ?? null;
  if (date && time) {
    return `${date} at ${time.replace(/\./g, "").replace(/\s+/g, " ").toUpperCase()}`;
  }
  return source;
};

export const isBidDueFinding = (finding: { field_key: string; label: string }): boolean => {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    /bid.*due/.test(haystack) ||
    /due.*date/.test(haystack) ||
    /bid.*opening/.test(haystack) ||
    /submission.*deadline/.test(haystack)
  );
};

const isProjectOverviewBullet = (text: string | null | undefined): boolean =>
  /^project overview\s*:/i.test(String(text ?? "").trim());

export const normalizeExecutiveBulletText = (
  text: string | null | undefined,
  index: number,
  bidDue?: { display: string; value: string | null; source: string | null; warning?: string | null },
): string => {
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
    if (/^scope text\s*:/i.test(value)) return value.replace(/^scope text\s*:/i, "Project Overview:");
    if (!isProjectOverviewBullet(value)) return `Project Overview: ${value}`;
  }
  return value;
};

export const bidDueSourceLabel = (source: string | null | undefined): string | null => {
  if (source === "manual_override") return "Manual override";
  if (source === "deadline_candidate_override") return "Selected evidence override";
  if (source === "portal_metadata") return "Portal metadata";
  if (source === "candidate_metadata") return "Candidate metadata";
  if (source === "project_metadata") return "Project metadata";
  if (source === "f4_fallback") return "F4 fallback";
  return null;
};

export const formatDate = (value: string | null) => formatProjectDateTime(value, { fallback: "—" });

// ─── UI sub-components ────────────────────────────────────────────────────────

export const IntelSection = ({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="bg-card border border-border rounded-lg p-5">
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
      {icon}
      {title}
    </h2>
    {children}
  </section>
);

export const CitationList = ({ citations }: { citations: DossierCitation[] }) => {
  if (citations.length === 0) {
    return (
      <p className="mt-3 text-xs text-muted-foreground italic">
        No citation attached. This item is not presented as a source-backed fact.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {citations.map((c) => (
        <details key={c.id} className="group">
          <summary className="cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--bidbox-blue))] hover:underline">
            <FileText className="h-3 w-3" />
            {c.citation_label ?? `${c.source_document_name}${c.page_number ? `, p. ${c.page_number}` : ""}`}
          </summary>
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-xs text-muted-foreground leading-relaxed">
            {c.source_excerpt}
          </blockquote>
        </details>
      ))}
    </div>
  );
};

export const FindingsList = ({
  findings,
  citationsByFinding,
  pendingMessage,
  ready,
  safeBidDue,
  bidDueEvidence,
}: {
  findings: DossierFinding[];
  citationsByFinding: Map<string, DossierCitation[]>;
  pendingMessage: string;
  ready: boolean;
  safeBidDue?: { display: string; source: string | null; warning: string | null; value: string | null };
  bidDueEvidence?: { selected: any; competing: any[] };
}) => {
  if (!ready) return <Pending message={pendingMessage} />;
  if (findings.length === 0) return <Unknown message="No cited findings were generated for this section." />;

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <article key={finding.id} className="border border-border rounded-md p-3 bg-background">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">{finding.label}</h3>
                {finding.is_critical && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/10 text-red-700">
                    <ShieldAlert className="h-3 w-3" />
                    Critical
                  </span>
                )}
                <span
                  className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLE[finding.status as FindingStatus] ?? ""}`}
                >
                  {finding.status.replace("_", " ")}
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

      {safeBidDue?.warning && bidDueEvidence && (
        <details className="rounded border border-yellow-300 bg-yellow-50 text-sm text-yellow-950">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 font-medium">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Conflicting deadline evidence detected
            </span>
            <span className="text-xs text-yellow-800">
              View Evidence ({bidDueEvidence.competing.length})
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
                {bidDueEvidence.competing.map((ev: any) => (
                  <div key={ev.id} className="rounded bg-white/70 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{ev.label}</p>
                      <span
                        className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${STATUS_STYLE[ev.status as FindingStatus] ?? ""}`}
                      >
                        {ev.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="text-sm text-foreground">{ev.display}</p>
                    <CitationList citations={ev.citations} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
};

export const Pending = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />
    <p>{message}</p>
  </div>
);

export const Unknown = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 text-sm text-muted-foreground">
    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
    <p>{message}</p>
  </div>
);

// ─── Derived-state hook ───────────────────────────────────────────────────────
// Encapsulates all the bid-due + findings derivation logic so it can be used
// by both OpportunityReport and the Project Workspace IntelligenceTab.

export function useIntelligenceReportDerivedState({
  candidate,
  report,
  findings,
  citationsByFinding,
  documents,
  linkedProject,
  activeTask,
  reportReady,
  analysisWorkActive,
}: {
  candidate: DossierCandidate | null;
  report: DossierReport | null;
  findings: DossierFinding[];
  citationsByFinding: Map<string, DossierCitation[]>;
  documents: DossierDocument[];
  linkedProject: DossierLinkedProject;
  activeTask: DossierActiveTask | null;
  reportReady: boolean;
  analysisWorkActive: boolean;
}) {
  const bidDueFindings = useMemo(
    () =>
      findings.filter((f) => {
        const statusOk = f.status === "found" || f.status === "conflict";
        return statusOk && isBidDueFinding(f) && (citationsByFinding.get(f.id)?.length ?? 0) > 0;
      }),
    [findings, citationsByFinding],
  );

  const safeBidDue = useMemo(() => {
    const sourceTimes = [
      ...new Set(
        bidDueFindings
          .map((f) => normalizeTimeToken(f.value_text))
          .filter((v): v is number => v !== null),
      ),
    ];
    const f4ValueText = bidDueFindings[0]?.value_text ?? null;
    const resolved = resolveAuthoritativeBidDue({
      overrideBidDueAt: linkedProject.bidDueOverrideAt,
      overrideSource: linkedProject.bidDueOverrideSource,
      dueDateRaw: candidate?.crawl_data?.due_date_raw,
      candidateBidDueAt: candidate?.bid_due_at ?? null,
      projectBidDueAt: linkedProject.bidDueAt,
      f4ValueText,
    });
    const findingDate = bidDueFindings.map((f) => dateIdentity(f.value_text)).find(Boolean);
    const hasSourceConflict = sourceTimes.length > 1;
    const hasMetadataConflict =
      resolved.conflict ||
      Boolean(dateIdentity(resolved.value) && findingDate && dateIdentity(resolved.value) !== findingDate);
    if (hasSourceConflict) {
      return {
        ...resolved,
        source: bidDueSourceLabel(resolved.source),
        warning: "Conflicting deadline evidence detected. Showing the authoritative structured deadline.",
      };
    }
    return {
      ...resolved,
      source: bidDueSourceLabel(resolved.source),
      warning: hasMetadataConflict
        ? resolved.conflictMessage ??
          "F4 cited deadline conflicts with structured portal metadata. Showing structured deadline."
        : null,
    };
  }, [candidate?.bid_due_at, candidate?.crawl_data, linkedProject, bidDueFindings]);

  const bidDueEvidence = useMemo(() => {
    const selectedDetail =
      linkedProject.bidDueOverrideSource === "manual" && linkedProject.bidDueOverrideReason
        ? `Reason: ${linkedProject.bidDueOverrideReason}`
        : linkedProject.bidDueOverrideSource === "deadline_candidate" && linkedProject.bidDueOverrideReason
          ? linkedProject.bidDueOverrideReason
          : candidate?.crawl_data?.due_date_raw
            ? `Raw portal value: ${candidate.crawl_data.due_date_raw}`
            : null;
    const competing = bidDueFindings.map((f) => {
      const fCitations = citationsByFinding.get(f.id) ?? [];
      const first = fCitations[0];
      const label =
        first?.citation_label ||
        (first
          ? `${first.source_document_name}${first.page_number ? `, p. ${first.page_number}` : ""}`
          : f.label);
      return {
        id: f.id,
        label,
        display: extractDateTimeDisplay(f.value_text) || f.value_text || "Deadline evidence captured",
        status: f.status as FindingStatus,
        citations: fCitations,
      };
    });
    return {
      selected: { label: safeBidDue.source || "Authoritative deadline", display: safeBidDue.display, detail: selectedDetail },
      competing,
    };
  }, [bidDueFindings, candidate?.crawl_data, citationsByFinding, linkedProject, safeBidDue]);

  const acquisitionSummary = candidate?.crawl_data?.acquisition_summary as any;

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

  const activeAnalysisStage = useMemo<AnalysisStage | null>(() => {
    if (!analysisWorkActive) return null;
    const payloadStage = activeTask?.payload?.stage;
    if (ANALYSIS_STAGES.includes(payloadStage)) return payloadStage as AnalysisStage;
    const taskType = activeTask?.task_type;
    if (
      taskType === "project_analysis" ||
      ACTIVE_DOCUMENT_STATUSES.includes(candidate?.document_acquisition_status ?? "")
    )
      return "metadata_refresh";
    if (
      taskType === "document_processing" ||
      ACTIVE_PROCESSING_STATUSES.includes(candidate?.document_processing_status ?? "")
    )
      return "metadata_refresh";
    if (taskType === "project_intelligence" || candidate?.analysis_status === "analyzing")
      return "report_generation";
    return "metadata_refresh";
  }, [activeTask, analysisWorkActive, candidate]);

  const stageProgress = useMemo(() => {
    const rank: Record<AnalysisStage, number> = {
      metadata_refresh: 1,
      report_generation: 2,
      validation: 3,
      complete: 4,
    };
    const currentRank = activeAnalysisStage ? rank[activeAnalysisStage] : 1;
    return {
      currentStep:
        activeAnalysisStage === "metadata_refresh" ? 1 : activeAnalysisStage === "report_generation" ? 2 : 3,
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

  const displayedFindingsByCategory = useMemo(() => {
    const hasStructuredBidDue = Boolean(
      candidate?.crawl_data?.due_date_raw || candidate?.bid_due_at || linkedProject.bidDueAt,
    );
    const map = new Map<string, DossierFinding[]>();
    const byCategory = new Map<string, DossierFinding[]>();
    findings.forEach((f) => {
      const list = byCategory.get(f.category) ?? [];
      list.push(f);
      byCategory.set(f.category, list);
    });
    byCategory.forEach((items, category) => {
      map.set(
        category,
        hasStructuredBidDue ? items.filter((f) => !isBidDueFinding(f)) : [...items],
      );
    });
    const keyDateFindings = map.get("key_dates") ?? [];
    if (hasStructuredBidDue && safeBidDue.display !== "—") {
      const structuredFinding: DossierFinding = {
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
          linkedProject.bidDueOverrideReason && linkedProject.bidDueOverrideSource
            ? linkedProject.bidDueOverrideSource === "manual"
              ? `Manually overridden. Reason: ${linkedProject.bidDueOverrideReason}`
              : `Selected from evidence: ${linkedProject.bidDueOverrideReason}`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      };
      map.set("key_dates", [structuredFinding, ...keyDateFindings]);
    }
    return map;
  }, [candidate, findings, linkedProject, safeBidDue]);

  const executiveBullets = useMemo<Array<{ text: string }>>(() => {
    if (!report?.executive_summary) return [];
    const raw = report.executive_summary;
    const bullets: Array<{ text: string }> = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.bullets)
        ? raw.bullets
        : [];
    return bullets.filter((b) => b?.text && !isProjectOverviewBullet(b.text));
  }, [report]);

  const pendingSectionMessage = useMemo(() => {
    if (!candidate) return "Loading…";
    const ois = candidate.opportunity_intelligence_status ?? "";
    const das = candidate.document_acquisition_status ?? "";
    const dps = candidate.document_processing_status ?? "";
    const as_ = candidate.analysis_status ?? "";
    if (ois === "queued" || das === "queued") return "Queued for preparation…";
    if (das === "acquiring") return "Acquiring source documents…";
    if (dps === "processing" || ois === "processing_documents") return "Processing source documents…";
    if (as_ === "analyzing" || ois === "generating_report") return "Generating Intelligence Report…";
    if (ois === "failed" || as_ === "failed") return "Preparation failed.";
    return "Opportunity Intelligence has not been prepared yet.";
  }, [candidate]);

  return {
    safeBidDue,
    bidDueEvidence,
    partialAcquisitionNotice,
    activeAnalysisStage,
    stageProgress,
    displayedFindingsByCategory,
    executiveBullets,
    pendingSectionMessage,
  };
}

// ─── Full intelligence report renderer ───────────────────────────────────────
// Renders the complete intelligence report given dossier data.
// Action handlers are provided as props to keep this component presentation-only.

export interface IntelligenceReportViewProps {
  candidate: DossierCandidate | null;
  report: DossierReport | null;
  findings: DossierFinding[];
  citationsByFinding: Map<string, DossierCitation[]>;
  documents: DossierDocument[];
  activeTask: DossierActiveTask | null;
  linkedProject: DossierLinkedProject;
  reportReady: boolean;
  analysisWorkActive: boolean;
  reanalyzing: boolean;
  onPrepare: () => void;
  prepareLabel?: string;
  prepareConfirmTitle?: string;
  prepareConfirmBody?: string;
}

export function IntelligenceReportView({
  candidate,
  report,
  findings,
  citationsByFinding,
  documents,
  activeTask,
  linkedProject,
  reportReady,
  analysisWorkActive,
  reanalyzing,
  onPrepare,
  prepareLabel,
  prepareConfirmTitle,
  prepareConfirmBody,
}: IntelligenceReportViewProps) {
  const {
    safeBidDue,
    bidDueEvidence,
    partialAcquisitionNotice,
    stageProgress,
    activeAnalysisStage,
    displayedFindingsByCategory,
    executiveBullets,
    pendingSectionMessage,
  } = useIntelligenceReportDerivedState({
    candidate,
    report,
    findings,
    citationsByFinding,
    documents,
    linkedProject,
    activeTask,
    reportReady,
    analysisWorkActive,
  });

  const actionLabel = prepareLabel ?? (reportReady ? "Refresh Analysis" : "Prepare Intelligence");
  const confirmTitle = prepareConfirmTitle ?? (reportReady ? "Refresh Analysis?" : "Prepare Intelligence?");
  const confirmBody =
    prepareConfirmBody ??
    (reportReady
      ? "This will regenerate Intelligence from the currently processed evidence. The current report stays available while the new report runs."
      : "BidBox will acquire source documents and generate an Intelligence report for this project.");

  return (
    <div className="space-y-6">
      {/* Action button */}
      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={reanalyzing || analysisWorkActive || !candidate}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {actionLabel}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onPrepare} disabled={reanalyzing || analysisWorkActive}>
                {reanalyzing ? "Queueing…" : actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Analysis in-progress banner */}
      {analysisWorkActive && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-blue-950">
          <div className="flex items-start gap-3">
            <Loader2 className="h-5 w-5 animate-spin mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Analysis In Progress</p>
              <p className="text-sm text-blue-900">Step {stageProgress.currentStep} of 3</p>
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
                <p>You can leave this tab and come back later.</p>
                {activeAnalysisStage === "complete" && (
                  <p className="font-medium">Refreshing report…</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Partial acquisition notice */}
      {partialAcquisitionNotice && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-amber-950">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-700" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Some source documents could not be acquired.</p>
              <p className="mt-1 text-sm">
                BidBox successfully analyzed {partialAcquisitionNotice.analyzed} of{" "}
                {partialAcquisitionNotice.total} available documents.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Intelligence not ready */}
      {!reportReady && (
        <IntelSection title="Intelligence Report" icon={<Sparkles className="h-4 w-4" />}>
          <Pending message={pendingSectionMessage} />
          {(candidate?.analysis_status === "failed" || candidate?.opportunity_intelligence_status === "failed") && (
            <p className="mt-3 text-sm text-red-700">
              {candidate.analysis_error ??
                candidate.opportunity_intelligence_error ??
                report?.error}
            </p>
          )}
        </IntelSection>
      )}

      {/* Executive Summary */}
      <IntelSection title="Executive Summary" icon={<Sparkles className="h-4 w-4" />}>
        {executiveBullets.length > 0 ? (
          <ul className="space-y-2 text-sm text-foreground">
            {executiveBullets.map((bullet, index) => (
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
      </IntelSection>

      {/* Report sections */}
      {REPORT_SECTIONS.map((section) => {
        const Icon = section.icon;
        return (
          <IntelSection key={section.key} title={section.title} icon={<Icon className="h-4 w-4" />}>
            <FindingsList
              findings={displayedFindingsByCategory.get(section.key) ?? []}
              citationsByFinding={citationsByFinding}
              pendingMessage={pendingSectionMessage}
              ready={reportReady}
              safeBidDue={section.key === "key_dates" ? safeBidDue : undefined}
              bidDueEvidence={section.key === "key_dates" ? bidDueEvidence : undefined}
            />
          </IntelSection>
        );
      })}
    </div>
  );
}

// ─── Stateful wrapper used from Project Workspace ─────────────────────────────
// Wraps IntelligenceReportView with the state and action handlers for the
// Project Workspace context (uses force_prepare to bypass the closed-bid gate).

export function ProjectWorkspaceIntelligenceView({
  candidate,
  report,
  findings,
  citationsByFinding,
  documents,
  activeTask,
  linkedProject,
  reportReady,
  analysisWorkActive,
  reload,
}: {
  candidate: DossierCandidate | null;
  report: DossierReport | null;
  findings: DossierFinding[];
  citationsByFinding: Map<string, DossierCitation[]>;
  documents: DossierDocument[];
  activeTask: DossierActiveTask | null;
  linkedProject: DossierLinkedProject;
  reportReady: boolean;
  analysisWorkActive: boolean;
  reload: () => void;
}) {
  const { toast } = useToast();
  const [reanalyzing, setReanalyzing] = useState(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (wasActiveRef.current && !analysisWorkActive && candidate) {
      const err =
        candidate.analysis_error ??
        candidate.opportunity_intelligence_error ??
        candidate.document_acquisition_error ??
        null;
      if (err) {
        toast({ title: "Preparation failed", description: err, variant: "destructive" });
      } else {
        toast({ title: "Intelligence ready", description: "Opportunity Intelligence has been prepared." });
        reload();
      }
    }
    wasActiveRef.current = analysisWorkActive;
  }, [analysisWorkActive, candidate, reload, toast]);

  const handlePrepare = async () => {
    if (!candidate || analysisWorkActive) return;
    setReanalyzing(true);
    try {
      const action = reportReady ? "reanalyze" : "force_prepare";
      const { data, error } = await supabase.functions.invoke("manage-opportunity-intelligence", {
        body: { action, candidate_id: candidate.id },
      });
      if (error || data?.success === false)
        throw new Error(data?.error ?? error?.message ?? "Failed to queue preparation");
      toast({
        title: reportReady ? "Re-analysis queued" : "Preparation queued",
        description: reportReady
          ? "BidBox will regenerate Intelligence from the current processed evidence."
          : "BidBox will acquire source documents and generate an Intelligence report.",
      });
      await reload();
    } catch (e: any) {
      toast({
        title: "Failed to queue preparation",
        description: e?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReanalyzing(false);
    }
  };

  return (
    <IntelligenceReportView
      candidate={candidate}
      report={report}
      findings={findings}
      citationsByFinding={citationsByFinding}
      documents={documents}
      activeTask={activeTask}
      linkedProject={linkedProject}
      reportReady={reportReady}
      analysisWorkActive={analysisWorkActive}
      reanalyzing={reanalyzing}
      onPrepare={handlePrepare}
    />
  );
}
