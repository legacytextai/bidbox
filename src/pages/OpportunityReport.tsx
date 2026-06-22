import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
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
  document_processing_status: string;
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

const REPORT_SECTIONS = [
  { key: "project_overview", title: "Project Overview", icon: Sparkles },
  { key: "scope_summary", title: "Scope Summary", icon: FileText },
  { key: "trade_breakdown", title: "Trade Breakdown", icon: FileText },
  { key: "key_dates", title: "Key Dates", icon: Clock },
  { key: "bid_requirements", title: "Bid Requirements", icon: CheckCircle2 },
  { key: "addenda_summary", title: "Addenda Summary", icon: FileText },
  { key: "risk_flags", title: "Risk Flags", icon: AlertTriangle },
];

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

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

const candidateTimeMinutes = (iso: string | null | undefined) => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
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

const normalizeExecutiveBulletText = (text: string | null | undefined, index: number) => {
  const value = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return value;
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

const isTerminalAnalysis = (s: AnalysisStatus) =>
  s === "ready" || s === "failed";

const OpportunityReport = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [report, setReport] = useState<ReportRow | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

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
    setReport((reportRes.data ?? null) as ReportRow | null);
    setDocuments((docsRes.data ?? []) as DocumentRow[]);
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

  useEffect(() => {
    if (!candidate) return;
    if (isTerminalAnalysis(candidate.analysis_status)) return;
    const t = window.setInterval(load, 7000);
    return () => window.clearInterval(t);
  }, [candidate, load]);

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

  const safeBidDue = useMemo(() => {
    const sourceBackedFindings = findings.filter((finding) => {
      const statusSupportsFact = finding.status === "found" || finding.status === "conflict";
      return statusSupportsFact && isBidDueFinding(finding) && (citationsByFinding.get(finding.id)?.length ?? 0) > 0;
    });

    const sourceDisplays = sourceBackedFindings
      .map((finding) => extractDateTimeDisplay(finding.value_text))
      .filter((value): value is string => Boolean(value));

    const sourceTimes = [
      ...new Set(
        sourceBackedFindings
          .map((finding) => normalizeTimeToken(finding.value_text))
          .filter((value): value is number => value !== null),
      ),
    ];

    const candidateDisplay = formatDate(candidate?.bid_due_at ?? null);
    const candidateTime = candidateTimeMinutes(candidate?.bid_due_at);
    const hasSourceConflict = sourceTimes.length > 1;
    const hasMetadataConflict =
      sourceTimes.length === 1 &&
      candidateTime !== null &&
      sourceTimes[0] !== candidateTime;

    if (hasSourceConflict) {
      return {
        display: sourceDisplays[0] ?? candidateDisplay,
        source: "Needs review",
        warning: "Multiple cited bid due times were found. Review the Key Dates citations before relying on this deadline.",
      };
    }

    if (sourceDisplays.length > 0) {
      return {
        display: sourceDisplays[0],
        source: "Source-backed",
        warning: hasMetadataConflict
          ? `Candidate metadata shows ${candidateDisplay}, but the cited source says ${sourceDisplays[0]}. Showing the cited source-backed deadline.`
          : null,
      };
    }

    return {
      display: candidateDisplay,
      source: candidate?.bid_due_at ? "Candidate metadata" : null,
      warning: null,
    };
  }, [candidate?.bid_due_at, findings, citationsByFinding]);

  const crawl = candidate?.crawl_data ?? {};
  const estimatedValue = crawl?.estimated_value as number | undefined;
  const jobWalkAt = crawl?.job_walk_at as string | undefined;
  const licenseRequirements = crawl?.license_requirements as string | undefined;
  const contractDuration = crawl?.contract_duration as string | undefined;
  const liquidatedDamages = crawl?.liquidated_damages as string | undefined;
  const department = crawl?.department as string | undefined;
  const projectAddress = crawl?.project_address as string | undefined;
  const reportReady = candidate?.analysis_status === "ready" && report;

  const handleAddToCalendar = async () => {
    if (!candidate) return;
    if (candidate.converted_project_id) {
      navigate(`/projects/${candidate.converted_project_id}`);
      return;
    }

    if (!candidate.bid_due_at) {
      toast({
        title: "Missing bid due date",
        description:
          "This opportunity has no bid due date. Open the source to confirm.",
        variant: "destructive",
      });
      return;
    }
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
      const { data: project, error } = await sb
        .from("projects")
        .insert({
          gc_id: session.user.id,
          name: candidate.raw_title ?? "Untitled Project",
          agency: candidate.agency,
          bid_due_at: candidate.bid_due_at,
          source_url: candidate.source_url,
          portal_type: candidate.portal_type,
          scope_text: scopeFinding?.value_text ?? candidate.scope_text,
          job_walk_at: jobWalkAt ?? null,
          origin: "opportunity_intelligence",
          source_opportunity_candidate_id: candidate.id,
          opportunity_intelligence_report_id: report.id,
          status: "LIVE",
        })
        .select("id")
        .single();

      if (error) throw error;

      await sb
        .from("opportunity_candidates")
        .update({
          status: "converted",
          converted_project_id: project.id,
        })
        .eq("id", candidate.id);

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
          </div>
        </div>

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
                  <span>{normalizeExecutiveBulletText(bullet.text, index)}</span>
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
            <div className="mt-3 flex items-start gap-2 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <p>{safeBidDue.warning}</p>
            </div>
          )}
        </Section>

        {REPORT_SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <Section key={section.key} title={section.title} icon={<Icon className="h-4 w-4" />}>
              <FindingsList
                findings={findingsByCategory.get(section.key) ?? []}
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
            </div>
          </div>

          <CitationList citations={citationsByFinding.get(finding.id) ?? []} />
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
