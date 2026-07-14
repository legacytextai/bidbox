// Shared Opportunities-page types, moved verbatim from src/pages/Opportunities.tsx
// during the facelift page decomposition. The route container, the protected
// card component, and the tab-membership predicates all consume this single
// Candidate shape.

export type CandidateStatus = "pending" | "red" | "yellow" | "green" | "converted";
export type AutoStatus = "green" | "yellow" | "red" | null;
export type AnalysisStatus = "not_requested" | "queued" | "analyzing" | "ready" | "failed";
export type DocumentAcquisitionStatus = "not_requested" | "queued" | "acquiring" | "acquired" | "failed";
export type DocumentProcessingStatus = "not_requested" | "queued" | "processing" | "processed" | "partial" | "failed";

export interface Candidate {
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
  estimated_value: number | null;
  estimated_value_low: number | null;
  estimated_value_high: number | null;
  county: string | null;
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
  ingestion_status: string;
  ingestion_issue_reason: string | null;
  global_exclusion_code: string | null;
  global_exclusion_reason: string | null;
  canonical_candidate_id: string | null;
}

// Transient (per-tab) anchor for restoring list position when navigating back
// from a detail page. Session-only by design — never persisted across browser
// sessions. Survives a hard refresh of the detail page because it lives in
// sessionStorage rather than component/router state.
export const SCROLL_ANCHOR_KEY = "bidbox:opportunities:scrollAnchor";
