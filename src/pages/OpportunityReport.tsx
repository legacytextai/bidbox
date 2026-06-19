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
} from "lucide-react";

type AnalysisStatus =
  | "not_requested"
  | "queued"
  | "analyzing"
  | "ready"
  | "failed";

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

interface DocumentRow {
  id: string;
  file_name: string | null;
  document_class: string | null;
  document_family: string | null;
  text_page_count: number | null;
  processing_status: string | null;
}

const formatDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

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
  analyzing: "Analyzing",
  ready: "Ready",
  failed: "Failed",
};

const isTerminalAnalysis = (s: AnalysisStatus) =>
  s === "ready" || s === "failed";

const OpportunityReport = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: cand, error: candErr }, { data: docs }] = await Promise.all([
      supabase
        .from("opportunity_candidates")
        .select("*")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("opportunity_documents")
        .select(
          "id, file_name, document_class, document_family, text_page_count, processing_status",
        )
        .eq("candidate_id", id),
    ]);

    if (candErr || !cand) {
      toast({
        title: "Not found",
        description: "Opportunity could not be loaded.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setCandidate(cand as any);
    setDocuments((docs ?? []) as any);
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

  // Poll while non-terminal so live status updates appear without a refresh.
  useEffect(() => {
    if (!candidate) return;
    if (isTerminalAnalysis(candidate.analysis_status)) return;
    const t = window.setInterval(load, 7000);
    return () => window.clearInterval(t);
  }, [candidate, load]);

  const crawl = candidate?.crawl_data ?? {};
  const scope = candidate?.scope_text ?? crawl?.scope_text ?? null;
  const estimatedValue = crawl?.estimated_value as number | undefined;
  const jobWalkAt = crawl?.job_walk_at as string | undefined;

  const reportReady = candidate?.analysis_status === "ready";

  const handleAddToCalendar = async () => {
    if (!candidate) return;
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

      // If already converted, just navigate.
      if (candidate.converted_project_id) {
        navigate(`/projects/${candidate.converted_project_id}`);
        return;
      }

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          gc_id: session.user.id,
          name: candidate.raw_title ?? "Untitled Project",
          agency: candidate.agency,
          bid_due_at: candidate.bid_due_at,
          source_url: candidate.source_url,
          portal_type: candidate.portal_type,
          scope_text: scope,
          job_walk_at: jobWalkAt ?? null,
          status: "LIVE",
        })
        .select("id")
        .single();

      if (error) throw error;

      await supabase
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
        return "Analysis is queued. The report will appear once processing begins.";
      case "analyzing":
        return "Analyzing project documents. This typically takes a few minutes.";
      case "failed":
        return candidate.analysis_error ?? "Analysis failed. Please retry.";
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

  return (
    <Layout showSidebar={true}>
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        {/* Header */}
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
              disabled={adding}
              className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4 mr-2" />
              )}
              {candidate.converted_project_id
                ? "View Project"
                : "Add Project to Calendar"}
            </Button>
          </div>
        </div>

        {/* Project Overview */}
        <Section title="Project Overview" icon={<Sparkles className="h-4 w-4" />}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Field label="Agency" value={candidate.agency} />
            <Field label="Bid Due" value={formatDate(candidate.bid_due_at)} />
            <Field
              label="Estimated Value"
              value={
                typeof estimatedValue === "number" && estimatedValue > 0
                  ? `$${estimatedValue.toLocaleString("en-US")}`
                  : null
              }
            />
            <Field label="Portal" value={candidate.portal_type} />
          </dl>
        </Section>

        {/* Scope Summary */}
        <Section title="Scope Summary" icon={<FileText className="h-4 w-4" />}>
          {scope ? (
            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
              {scope}
            </p>
          ) : (
            <Pending message={pendingSectionMessage} />
          )}
        </Section>

        {/* Key Dates */}
        <Section title="Key Dates" icon={<Clock className="h-4 w-4" />}>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <Field label="Bid Due" value={formatDate(candidate.bid_due_at)} />
            <Field
              label="Job Walk"
              value={jobWalkAt ? formatDate(jobWalkAt) : null}
            />
          </dl>
        </Section>

        {/* Bid Requirements */}
        <Section
          title="Bid Requirements"
          icon={<CheckCircle2 className="h-4 w-4" />}
        >
          {reportReady ? (
            <p className="text-sm text-muted-foreground italic">
              No bid requirements were extracted by the intelligence agent.
            </p>
          ) : (
            <Pending message={pendingSectionMessage} />
          )}
        </Section>

        {/* Addenda Summary */}
        <Section title="Addenda Summary" icon={<FileText className="h-4 w-4" />}>
          {reportReady ? (
            <p className="text-sm text-muted-foreground italic">
              No addenda detected.
            </p>
          ) : (
            <Pending message={pendingSectionMessage} />
          )}
        </Section>

        {/* Risk Flags */}
        <Section
          title="Risk Flags"
          icon={<AlertTriangle className="h-4 w-4" />}
        >
          {reportReady ? (
            <p className="text-sm text-muted-foreground italic">
              No risks flagged by the intelligence agent.
            </p>
          ) : (
            <Pending message={pendingSectionMessage} />
          )}
        </Section>

        {/* Source Citations */}
        <Section
          title="Source Citations"
          icon={<FileText className="h-4 w-4" />}
        >
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

const Pending = ({ message }: { message: string }) => (
  <div className="flex items-start gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />
    <p>{message}</p>
  </div>
);

export default OpportunityReport;
