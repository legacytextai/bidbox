// Opportunity Dossier — /opportunities/:id
// Three tabs: Overview | Documents | Intelligence
// Tab state lives in the URL search param ?tab=overview (default)

import { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
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
  ChevronLeft,
  ChevronRight,
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
import { useOpportunityDossier } from "@/hooks/useOpportunityDossier";
import { OpportunityOverviewTab } from "@/components/OpportunityOverviewTab";
import { OpportunityDocumentsTab } from "@/components/OpportunityDocumentsTab";
import { resolveOIStyle, resolveOILabel } from "@/lib/opportunityDomain";
import type { DossierFinding, DossierCitation } from "@/hooks/useOpportunityDossier";
import {
  FindingStatus,
  STATUS_STYLE,
  REPORT_SECTIONS,
  normalizeTimeToken,
  extractDateTimeDisplay,
  isBidDueFinding,
  normalizeExecutiveBulletText,
  bidDueSourceLabel,
  formatDate,
  IntelSection,
  CitationList,
  FindingsList,
  Pending,
  Unknown,
} from "@/components/IntelligenceReportView";

// ─── Types ────────────────────────────────────────────────────────────────────

// FindingStatus, STATUS_STYLE, REPORT_SECTIONS imported from IntelligenceReportView

const ACTIVE_TASK_STATUSES = ["pending", "running", "retrying"];
const ACTIVE_ANALYSIS_STATUSES = ["queued", "analyzing"];
const ACTIVE_DOCUMENT_STATUSES = ["queued", "acquiring"];
const ACTIVE_PROCESSING_STATUSES = ["queued", "processing"];
const ANALYSIS_STAGES = ["metadata_refresh", "report_generation", "validation", "complete"] as const;
type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "documents", label: "Documents" },
  { key: "intelligence", label: "Intelligence" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Helper functions imported from IntelligenceReportView:
// normalizeTimeToken, extractDateTimeDisplay, isBidDueFinding,
// normalizeExecutiveBulletText, bidDueSourceLabel, formatDate

const isUniqueViolation = (error: any): boolean =>
  error?.code === "23505" || String(error?.message ?? "").toLowerCase().includes("duplicate key");

// ─── Page ─────────────────────────────────────────────────────────────────────

const OpportunityReport = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = (searchParams.get("tab") as TabKey) ?? "overview";
  const setTab = (tab: TabKey) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", tab);
      return next;
    });
  };

  const {
    loading,
    candidate,
    report,
    findings,
    citations,
    citationsByFinding,
    documents,
    activeTask,
    linkedProject,
    overview,
    reportReady,
    analysisWorkActive,
    reload,
    setCandidate,
  } = useOpportunityDossier(id);

  const [adding, setAdding] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);
  const [reanalysisFailureNotice, setReanalysisFailureNotice] = useState<string | null>(null);
  const wasAnalysisActiveRef = useRef(false);

  // ── Bid due derived state for Intelligence tab ───────────────────────────

  const bidDueFindings = useMemo(
    () =>
      findings.filter((f) => {
        const statusOk = f.status === "found" || f.status === "conflict";
        return statusOk && isBidDueFinding(f) && (citationsByFinding.get(f.id)?.length ?? 0) > 0;
      }),
    [findings, citationsByFinding],
  );

  const safeBidDue = useMemo(() => {
    const sourceDisplays = bidDueFindings
      .map((f) => extractDateTimeDisplay(f.value_text))
      .filter((v): v is string => Boolean(v));
    const sourceTimes = [
      ...new Set(
        bidDueFindings.map((f) => normalizeTimeToken(f.value_text)).filter((v): v is number => v !== null),
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
        (first ? `${first.source_document_name}${first.page_number ? `, p. ${first.page_number}` : ""}` : f.label);
      return { id: f.id, label, display: extractDateTimeDisplay(f.value_text) || f.value_text || "Deadline evidence captured", status: f.status as FindingStatus, citations: fCitations };
    });
    return { selected: { label: safeBidDue.source || "Authoritative deadline", display: safeBidDue.display, detail: selectedDetail }, competing };
  }, [bidDueFindings, candidate?.crawl_data, citationsByFinding, linkedProject, safeBidDue]);

  const crawl = candidate?.crawl_data ?? {};
  const estimatedValue = crawl?.estimated_value as number | undefined;
  const acquisitionSummary = crawl?.acquisition_summary as any;
  const jobWalkAt = crawl?.job_walk_at as string | undefined;
  const licenseRequirements = crawl?.license_requirements as string | undefined;
  const contractDuration = crawl?.contract_duration as string | undefined;
  const liquidatedDamages = crawl?.liquidated_damages as string | undefined;
  const department = crawl?.department as string | undefined;
  const projectAddress = crawl?.project_address as string | undefined;

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
      message: acquisitionSummary.warning_message || `BidBox successfully analyzed ${acquired + skipped} of ${found} available documents.`,
    };
  }, [acquisitionSummary, reportReady]);

  const activeAnalysisStage = useMemo<AnalysisStage | null>(() => {
    if (!analysisWorkActive) return null;
    const payloadStage = activeTask?.payload?.stage;
    if (ANALYSIS_STAGES.includes(payloadStage)) return payloadStage;
    const taskType = activeTask?.task_type;
    if (taskType === "project_analysis" || ACTIVE_DOCUMENT_STATUSES.includes(candidate?.document_acquisition_status ?? "")) return "metadata_refresh";
    if (taskType === "document_processing" || ACTIVE_PROCESSING_STATUSES.includes(candidate?.document_processing_status ?? "")) return "metadata_refresh";
    if (taskType === "project_intelligence" || candidate?.analysis_status === "analyzing") return "report_generation";
    return "metadata_refresh";
  }, [activeTask, analysisWorkActive, candidate]);

  const stageProgress = useMemo(() => {
    const rank: Record<AnalysisStage, number> = { metadata_refresh: 1, report_generation: 2, validation: 3, complete: 4 };
    const currentRank = activeAnalysisStage ? rank[activeAnalysisStage] : 1;
    return {
      currentStep: activeAnalysisStage === "metadata_refresh" ? 1 : activeAnalysisStage === "report_generation" ? 2 : 3,
      steps: [
        { key: "metadata_refresh", label: "Refreshing Source Data", state: currentRank > 1 ? "complete" : "active" },
        { key: "report_generation", label: "Generating Intelligence Report", state: currentRank > 2 ? "complete" : currentRank === 2 ? "active" : "pending" },
        { key: "validation", label: activeAnalysisStage === "complete" ? "Complete" : "Validating Findings", state: currentRank > 3 ? "complete" : currentRank === 3 ? "active" : "pending" },
      ],
    };
  }, [activeAnalysisStage]);

  const reanalysisFailureReason = useMemo(() => {
    if (!candidate) return null;
    return candidate.analysis_error || candidate.document_acquisition_error || candidate.document_processing_error || null;
  }, [candidate]);

  const displayedReanalysisFailure = useMemo(() => {
    if (analysisWorkActive || !reportReady) return null;
    return reanalysisFailureNotice || reanalysisFailureReason;
  }, [analysisWorkActive, reanalysisFailureNotice, reanalysisFailureReason, reportReady]);

  useEffect(() => {
    if (!candidate || loading) return;
    if (wasAnalysisActiveRef.current && !analysisWorkActive) {
      const failureReason = reanalysisFailureReason;
      if (failureReason) {
        setReanalysisFailureNotice(failureReason);
        toast({ title: "Re-analysis failed", description: "The previous report is still available.", variant: "destructive" });
      } else {
        setReanalysisFailureNotice(null);
        toast({ title: "Re-analysis complete", description: "Project Intelligence has been refreshed." });
        reload();
      }
    }
    wasAnalysisActiveRef.current = analysisWorkActive;
  }, [analysisWorkActive, candidate, loading, reload, reanalysisFailureReason, toast]);

  // ── Displayed findings for Intelligence tab ──────────────────────────────

  const isJobWalkFinding = (f: DossierFinding): boolean => {
    const h = `${f.field_key} ${f.label}`.toLowerCase();
    return h.includes("job walk") || h.includes("pre-bid") || h.includes("prebid") || h.includes("site visit");
  };

  const safeJobWalk = useMemo(() => {
    const normalizeDateTimeText = (value: string | null | undefined): string | null => {
      const text = String(value ?? "").replace(/\s+/g, " ").trim();
      if (!text) return null;
      return formatProjectDateTimeOrNull(text) ?? text;
    };
    const isAffirmative = (v: unknown) => v === true || (typeof v === "string" && /^(yes|true|required|mandatory)$/i.test(v.trim()));
    const finding = findings.find(
      (f) =>
        (f.status === "found" || f.status === "needs_review" || f.status === "conflict") &&
        isJobWalkFinding(f) &&
        (citationsByFinding.get(f.id)?.length ?? 0) > 0,
    );
    const citedDisplay = normalizeDateTimeText(finding?.value_text);
    if (citedDisplay) return citedDisplay;
    const metadataDisplay = normalizeDateTimeText(jobWalkAt) || normalizeDateTimeText(crawl?.pre_bid_meeting_at);
    if (metadataDisplay) return metadataDisplay;
    const hasMetadataEvidence =
      isAffirmative(crawl?.pre_bid_meeting) ||
      isAffirmative(crawl?.attendance_required) ||
      isAffirmative(crawl?.job_walk_exists) ||
      isAffirmative(crawl?.job_walk_mandatory);
    const hasJobWalkDocumentEvidence = documents.some((d) => {
      const h = [d.file_name, d.document_class, d.document_family].join(" ").toLowerCase();
      return ["job walk", "pre-bid", "pre bid", "prebid", "site visit", "attendance list", "sign in", "sign-in"].some((s) => h.includes(s));
    });
    if (hasMetadataEvidence || hasJobWalkDocumentEvidence) return "Needs Review";
    return null;
  }, [citationsByFinding, crawl, documents, findings, jobWalkAt]);

  const displayedFindingsByCategory = useMemo(() => {
    const hasStructuredBidDue = Boolean(candidate?.crawl_data?.due_date_raw || candidate?.bid_due_at || linkedProject.bidDueAt);
    const map = new Map<string, DossierFinding[]>();
    const findingsByCategory = new Map<string, DossierFinding[]>();
    findings.forEach((f) => {
      const list = findingsByCategory.get(f.category) ?? [];
      list.push(f);
      findingsByCategory.set(f.category, list);
    });
    findingsByCategory.forEach((items, category) => {
      map.set(category, hasStructuredBidDue ? items.filter((f) => !isBidDueFinding(f)) : [...items]);
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
        ].filter(Boolean).join(" "),
      };
      map.set("key_dates", [structuredFinding, ...keyDateFindings]);
    }
    return map;
  }, [candidate, findings, linkedProject, safeBidDue]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleAddToCalendar = async () => {
    if (!candidate) return;
    setAdding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      const sb = supabase as any;
      const scopeFinding = findings.find((f) => f.category === "scope_summary" && f.status === "found");

      const syncCandidateLink = async (projectId: string) => {
        const { error: updateError } = await sb
          .from("opportunity_candidates")
          .update({ status: "converted", converted_project_id: projectId, opportunity_lifecycle_status: "added_to_calendar" })
          .eq("id", candidate.id);
        if (updateError) throw updateError;
        setCandidate((cur) => cur ? { ...cur, status: "converted", converted_project_id: projectId, opportunity_lifecycle_status: "added_to_calendar" } : cur);
      };

      const findExistingProject = async () => {
        const { data: fresh } = await sb.from("opportunity_candidates").select("converted_project_id").eq("id", candidate.id).maybeSingle();
        if (fresh?.converted_project_id) {
          const { data: p } = await sb.from("projects").select("id, origin, source_opportunity_candidate_id, opportunity_intelligence_report_id, bid_due_at").eq("id", fresh.converted_project_id).maybeSingle();
          return p;
        }
        const { data: p } = await sb.from("projects").select("id, origin, source_opportunity_candidate_id, opportunity_intelligence_report_id, bid_due_at").eq("origin", "opportunity_intelligence").eq("source_opportunity_candidate_id", candidate.id).maybeSingle();
        return p;
      };

      const existing = await findExistingProject();
      if (existing?.id) {
        const updates: Record<string, string> = {};
        if (existing.origin !== "opportunity_intelligence") updates.origin = "opportunity_intelligence";
        if (!existing.source_opportunity_candidate_id) updates.source_opportunity_candidate_id = candidate.id;
        if (!existing.opportunity_intelligence_report_id && report?.id) updates.opportunity_intelligence_report_id = report.id;
        if (safeBidDue.value && existing.bid_due_at !== safeBidDue.value) updates.bid_due_at = safeBidDue.value;
        updates.project_lifecycle_status = "project_intelligence_ready";
        updates.project_intelligence_status = "ready";
        updates.project_intelligence_ready_at = new Date().toISOString();
        if (Object.keys(updates).length > 0) {
          const { error } = await sb.from("projects").update(updates).eq("id", existing.id);
          if (error) throw error;
        }
        await syncCandidateLink(existing.id);
        navigate(`/projects/${existing.id}`);
        return;
      }

      if (!report?.id) throw new Error("Project Intelligence report is required before adding this opportunity to the calendar.");
      if (!safeBidDue.value) {
        toast({ title: "Missing bid due date", description: "This opportunity has no bid due date. Open the source to confirm.", variant: "destructive" });
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
          pursuit_status: "reviewing",
          pursuit_status_updated_at: new Date().toISOString(),
          pursuit_status_updated_by: session.user.id,
          status: "LIVE",
        })
        .select("id")
        .single();

      if (error) {
        if (isUniqueViolation(error)) {
          const recovered = await findExistingProject();
          if (recovered?.id) { await syncCandidateLink(recovered.id); navigate(`/projects/${recovered.id}`); return; }
        }
        throw error;
      }
      await syncCandidateLink(project.id);
      toast({ title: "Added to Calendar", description: "Project created and added to your active pursuits." });
      navigate(`/projects/${project.id}`);
    } catch (e: any) {
      toast({ title: "Failed to add", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  const handleReanalyze = async () => {
    if (!candidate || analysisWorkActive) return;
    setReanalyzing(true);
    setReanalysisFailureNotice(null);
    try {
      const { data, error } = reportReady
        ? await supabase.functions.invoke("manage-opportunity-intelligence", {
            body: { action: "reanalyze", candidate_id: candidate.id },
          })
        : await supabase.functions.invoke("analyze-project", {
            body: { candidate_id: candidate.id },
          });
      if (error || data?.success === false) throw new Error(data?.error ?? error?.message ?? "Failed to queue analysis");
      toast({
        title: reportReady ? "Re-analysis queued" : "Preparation queued",
        description: reportReady
          ? "BidBox will regenerate Project Intelligence from the current processed evidence."
          : "BidBox will acquire documents and prepare Opportunity Intelligence.",
      });
      await reload();
    } catch (e: any) {
      toast({ title: "Failed to queue analysis", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setReanalyzing(false);
    }
  };

  const handleDeleteAnalysis = async () => {
    if (!candidate || analysisWorkActive) return;
    setDeletingAnalysis(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-opportunity-intelligence", {
        body: { action: "delete_analysis", candidate_id: candidate.id },
      });
      if (error || data?.success === false) throw new Error(data?.error ?? error?.message ?? "Failed to delete analysis");
      toast({ title: "Analysis deleted", description: "The opportunity was returned to Not Analyzed." });
      navigate("/opportunities");
    } catch (e: any) {
      toast({ title: "Failed to delete analysis", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setDeletingAnalysis(false);
    }
  };

  // ── Render guards ─────────────────────────────────────────────────────────

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

  const oiStatusDisplay = overview?.oiStatus ?? candidate.opportunity_intelligence_status ?? candidate.analysis_status ?? "not_requested";
  const executiveBullets: Array<{ text: string }> = Array.isArray(report?.executive_summary?.bullets)
    ? report!.executive_summary!.bullets!
    : [];

  const pendingSectionMessage = (() => {
    switch (candidate.analysis_status) {
      case "queued": return "Project Intelligence is queued. The report will appear after document processing and report generation finish.";
      case "analyzing": return "Generating Project Intelligence from processed document evidence.";
      case "failed": return candidate.analysis_error ?? "Project Intelligence failed.";
      default: return "Opportunity Intelligence has not been generated yet. BidBox prepares opportunities automatically during source refresh; use Re-Analyze only as a recovery action.";
    }
  })();

  return (
    <Layout showSidebar={true}>
      <div className="p-8 max-w-6xl mx-auto">
        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div className="mb-8">
          <Button variant="ghost" size="sm" onClick={() => navigate("/opportunities")} className="mb-4 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Opportunities
          </Button>

          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground leading-tight">
                {candidate.raw_title ?? "Untitled Opportunity"}
              </h1>
              <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                {candidate.agency && (
                  <span className="text-sm text-muted-foreground">{candidate.agency}</span>
                )}
                <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded ${resolveOIStyle(oiStatusDisplay)}`}>
                  {analysisWorkActive && <Loader2 className="h-3 w-3 animate-spin" />}
                  {resolveOILabel(oiStatusDisplay)}
                </span>
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

            {/* Primary CTA */}
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
              {candidate.converted_project_id ? "View Project" : "Add to Calendar"}
            </Button>
          </div>
        </div>

        {/* ── Tab navigation ───────────────────────────────────────────────── */}
        <div className="flex border-b border-border mb-8 gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTab(tab.key)}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.key === "documents" && documents.length > 0 && (
                <span className="ml-1.5 text-xs text-muted-foreground">({documents.length})</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        {activeTab === "overview" && overview && (
          <OpportunityOverviewTab data={overview} />
        )}

        {activeTab === "documents" && (
          <OpportunityDocumentsTab documents={documents} />
        )}

        {activeTab === "intelligence" && (
          <IntelligenceTab
            candidate={candidate}
            report={report}
            reportReady={reportReady}
            executiveBullets={executiveBullets}
            safeBidDue={safeBidDue}
            bidDueEvidence={bidDueEvidence}
            displayedFindingsByCategory={displayedFindingsByCategory}
            citationsByFinding={citationsByFinding}
            partialAcquisitionNotice={partialAcquisitionNotice}
            analysisWorkActive={analysisWorkActive}
            stageProgress={stageProgress}
            activeAnalysisStage={activeAnalysisStage}
            displayedReanalysisFailure={displayedReanalysisFailure}
            pendingSectionMessage={pendingSectionMessage}
            reanalyzing={reanalyzing}
            deletingAnalysis={deletingAnalysis}
            onReanalyze={handleReanalyze}
            onDeleteAnalysis={handleDeleteAnalysis}
          />
        )}
      </div>
    </Layout>
  );
};

// ─── Intelligence Tab ─────────────────────────────────────────────────────────

interface IntelligenceTabProps {
  candidate: any;
  report: any;
  reportReady: boolean;
  executiveBullets: Array<{ text: string }>;
  safeBidDue: { display: string; value: string | null; source: string | null; warning: string | null };
  bidDueEvidence: any;
  displayedFindingsByCategory: Map<string, DossierFinding[]>;
  citationsByFinding: Map<string, DossierCitation[]>;
  partialAcquisitionNotice: { analyzed: number; total: number; message: string } | null;
  analysisWorkActive: boolean;
  stageProgress: { currentStep: number; steps: Array<{ key: string; label: string; state: string }> };
  activeAnalysisStage: AnalysisStage | null;
  displayedReanalysisFailure: string | null;
  pendingSectionMessage: string;
  reanalyzing: boolean;
  deletingAnalysis: boolean;
  onReanalyze: () => void;
  onDeleteAnalysis: () => void;
}

const IntelligenceTab = ({
  candidate,
  report,
  reportReady,
  executiveBullets,
  safeBidDue,
  bidDueEvidence,
  displayedFindingsByCategory,
  citationsByFinding,
  partialAcquisitionNotice,
  analysisWorkActive,
  stageProgress,
  activeAnalysisStage,
  displayedReanalysisFailure,
  pendingSectionMessage,
  reanalyzing,
  deletingAnalysis,
  onReanalyze,
  onDeleteAnalysis,
}: IntelligenceTabProps) => {
  const status = candidate.analysis_status;

  return (
    <div className="space-y-6">
      {/* Secondary maintenance actions */}
      <div className="flex flex-wrap gap-2">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" disabled={reanalyzing || analysisWorkActive || !candidate}>
              <RotateCcw className="h-4 w-4 mr-2" />
              {reportReady ? "Refresh Analysis" : "Retry Preparation"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{reportReady ? "Refresh Analysis?" : "Retry Preparation?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {reportReady
                  ? "This will regenerate Project Intelligence from the currently processed evidence. The current report stays available while the new report runs."
                  : "This will queue document acquisition and Opportunity Intelligence preparation for this opportunity."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onReanalyze} disabled={reanalyzing || analysisWorkActive}>
                {reanalyzing ? "Queueing..." : reportReady ? "Refresh Analysis" : "Retry Preparation"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={deletingAnalysis || analysisWorkActive || !candidate}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Analysis
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Analysis?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the Intelligence Report, findings, citations, source documents, and processed document data. The opportunity will remain as Not Analyzed.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDeleteAnalysis} disabled={deletingAnalysis || analysisWorkActive}>
                {deletingAnalysis ? "Deleting..." : "Delete Analysis"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Status banners */}
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
                    <span className={step.state === "pending" ? "text-blue-700" : "font-medium"}>{step.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1 text-xs text-blue-800">
                <p>This usually takes 2–5 minutes.</p>
                <p>You can leave this page and come back later.</p>
                {activeAnalysisStage === "complete" && <p className="font-medium">Refreshing report...</p>}
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
              <p className="mt-1 text-sm">BidBox successfully analyzed {partialAcquisitionNotice.analyzed} of {partialAcquisitionNotice.total} available documents.</p>
            </div>
          </div>
        </div>
      )}

      {/* Intelligence not ready */}
      {!reportReady && (
        <IntelSection title="Project Intelligence" icon={<Sparkles className="h-4 w-4" />}>
          <Pending message={pendingSectionMessage} />
          {status === "failed" && (
            <p className="mt-3 text-sm text-red-700">{candidate.analysis_error ?? report?.error}</p>
          )}
        </IntelSection>
      )}

      {/* Executive Summary */}
      <IntelSection title="Executive Summary" icon={<Sparkles className="h-4 w-4" />}>
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
};

// IntelSection, CitationList, FindingsList, Pending, Unknown
// are now imported from IntelligenceReportView.

export default OpportunityReport;
