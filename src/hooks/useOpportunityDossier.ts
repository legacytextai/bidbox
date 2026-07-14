// Data access layer for the Opportunity Dossier.
// Replaces the inline query logic in OpportunityReport.tsx and provides
// the same data to any future surface that needs a single opportunity's full context.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { buildOpportunityOverviewData, type OpportunityOverviewData } from "@/lib/opportunityView";

// ─── Raw shape types (what Supabase returns) ──────────────────────────────────

export interface DossierCandidate {
  id: string;
  source_url: string;
  portal_type: string | null;
  raw_title: string | null;
  agency: string | null;
  bid_due_at: string | null;
  scope_text: string | null;
  status: string;
  converted_project_id: string | null;
  crawl_data: any;
  analysis_status: string;
  analysis_error: string | null;
  document_acquisition_status: string;
  document_acquisition_error: string | null;
  document_processing_status: string;
  document_processing_error: string | null;
  opportunity_lifecycle_status: string | null;
  opportunity_intelligence_status: string | null;
  opportunity_intelligence_task_id: string | null;
  opportunity_intelligence_ready_at: string | null;
  opportunity_intelligence_error: string | null;
  portal_summary: string | null;
  portal_summary_at: string | null;
}

export interface DossierReport {
  id: string;
  status: string;
  title: string | null;
  executive_summary: any;
  confidence_score: number | null;
  error: string | null;
  completed_at: string | null;
  generation_metadata: any | null;
}

export interface DossierFinding {
  id: string;
  category: string;
  field_key: string;
  label: string;
  value_text: string | null;
  value_jsonb: any | null;
  status: string;
  confidence: "high" | "medium" | "low";
  is_critical: boolean;
  sort_order: number;
  notes: string | null;
}

export interface DossierCitation {
  id: string;
  finding_id: string;
  source_document_name: string;
  page_number: number | null;
  page_label: string | null;
  source_excerpt: string;
  citation_label: string | null;
  opportunity_document_chunk_id: string;
}

export interface DossierDocument {
  id: string;
  file_name: string | null;
  document_class: string | null;
  document_family: string | null;
  text_page_count: number | null;
  processing_status: string | null;
  acquisition_status: string | null;
  storage_path: string | null;
  storage_bucket: string | null;
}

export interface DossierBidItem {
  id: string;
  item_number: string | null;
  item_code: string | null;
  description: string | null;
  quantity: number | null;
  quantity_raw: string | null;
  unit_of_measure: string | null;
  section_name: string | null;
  extraction_method: string;
  extraction_status: string;
  source_order: number | null;
}

export interface DossierActiveTask {
  id: string;
  task_type: string;
  status: string;
  payload: any | null;
}

export interface DossierLinkedProject {
  bidDueAt: string | null;
  bidDueOverrideAt: string | null;
  bidDueOverrideSource: string | null;
  bidDueOverrideReason: string | null;
}

// ─── Return type ─────────────────────────────────────────────────────────────

export interface UseOpportunityDossierResult {
  loading: boolean;
  candidate: DossierCandidate | null;
  report: DossierReport | null;
  findings: DossierFinding[];
  citations: DossierCitation[];
  citationsByFinding: Map<string, DossierCitation[]>;
  findingsByCategory: Map<string, DossierFinding[]>;
  documents: DossierDocument[];
  bidItems: DossierBidItem[];
  activeTask: DossierActiveTask | null;
  linkedProject: DossierLinkedProject;
  overview: OpportunityOverviewData | null;
  // derived
  reportReady: boolean;
  analysisWorkActive: boolean;
  reload: () => void;
  setCandidate: React.Dispatch<React.SetStateAction<DossierCandidate | null>>;
}

const ACTIVE_TASK_STATUSES = ["pending", "running", "retrying"];
const ACTIVE_ANALYSIS_STATUSES = ["queued", "analyzing"];
const ACTIVE_DOCUMENT_STATUSES = ["queued", "acquiring"];
const ACTIVE_PROCESSING_STATUSES = ["queued", "processing"];

export function useOpportunityDossier(id: string | undefined): UseOpportunityDossierResult {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [candidate, setCandidate] = useState<DossierCandidate | null>(null);
  const [report, setReport] = useState<DossierReport | null>(null);
  const [findings, setFindings] = useState<DossierFinding[]>([]);
  const [citations, setCitations] = useState<DossierCitation[]>([]);
  const [documents, setDocuments] = useState<DossierDocument[]>([]);
  const [bidItems, setBidItems] = useState<DossierBidItem[]>([]);
  const [activeTask, setActiveTask] = useState<DossierActiveTask | null>(null);
  const [linkedProject, setLinkedProject] = useState<DossierLinkedProject>({
    bidDueAt: null,
    bidDueOverrideAt: null,
    bidDueOverrideSource: null,
    bidDueOverrideReason: null,
  });

  const load = useCallback(async () => {
    if (!id) return;
    const sb = supabase as any;

    const candRes = await sb
      .from("opportunity_candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (candRes.error || !candRes.data) {
      toast({ title: "Not found", description: "Opportunity could not be loaded.", variant: "destructive" });
      setLoading(false);
      return;
    }

    const [reportRes, docsRes, bidItemsRes, activeTaskRes] = await Promise.all([
      sb
        .from("opportunity_intelligence_reports")
        .select("*")
        .eq("opportunity_candidate_id", id)
        .in("status", ["ready", "partial"])
        .order("report_version", { ascending: false })
        .limit(1)
        .maybeSingle(),
      sb
        .from("opportunity_documents")
        .select("id, file_name, document_class, document_family, text_page_count, processing_status, acquisition_status, storage_path, storage_bucket")
        .eq("opportunity_candidate_id", id)
        .order("document_source_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
      sb
        .from("opportunity_bid_items")
        .select("id, item_number, item_code, description, quantity, quantity_raw, unit_of_measure, section_name, extraction_method, extraction_status, source_order")
        .eq("opportunity_candidate_id", id)
        .eq("extraction_method", "portal_tab")
        .order("source_order", { ascending: true })
        .order("created_at", { ascending: true }),
      sb
        .from("agent_tasks")
        .select("id, task_type, status, payload")
        .in("task_type", ["project_analysis", "document_processing", "project_intelligence"])
        .in("status", ACTIVE_TASK_STATUSES)
        .contains("payload", { candidate_id: id })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Resolve linked project for bid due overrides
    let proj: DossierLinkedProject = { bidDueAt: null, bidDueOverrideAt: null, bidDueOverrideSource: null, bidDueOverrideReason: null };
    const projectFields = "id, bid_due_at, bid_due_override_at, bid_due_override_source, bid_due_override_reason";
    const linkedProjectRes = await sb.from("projects").select(projectFields).eq("origin", "opportunity_intelligence").eq("source_opportunity_candidate_id", id).maybeSingle();
    const tenantProjectId = linkedProjectRes.data?.id ?? null;
    if (linkedProjectRes.data) {
      proj = {
        bidDueAt: linkedProjectRes.data.bid_due_at ?? null,
        bidDueOverrideAt: linkedProjectRes.data.bid_due_override_at ?? null,
        bidDueOverrideSource: linkedProjectRes.data.bid_due_override_source ?? null,
        bidDueOverrideReason: linkedProjectRes.data.bid_due_override_reason ?? null,
      };
    }

    let findingRows: DossierFinding[] = [];
    let citationRows: DossierCitation[] = [];
    if (reportRes.data?.id) {
      const [findingsRes, citationsRes] = await Promise.all([
        sb
          .from("opportunity_intelligence_findings")
          .select("*")
          .eq("report_id", reportRes.data.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        sb
          .from("opportunity_intelligence_citations")
          .select("*")
          .eq("report_id", reportRes.data.id)
          .order("created_at", { ascending: true }),
      ]);
      findingRows = (findingsRes.data ?? []) as DossierFinding[];
      citationRows = (citationsRes.data ?? []) as DossierCitation[];
    }

    // The project link is tenant-owned. Ignore the legacy global candidate
    // pointer and derive it through project RLS for the signed-in user.
    setCandidate({ ...candRes.data, converted_project_id: tenantProjectId } as DossierCandidate);
    setReport((reportRes.data ?? null) as DossierReport | null);
    setDocuments((docsRes.data ?? []) as DossierDocument[]);
    setBidItems((bidItemsRes.data ?? []) as DossierBidItem[]);
    setActiveTask((activeTaskRes.data ?? null) as DossierActiveTask | null);
    setFindings(findingRows);
    setCitations(citationRows);
    setLinkedProject(proj);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }
      load();
    })();
  }, [navigate, load]);

  const citationsByFinding = useMemo(() => {
    const map = new Map<string, DossierCitation[]>();
    citations.forEach((c) => {
      const list = map.get(c.finding_id) ?? [];
      list.push(c);
      map.set(c.finding_id, list);
    });
    return map;
  }, [citations]);

  const findingsByCategory = useMemo(() => {
    const map = new Map<string, DossierFinding[]>();
    findings.forEach((f) => {
      const list = map.get(f.category) ?? [];
      list.push(f);
      map.set(f.category, list);
    });
    return map;
  }, [findings]);

  const reportReady = Boolean(
    (candidate?.analysis_status === "ready" || candidate?.opportunity_intelligence_status === "ready") && report,
  );

  const analysisWorkActive = Boolean(
    activeTask ||
      (candidate && ACTIVE_ANALYSIS_STATUSES.includes(candidate.analysis_status)) ||
      (candidate && ACTIVE_DOCUMENT_STATUSES.includes(candidate.document_acquisition_status)) ||
      (candidate && ACTIVE_PROCESSING_STATUSES.includes(candidate.document_processing_status)),
  );

  // Poll while analysis is active
  const pollRef = useRef(false);
  useEffect(() => {
    if (!analysisWorkActive || !candidate) return;
    const t = window.setInterval(async () => {
      if (pollRef.current) return;
      pollRef.current = true;
      try { await load(); } finally { pollRef.current = false; }
    }, 5000);
    return () => window.clearInterval(t);
  }, [analysisWorkActive, candidate, load]);

  const overview = useMemo<OpportunityOverviewData | null>(() => {
    if (!candidate) return null;
    return buildOpportunityOverviewData({
      candidate,
      report,
      findings,
      citationsByFinding,
      documents,
      bidItems,
      linkedProjectBidDueAt: linkedProject.bidDueAt,
      linkedProjectBidDueOverrideAt: linkedProject.bidDueOverrideAt,
      linkedProjectBidDueOverrideSource: linkedProject.bidDueOverrideSource,
      linkedProjectBidDueOverrideReason: linkedProject.bidDueOverrideReason,
    });
  }, [candidate, report, findings, citationsByFinding, documents, bidItems, linkedProject]);

  return {
    loading,
    candidate,
    report,
    findings,
    citations,
    citationsByFinding,
    findingsByCategory,
    documents,
    bidItems,
    activeTask,
    linkedProject,
    overview,
    reportReady,
    analysisWorkActive,
    reload: load,
    setCandidate,
  };
}
