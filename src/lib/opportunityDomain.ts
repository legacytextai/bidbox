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

export function resolveEstimatedValue(crawlData: any): string | null {
  const value = crawlData?.estimated_value;
  if (typeof value !== "number" || value <= 0) return null;
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (value >= 1_000) {
    return `$${Math.round(value / 1_000)}K`;
  }
  return `$${value.toLocaleString("en-US")}`;
}

export function resolveEstimatedValueRaw(crawlData: any): number | null {
  const value = crawlData?.estimated_value;
  return typeof value === "number" && value > 0 ? value : null;
}

export function resolveLocation(crawlData: any): { projectAddress: string | null; county: string | null } {
  const projectAddress =
    typeof crawlData?.project_address === "string" && crawlData.project_address.trim()
      ? crawlData.project_address.trim()
      : null;
  const county = resolveProjectCounty({ crawlData, projectAddress });
  return { projectAddress, county };
}

export function resolveSolicitationId(crawlData: any): string | null {
  const v =
    crawlData?.solicitation_number ??
    crawlData?.project_number ??
    crawlData?.bid_number ??
    crawlData?.contract_number;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function resolveDepartment(crawlData: any): string | null {
  const v = crawlData?.department;
  return typeof v === "string" && v.trim() ? v.trim() : null;
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
