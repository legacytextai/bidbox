// Stable presentation contract for the Opportunity Overview.
//
// The UI consumes OpportunityOverviewData — a single unified model.
// The adapter (buildOpportunityOverviewData) composes fields from multiple
// underlying data sources. Future sources (bid items, additional metadata)
// are additive: update the adapter without touching the UI.

import {
  resolveTitle,
  resolveAgency,
  resolvePortalLabel,
  resolveEstimatedValue,
  resolveEstimatedValueRaw,
  resolveLocation,
  resolveSolicitationId,
  resolveDepartment,
  resolveOIStatus,
} from "./opportunityDomain";
import { resolveAuthoritativeBidDue } from "./bidDueResolver";
import { formatProjectDateTimeOrNull } from "./timezoneUtils";

export interface BidDueData {
  display: string;
  value: string | null;
  source: string | null;
  warning: string | null;
}

export interface KeyDateItem {
  id: string;
  label: string;
  display: string;
  isCritical: boolean;
}

export interface RequirementItem {
  id: string;
  label: string;
  value: string;
  isCritical: boolean;
}

export interface OpportunityBidItemView {
  id: string;
  itemNumber: string | null;
  itemCode: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  sectionName: string | null;
  extractionMethod: string;
  extractionStatus: string;
  sourceOrder: number;
}

// The single model the Overview tab consumes.
// Fields never removed — missing data uses null, not absence of field.
export interface OpportunityOverviewData {
  // Identity
  title: string;
  agency: string | null;
  department: string | null;
  solicitationId: string | null;
  portalType: string | null;
  sourceUrl: string;

  // Value
  estimatedValue: string | null;
  estimatedValueRaw: number | null;

  // Location
  projectAddress: string | null;
  county: string | null;

  // Dates
  bidDue: BidDueData;
  jobWalk: string | null;

  // Quick facts
  licenseRequirements: string | null;
  contractDuration: string | null;
  liquidatedDamages: string | null;

  // Executive summary lines (empty array if OI not ready)
  executiveSummary: string[];

  // Key dates from findings (excluding bid due, which lives in bidDue)
  keyDates: KeyDateItem[];

  // Important requirements (critical bid_requirements findings)
  importantRequirements: RequirementItem[];

  // Documents
  documentCount: number;

  // OI intelligence
  oiStatus: string;
  oiReadyAt: string | null;

  // Lifecycle
  lifecycleStatus: string;
  convertedProjectId: string | null;

  // Portal Intelligence (pre-F4 summary)
  portalSummary: string | null;
  portalSummaryAt: string | null;

  // Bid items
  bidItems: OpportunityBidItemView[];
  bidItemsTotal: number;
  bidItemsAvailable: boolean;
}

// ─── Project Workspace shared types ──────────────────────────────────────────
// These describe the rows ProjectDetail loads from Supabase before handing
// them to <ProjectWorkspace />. Tabs consume these instead of `any`.

export type PursuitStatus = "reviewing" | "pursuing" | "passed" | "submitted";

export interface WorkspaceProject {
  id: string;
  name: string;
  agency: string | null;
  county: string | null;
  bid_due_at: string | null;
  source_url: string | null;
  public_token: string;
  gc_id: string | null;
  source_opportunity_candidate_id: string | null;
  // Optional / not always present on production rows.
  pursuit_status?: string | null;
  pursuit_status_updated_at?: string | null;
  added_to_calendar_at?: string | null;
}

export interface WorkspaceProjectFile {
  id: string;
  file_name: string;
  file_url: string;
}

export interface WorkspaceProjectTrade {
  id: string;
  trade_type_id: string;
  trade_types: { code: string; name: string; category: string | null } | null;
}

export interface WorkspaceProjectSubmissionFile {
  file_name: string;
  file_url: string;
}

export interface WorkspaceProjectSubmission {
  submission_id: string;
  submitted_at: string;
  bidder_name?: string;
  company_name?: string;
  email?: string;
  bid_item?: string;
  files: WorkspaceProjectSubmissionFile[];
}

// ─── Helpers (mirrored from OpportunityReport.tsx, extracted here so the
//     adapter layer owns them rather than individual pages) ─────────────────

function normalizeDateTimeText(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return formatProjectDateTimeOrNull(text) ?? text;
}

function formatSnapshotDateTime(value: string | null | undefined): string | null {
  const formatted = normalizeDateTimeText(value);
  if (!formatted) return null;
  return formatted.replace(/\s+at\s+/i, "\n");
}

function splitSnapshotDateTime(value: string | null): { date: string | null; time: string | null } {
  if (!value) return { date: null, time: null };
  const [date, ...timeParts] = value.split("\n");
  return {
    date: date?.trim() || null,
    time: timeParts.join(" ").trim() || null,
  };
}

function isAffirmative(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  if (isNegative(value)) return false;
  return /\b(yes|true|required|mandatory|must|attendance required)\b/i.test(value.trim());
}

function isNegative(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value !== "string") return false;
  return /\b(no|false|optional|not required|not mandatory)\b/i.test(value.trim());
}

function cleanDisplayText(value: unknown): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}

function isBidDueFinding(finding: { field_key: string; label: string }): boolean {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    /bid.*due/.test(haystack) ||
    /due.*date/.test(haystack) ||
    /bid.*opening/.test(haystack) ||
    /submission.*deadline/.test(haystack)
  );
}

function bidDueSourceLabel(source: string | null | undefined): string | null {
  if (source === "manual_override") return "Manual override";
  if (source === "deadline_candidate_override") return "Selected evidence override";
  if (source === "portal_metadata") return "Portal metadata";
  if (source === "candidate_metadata") return "Candidate metadata";
  if (source === "project_metadata") return "Project metadata";
  if (source === "f4_fallback") return "F4 fallback";
  return null;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

export interface AdapterInput {
  candidate: {
    id: string;
    raw_title: string | null;
    agency: string | null;
    bid_due_at: string | null;
    source_url: string;
    portal_type: string | null;
    crawl_data: any;
    status: string;
    converted_project_id: string | null;
    analysis_status?: string;
    document_acquisition_status?: string;
    document_processing_status?: string;
    opportunity_intelligence_status?: string | null;
    opportunity_intelligence_ready_at?: string | null;
    opportunity_lifecycle_status?: string | null;
    // Promoted typed columns (worker-owned). OpenGov persists estimate/address
    // here rather than in portal-shaped crawl_data keys; the snapshot must read
    // them or portal-visible facts render as N/A.
    estimated_value?: number | null;
    portal_bid_id?: string | null;
    project_address?: string | null;
    county?: string | null;
  };
  report: {
    executive_summary?: { bullets?: Array<{ text: string }> };
  } | null;
  findings: Array<{
    id: string;
    category: string;
    field_key: string;
    label: string;
    value_text: string | null;
    status: string;
    confidence: string;
    is_critical: boolean;
    sort_order: number;
  }>;
  citationsByFinding: Map<string, Array<{ id: string }>>;
  documents: Array<{
    id: string;
    file_name: string | null;
    document_class: string | null;
    document_family: string | null;
  }>;
  bidItems: Array<{
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
  }>;
  linkedProjectBidDueAt: string | null;
  linkedProjectBidDueOverrideAt: string | null;
  linkedProjectBidDueOverrideSource: string | null;
  linkedProjectBidDueOverrideReason: string | null;
}

export function buildOpportunityOverviewData(input: AdapterInput): OpportunityOverviewData {
  const {
    candidate,
    report,
    findings,
    citationsByFinding,
    documents,
    bidItems,
    linkedProjectBidDueAt,
    linkedProjectBidDueOverrideAt,
    linkedProjectBidDueOverrideSource,
  } = input;

  const crawl = candidate.crawl_data ?? {};

  // Bid due resolution for Project Snapshot uses structured portal/project
  // metadata only. Intelligence findings stay in the Intelligence tab.
  const resolved = resolveAuthoritativeBidDue({
    overrideBidDueAt: linkedProjectBidDueOverrideAt,
    overrideSource: linkedProjectBidDueOverrideSource,
    dueDateRaw: crawl?.due_date_raw as string | null | undefined,
    candidateBidDueAt: candidate.bid_due_at,
    projectBidDueAt: linkedProjectBidDueAt,
    f4ValueText: null,
  });
  const bidDue: BidDueData = {
    display: resolved.display === "—"
        ? "N/A"
        : resolved.display,
    value: resolved.value,
    source: bidDueSourceLabel(resolved.source),
    warning: resolved.conflict
        ? resolved.conflictMessage ?? null
        : null,
  };

  // Job walk resolution
  // OpenGov Phase 2 persists the pre-bid/site-visit block as a structured
  // object: crawl_data.pre_bid = { date, text, location }. PlanetBids/Caltrans
  // use flat portal-shaped keys. Support both.
  const ogPreBid =
    crawl?.pre_bid && typeof crawl.pre_bid === "object" && !Array.isArray(crawl.pre_bid)
      ? crawl.pre_bid
      : null;
  const preBidDateTime =
    crawl?.pre_bid_meeting_at ||
    crawl?.meeting_datetime ||
    crawl?.job_walk_at ||
    crawl?.prebid_meeting_at ||
    ogPreBid?.date;
  const portalJobWalkDate =
    formatSnapshotDateTime(preBidDateTime);
  const portalJobWalkDateParts = splitSnapshotDateTime(portalJobWalkDate);
  const preBidMeetingLink = crawl?.pre_bid_meeting_link ?? crawl?.meeting_link;
  const preBidLocation =
    crawl?.pre_bid_location ?? crawl?.meeting_location ?? crawl?.job_walk_location ?? ogPreBid?.location;
  const preBidNotes = crawl?.pre_bid_notes ?? crawl?.additional_details;
  const ogPreBidMandatory = /mandatory/i.test(String(ogPreBid?.text ?? ""));
  const portalJobWalkExists =
    isAffirmative(crawl?.pre_bid_exists) ||
    isAffirmative(crawl?.pre_bid_meeting) ||
    isAffirmative(crawl?.job_walk_exists) ||
    Boolean(portalJobWalkDate || preBidMeetingLink || preBidLocation || preBidNotes);
  const preBidMeetingLabel =
    isAffirmative(crawl?.pre_bid_exists) ||
    isAffirmative(crawl?.pre_bid_meeting) ||
    isAffirmative(crawl?.job_walk_exists)
      ? "Yes"
      : portalJobWalkExists
        ? "Unknown"
        : null;
  const attendanceRequired =
    isAffirmative(crawl?.attendance_required) || isAffirmative(crawl?.job_walk_mandatory) || ogPreBidMandatory
      ? "Yes"
      : isNegative(crawl?.attendance_required) || isNegative(crawl?.job_walk_mandatory)
        ? "No"
        : portalJobWalkExists
          ? "Unknown"
          : null;
  const locationText = cleanDisplayText(preBidLocation);
  const resolvedLocation = locationText ?? (preBidMeetingLink ? "Virtual" : null);
  // meeting_type distinguishes "Pre-Bid Meeting" vs "Job Walk" vs "Mandatory Job Walk" etc.
  const meetingTypeLabel = cleanDisplayText(crawl?.meeting_type) || "Pre-Bid Meeting";
  const jobWalkDetailParts = portalJobWalkExists
    ? [
        meetingTypeLabel,
        // attendanceRequired reads portal attendance_required / job_walk_mandatory directly.
        // Never derive "Attendance Required" from meeting-existence — those are separate facts.
        attendanceRequired !== null ? `Attendance Required: ${attendanceRequired}` : null,
        `Date: ${portalJobWalkDateParts.date ?? "Unknown"}`,
        `Time: ${portalJobWalkDateParts.time ?? "Unknown"}`,
        resolvedLocation ? `Location: ${resolvedLocation}` : null,
        preBidMeetingLink ? `Meeting Link: ${cleanDisplayText(preBidMeetingLink)}` : null,
        preBidNotes ? `Additional Details: ${cleanDisplayText(preBidNotes)}` : null,
      ].filter((part): part is string => Boolean(part))
    : [];
  let jobWalk: string | null = jobWalkDetailParts.length > 0 ? jobWalkDetailParts.join("\n") : null;
  if (!jobWalk) {
    const portalExplicitlyNo =
      isNegative(crawl?.pre_bid_exists) ||
      isNegative(crawl?.pre_bid_meeting);
    if (portalExplicitlyNo) {
      jobWalk = "No Pre-Bid Meeting";
    } else {
      const hasMetadataEvidence =
        isAffirmative(crawl?.pre_bid_exists) ||
        isAffirmative(crawl?.pre_bid_meeting) ||
        isAffirmative(crawl?.attendance_required) ||
        isAffirmative(crawl?.job_walk_exists) ||
        isAffirmative(crawl?.job_walk_mandatory);
      if (hasMetadataEvidence) jobWalk = "Unknown";
    }
  }

  // Executive summary: short lines from F4 (up to 3)
  const rawBullets: Array<{ text: string }> = Array.isArray(report?.executive_summary?.bullets)
    ? report!.executive_summary!.bullets!
    : [];
  const executiveSummary = rawBullets
    .slice(0, 3)
    .map((b) => String(b.text ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Key dates from findings (excluding bid due — that's in bidDue above)
  const keyDateFindings = findings.filter(
    (f) =>
      f.category === "key_dates" &&
      !isBidDueFinding(f) &&
      (f.status === "found" || f.status === "needs_review") &&
      f.value_text,
  );
  const keyDates: KeyDateItem[] = keyDateFindings.map((f) => ({
    id: f.id,
    label: f.label,
    display: normalizeDateTimeText(f.value_text) ?? f.value_text ?? "N/A",
    isCritical: f.is_critical,
  }));

  // Important requirements (critical bid_requirements findings)
  const requirementFindings = findings
    .filter(
      (f) =>
        f.category === "bid_requirements" &&
        f.status === "found" &&
        f.is_critical &&
        f.value_text,
    )
    .slice(0, 5);
  const importantRequirements: RequirementItem[] = requirementFindings.map((f) => ({
    id: f.id,
    label: f.label,
    value: f.value_text!,
    isCritical: f.is_critical,
  }));

  const { projectAddress, county } = resolveLocation(crawl, {
    projectAddress: candidate.project_address ?? null,
    county: candidate.county ?? null,
  });

  // Bid item ordering: source_order can collide across price tables (OpenGov
  // persists per-table indexes, so two tables both start at 1 and the rows
  // interleave as 1, 5a, 2, 5b, …). When every row carries an item number,
  // natural-sort on it (1, 2, …, 5a, 5b — numeric-aware) so the schedule reads
  // like the portal; otherwise fall back to source_order.
  const filteredBidItems = bidItems
    .filter((item) => String(item.description ?? "").trim())
    .filter((item) => item.extraction_method === "portal_tab");
  const allHaveItemNumbers =
    filteredBidItems.length > 0 &&
    filteredBidItems.every((item) => String(item.item_number ?? "").trim());
  const bidItemComparator = allHaveItemNumbers
    ? (a: (typeof filteredBidItems)[number], b: (typeof filteredBidItems)[number]) =>
        String(a.item_number).localeCompare(String(b.item_number), undefined, {
          numeric: true,
          sensitivity: "base",
        }) || (a.source_order ?? 0) - (b.source_order ?? 0)
    : (a: (typeof filteredBidItems)[number], b: (typeof filteredBidItems)[number]) =>
        (a.source_order ?? 0) - (b.source_order ?? 0);
  const normalizedBidItems: OpportunityBidItemView[] = filteredBidItems
    .sort(bidItemComparator)
    .map((item) => ({
      id: item.id,
      itemNumber: item.item_number,
      itemCode: item.item_code,
      description: String(item.description ?? "").replace(/\s+/g, " ").trim(),
      quantity:
        item.quantity_raw ??
        (typeof item.quantity === "number"
          ? item.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 })
          : null),
      unit: item.unit_of_measure,
      sectionName: item.section_name,
      extractionMethod: item.extraction_method,
      extractionStatus: item.extraction_status,
      sourceOrder: item.source_order ?? 0,
    }));

  return {
    title: resolveTitle(candidate),
    agency: resolveAgency(candidate),
    department: resolveDepartment(crawl),
    solicitationId: resolveSolicitationId(crawl),
    portalType: resolvePortalLabel(candidate.portal_type),
    sourceUrl: candidate.source_url,
    estimatedValue: resolveEstimatedValue(crawl, candidate.estimated_value ?? null),
    estimatedValueRaw: resolveEstimatedValueRaw(crawl, candidate.estimated_value ?? null),
    projectAddress,
    county,
    bidDue,
    jobWalk,
    licenseRequirements: crawl?.license_requirements ?? null,
    contractDuration: crawl?.contract_duration ?? null,
    liquidatedDamages: crawl?.liquidated_damages ?? null,
    executiveSummary,
    keyDates,
    importantRequirements,
    documentCount: documents.length,
    oiStatus: resolveOIStatus(candidate),
    oiReadyAt: candidate.opportunity_intelligence_ready_at ?? null,
    lifecycleStatus: candidate.opportunity_lifecycle_status ?? "discovered",
    convertedProjectId: candidate.converted_project_id,
    portalSummary: (candidate as any).portal_summary ?? null,
    portalSummaryAt: (candidate as any).portal_summary_at ?? null,
    bidItems: normalizedBidItems,
    bidItemsTotal: normalizedBidItems.length,
    bidItemsAvailable: normalizedBidItems.length > 0,
  };
}
