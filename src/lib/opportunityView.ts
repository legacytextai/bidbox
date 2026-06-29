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
  trade_types: { name: string } | null;
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

const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|am|pm)\b/i;
const MONTH_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/i;

function normalizeTimeToken(text: string | null | undefined): number | null {
  const match = String(text ?? "").match(TIME_RE);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3].toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (meridiem.startsWith("p") && hour !== 12) hour += 12;
  if (meridiem.startsWith("a") && hour === 12) hour = 0;
  return hour * 60 + minute;
}

function extractDateTimeDisplay(text: string | null | undefined): string | null {
  const source = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!source) return null;
  const formatted = formatProjectDateTimeOrNull(source);
  if (formatted) return formatted;
  const date = source.match(MONTH_DATE_RE)?.[0] ?? null;
  const time = source.match(TIME_RE)?.[0] ?? null;
  if (date && time) {
    const cleanedTime = time.replace(/\./g, "").replace(/\s+/g, " ").toUpperCase();
    return `${date} at ${cleanedTime}`;
  }
  return source;
}

function normalizeDateTimeText(value: string | null | undefined): string | null {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return formatProjectDateTimeOrNull(text) ?? text;
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

function isBidDueFinding(finding: { field_key: string; label: string }): boolean {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    /bid.*due/.test(haystack) ||
    /due.*date/.test(haystack) ||
    /bid.*opening/.test(haystack) ||
    /submission.*deadline/.test(haystack)
  );
}

function isJobWalkFinding(finding: { field_key: string; label: string }): boolean {
  const haystack = `${finding.field_key} ${finding.label}`.toLowerCase();
  return (
    haystack.includes("job walk") ||
    haystack.includes("pre-bid") ||
    haystack.includes("prebid") ||
    haystack.includes("site visit")
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

  // Bid due resolution
  const bidDueFindings = findings.filter((f) => {
    const statusOk = f.status === "found" || f.status === "conflict";
    return statusOk && isBidDueFinding(f) && (citationsByFinding.get(f.id)?.length ?? 0) > 0;
  });
  const f4ValueText = bidDueFindings[0]?.value_text ?? null;
  const resolved = resolveAuthoritativeBidDue({
    overrideBidDueAt: linkedProjectBidDueOverrideAt,
    overrideSource: linkedProjectBidDueOverrideSource,
    dueDateRaw: crawl?.due_date_raw as string | null | undefined,
    candidateBidDueAt: candidate.bid_due_at,
    projectBidDueAt: linkedProjectBidDueAt,
    f4ValueText,
  });
  const sourceTimes = [
    ...new Set(
      bidDueFindings
        .map((f) => normalizeTimeToken(f.value_text))
        .filter((v): v is number => v !== null),
    ),
  ];
  const hasSourceConflict = sourceTimes.length > 1;
  const sourceDisplays = bidDueFindings
    .map((f) => extractDateTimeDisplay(f.value_text))
    .filter((v): v is string => Boolean(v));
  const bidDue: BidDueData = {
    display: hasSourceConflict
      ? resolved.display !== "—"
        ? resolved.display
        : sourceDisplays[0] || "N/A"
      : resolved.display === "—"
        ? "N/A"
        : resolved.display,
    value: resolved.value,
    source: bidDueSourceLabel(resolved.source),
    warning: hasSourceConflict
      ? "Conflicting deadline evidence detected. Showing the authoritative structured deadline."
      : resolved.conflict
        ? resolved.conflictMessage ?? null
        : null,
  };

  // Job walk resolution
  const jobWalkFinding = findings.find(
    (f) =>
      (f.status === "found" || f.status === "needs_review" || f.status === "conflict") &&
      isJobWalkFinding(f) &&
      (citationsByFinding.get(f.id)?.length ?? 0) > 0,
  );
  const hasJobWalkDocumentEvidence = documents.some((d) => {
    const haystack = [d.file_name, d.document_class, d.document_family].join(" ").toLowerCase();
    return ["job walk", "pre-bid", "pre bid", "prebid", "site visit", "attendance list", "sign in", "sign-in"].some(
      (signal) => haystack.includes(signal),
    );
  });
  const jobWalkDate =
    normalizeDateTimeText(jobWalkFinding?.value_text) ||
    normalizeDateTimeText(crawl?.job_walk_at) ||
    normalizeDateTimeText(crawl?.pre_bid_meeting_at);
  const jobWalkDetailParts = [
    isAffirmative(crawl?.job_walk_mandatory) || isAffirmative(crawl?.attendance_required)
      ? "Mandatory"
      : isNegative(crawl?.job_walk_mandatory) || isNegative(crawl?.attendance_required)
        ? "Optional"
        : null,
    jobWalkDate,
    crawl?.job_walk_location ? `Location: ${String(crawl.job_walk_location).replace(/\s+/g, " ").trim()}` : null,
  ].filter((part): part is string => Boolean(part));
  let jobWalk: string | null = jobWalkDetailParts.length > 0 ? jobWalkDetailParts.join(" | ") : null;
  if (!jobWalk) {
    const hasMetadataEvidence =
      isAffirmative(crawl?.pre_bid_meeting) ||
      isAffirmative(crawl?.attendance_required) ||
      isAffirmative(crawl?.job_walk_exists) ||
      isAffirmative(crawl?.job_walk_mandatory);
    if (hasMetadataEvidence || hasJobWalkDocumentEvidence) jobWalk = "Needs Review";
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

  const { projectAddress, county } = resolveLocation(crawl);
  const normalizedBidItems: OpportunityBidItemView[] = bidItems
    .filter((item) => String(item.description ?? "").trim())
    .sort((a, b) => (a.source_order ?? 0) - (b.source_order ?? 0))
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
    estimatedValue: resolveEstimatedValue(crawl),
    estimatedValueRaw: resolveEstimatedValueRaw(crawl),
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
    bidItems: normalizedBidItems,
    bidItemsTotal: normalizedBidItems.length,
    bidItemsAvailable: normalizedBidItems.length > 0,
  };
}
