// Shared display resolvers for opportunity candidates.
// Cards, Overview tab, and future Project Workspace consume these
// rather than duplicating formatting logic inline.

import type { PortalType } from "./platformDetection";
import { resolveProjectCounty } from "./projectCountyResolver";

type SupportedPortalType = Exclude<PortalType, "unknown">;

export const PORTAL_STYLES = {
  caltrans: "bg-blue-500/10 text-blue-700",
  planetbids: "bg-violet-500/10 text-violet-700",
  epro: "bg-teal-500/10 text-teal-700",
  ersp: "bg-orange-500/10 text-orange-700",
  bonfirehub: "bg-fuchsia-500/10 text-fuchsia-700",
  ramp: "bg-indigo-500/10 text-indigo-700",
  lacounty_dpw: "bg-emerald-500/10 text-emerald-700",
  lacmta: "bg-rose-500/10 text-rose-700",
  caleprocure: "bg-cyan-500/10 text-cyan-700",
  opengov: "bg-amber-500/10 text-amber-700",
} satisfies Record<SupportedPortalType, string>;

function isSupportedPortalType(portalType: string | null | undefined): portalType is SupportedPortalType {
  return Boolean(portalType && portalType in PORTAL_STYLES);
}

export function resolveTitle(candidate: { raw_title: string | null }): string {
  return candidate.raw_title?.trim() || "Untitled Opportunity";
}

export function resolveAgency(candidate: { agency: string | null }): string | null {
  return candidate.agency?.trim() || null;
}

export function resolvePortalLabel(portalType: string | null | undefined): string | null {
  return portalType?.trim() || null;
}

export function resolvePortalStyle(portalType: string | null | undefined): string {
  return isSupportedPortalType(portalType) ? PORTAL_STYLES[portalType] : "bg-gray-500/10 text-gray-600";
}

// Portals persist deterministic metadata in two places: legacy portal-shaped
// keys inside crawl_data (PlanetBids/Caltrans) and, for OpenGov Phase 2.5,
// promoted typed candidate columns plus the crawl_data.opengov_visible_metadata
// namespace. Resolvers must consult all of them or portal-visible facts render
// as N/A (July 8 Force Main regression).

function numericEstimate(value: unknown): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

export function resolveEstimatedValue(crawlData: any, typedValue?: number | null): string | null {
  const value =
    numericEstimate(crawlData?.estimated_value) ??
    numericEstimate(crawlData?.opengov_visible_metadata?.estimated_value) ??
    numericEstimate(typedValue);
  if (value === null) return null;
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${value.toLocaleString("en-US")}`;
}

export function resolveEstimatedValueRaw(crawlData: any, typedValue?: number | null): number | null {
  return (
    numericEstimate(crawlData?.estimated_value) ??
    numericEstimate(crawlData?.opengov_visible_metadata?.estimated_value) ??
    numericEstimate(typedValue)
  );
}

export function resolveLocation(
  crawlData: any,
  typed?: { projectAddress?: string | null; county?: string | null },
): { projectAddress: string | null; county: string | null } {
  const crawlAddress =
    typeof crawlData?.project_address === "string" && crawlData.project_address.trim()
      ? crawlData.project_address.trim()
      : null;
  // Typed candidate column fallback: OpenGov persists the address only in the
  // promoted project_address column, not in crawl_data.
  const typedAddress =
    typeof typed?.projectAddress === "string" && typed.projectAddress.trim()
      ? typed.projectAddress.trim()
      : null;
  const projectAddress = crawlAddress ?? typedAddress;
  const county =
    resolveProjectCounty({ crawlData, projectAddress }) ??
    (typeof typed?.county === "string" && typed.county.trim() ? typed.county.trim() : null);
  return { projectAddress, county };
}

export function resolveSolicitationId(crawlData: any): string | null {
  const v =
    crawlData?.solicitation_number ??
    crawlData?.project_number ??
    crawlData?.bid_number ??
    crawlData?.contract_number ??
    // OpenGov Phase 2.5: confidently parsed solicitation number lives in the
    // opengov_visible_metadata namespace (e.g. "26-IFB-029").
    crawlData?.opengov_visible_metadata?.solicitation_number;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function resolveDepartment(crawlData: any): string | null {
  const v = crawlData?.department;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// Known source documents from discovery metadata (crawl_data.documents),
// normalized across portal shapes so the Documents tab can show document
// titles before any bytes exist in BidBox:
//   OpenGov:       { name, title, filename, file_extension, type }
//   Cal eProcure:  { source_key, title, file_name, file_extension }
//   PlanetBids:    { file_title, filename, file_size }
//   LA County DPW: { title, notes, pages, size }
// Uniform document policy: discovery shows titles; bytes arrive only on
// explicit user intent (docs/initiatives/uniform-document-policy.md).
export interface KnownSourceDocument {
  title: string;
  fileType: string | null;
  // Stable per-document key matching the acquisition driver's idempotency key
  // (opportunity_documents.source_url). Present only for portals with a
  // validated on-demand download path; rows without a key render title-only.
  sourceKey: string | null;
}

export function extractKnownSourceDocuments(crawlData: any): KnownSourceDocument[] {
  const docs = Array.isArray(crawlData?.documents) ? crawlData.documents : [];
  const openGovProjectId = crawlData?.opengov_project_id != null ? String(crawlData.opengov_project_id) : null;
  return docs
    .map((d: any): KnownSourceDocument => {
      const title = String(d?.title ?? d?.description ?? d?.file_title ?? d?.name ?? d?.filename ?? d?.file_name ?? "").trim();
      const fromExtField = String(d?.file_extension ?? "").trim().replace(/^\./, "");
      const fromFilename = String(d?.filename ?? d?.file_name ?? "").match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? "";
      const fileType = (fromExtField || fromFilename).toLowerCase() || null;
      const attachmentId = d?.shared_id ?? d?.id;
      const sourceKey =
        typeof d?.source_key === "string" && d.source_key.trim()
          ? d.source_key.trim()
          : typeof d?.sourceKey === "string" && d.sourceKey.trim()
            ? d.sourceKey.trim()
            : openGovProjectId && attachmentId != null
          ? `opengov://project/${openGovProjectId}/attachment/${attachmentId}`
          : null;
      return { title, fileType, sourceKey };
    })
    .filter((d: KnownSourceDocument) => d.title);
}

// OI status: maps the Phase 1 opportunity_intelligence_status field (or legacy fields) to display values.

export const OI_STATUS_LABELS: Record<string, string> = {
  not_requested: "Not Prepared",
  queued: "Preparing",
  acquiring_documents: "Acquiring Documents",
  processing_documents: "Processing Documents",
  generating_report: "Generating Intelligence",
  ready: "Intelligence Ready",
  partial: "Partial Intelligence",
  failed: "Needs Review",
};

// Semantic palette only: blue = active system action, green = success, red = failure, gray = neutral.
// Indigo and yellow are not in the design system palette and have been removed.
export const OI_STATUS_STYLES: Record<string, string> = {
  not_requested: "bg-gray-100 text-gray-500",
  queued: "bg-blue-50 text-blue-700",
  acquiring_documents: "bg-blue-50 text-blue-700",
  processing_documents: "bg-blue-50 text-blue-700",
  generating_report: "bg-blue-50 text-blue-700",
  ready: "bg-green-50 text-green-800",
  partial: "bg-gray-100 text-gray-700",
  failed: "bg-red-50 text-red-800",
};

export function resolveOIStatus(candidate: {
  opportunity_intelligence_status?: string | null;
  analysis_status?: string;
  document_acquisition_status?: string;
  document_processing_status?: string;
}): string {
  if (candidate.opportunity_intelligence_status) {
    return candidate.opportunity_intelligence_status;
  }
  // Fall back to legacy fields for backwards compatibility
  const as = candidate.analysis_status;
  if (as === "ready") return "ready";
  if (as === "analyzing") return "generating_report";
  if (as === "queued") return "queued";
  if (as === "failed") return "failed";
  const dp = candidate.document_processing_status;
  if (dp === "processing" || dp === "queued") return "processing_documents";
  const da = candidate.document_acquisition_status;
  if (da === "acquiring" || da === "queued") return "acquiring_documents";
  return "not_requested";
}

export function resolveOILabel(oiStatus: string): string {
  return OI_STATUS_LABELS[oiStatus] ?? "Unknown";
}

export function resolveOIStyle(oiStatus: string): string {
  return OI_STATUS_STYLES[oiStatus] ?? "bg-gray-500/10 text-gray-500";
}

export function isOIActive(oiStatus: string): boolean {
  return ["queued", "acquiring_documents", "processing_documents", "generating_report"].includes(oiStatus);
}

export function isOIReady(oiStatus: string): boolean {
  return oiStatus === "ready" || oiStatus === "partial";
}
