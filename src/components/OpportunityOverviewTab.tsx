// Overview tab — stable template. All sections always render.
// Missing fields show N/A / Not identified — sections are never added or removed.
//
// Section structure follows docs/design-guidelines.md §Component Standards — Opportunity Overview:
//   1. Project Snapshot   2. Executive Summary   3. Bid Items

import { AlertTriangle, Loader2 } from "lucide-react";
import type { OpportunityOverviewData } from "@/lib/opportunityView";
import { isOIActive, isOIReady, resolveOILabel } from "@/lib/opportunityDomain";

interface Props {
  data: OpportunityOverviewData;
}

export function OpportunityOverviewTab({ data }: Props) {
  const oiReady = isOIReady(data.oiStatus);
  const oiActive = isOIActive(data.oiStatus);

  const hasIntelligence =
    oiReady &&
    (data.executiveSummary.length > 0 ||
      !!data.licenseRequirements ||
      data.importantRequirements.length > 0);
  const briefing = buildBriefing(data);

  return (
    <div className="space-y-5">

      {/* ── 1. Project Snapshot ─────────────────────────────────────────── */}
      <OverviewSection title="Project Snapshot">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-6">
          <SnapshotField label="Agency"             value={data.agency} />
          <SnapshotField label="Department"         value={data.department} />
          <SnapshotField label="Solicitation No."   value={data.solicitationId} />
          <SnapshotField label="Bid Due"            value={data.bidDue.display} />
          <SnapshotField label="Job Walk / Pre-Bid" value={data.jobWalk} />
          <SnapshotField label="Estimated Value"    value={data.estimatedValue} />
          <SnapshotField label="Contract Duration"  value={data.contractDuration} />
          <SnapshotField label="Liquidated Damages" value={data.liquidatedDamages} />
          <SnapshotField label="County"             value={data.county} />
          <SnapshotField label="Location"           value={data.projectAddress} />
          <SnapshotField label="Portal"             value={data.portalType} />
        </dl>
        {data.bidDue.warning && (
          <div className="mt-6 flex items-start gap-2.5 rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-600" />
            <p>{data.bidDue.warning}</p>
          </div>
        )}
      </OverviewSection>

      {/* ── 2. Executive Summary — one structured estimator briefing ─────── */}
      <OverviewSection title="Executive Summary">
        {hasIntelligence ? (
          <div className="max-w-4xl space-y-7">
            {briefing.projectOverview && (
              <BriefingBlock title="Project Overview">
                <p className="text-[15px] leading-7 text-foreground">
                  {briefing.projectOverview}
                </p>
              </BriefingBlock>
            )}

            {briefing.majorRequirements.length > 0 && (
              <BriefingBlock title="Major Requirements">
                <BriefingList items={briefing.majorRequirements} />
              </BriefingBlock>
            )}

            {(data.licenseRequirements || briefing.licenseRequirements.length > 0) && (
              <BriefingBlock title="Required Licenses">
                <BriefingList
                  items={[
                    data.licenseRequirements,
                    ...briefing.licenseRequirements,
                  ].filter((item): item is string => Boolean(item))}
                />
              </BriefingBlock>
            )}

            {briefing.bondRequirements.length > 0 && (
              <BriefingBlock title="Bond Requirements">
                <BriefingList items={briefing.bondRequirements} />
              </BriefingBlock>
            )}

            {briefing.primaryRisks.length > 0 && (
              <BriefingBlock title="Primary Risks">
                <BriefingList items={briefing.primaryRisks} />
              </BriefingBlock>
            )}
          </div>
        ) : oiActive ? (
          <PlaceholderStatus
            icon="spinner"
            message={`Intelligence is being prepared — ${resolveOILabel(data.oiStatus).toLowerCase()}.`}
          />
        ) : oiReady ? (
          <PlaceholderStatus
            icon="none"
            message="No intelligence was generated for this opportunity."
          />
        ) : (
          <PlaceholderStatus
            icon="none"
            message="Intelligence has not been prepared yet. BidBox will prepare this opportunity during the automated refresh pipeline."
          />
        )}
      </OverviewSection>

      {/* ── 3. Bid Items ─────────────────────────────────────────────────── */}
      <OverviewSection title="Bid Items">
        <p className="text-sm text-muted-foreground">
          Structured bid items coming soon.
        </p>
      </OverviewSection>

    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OverviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg px-8 py-7">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-foreground mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BriefingBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-2">{title}</h3>
      {children}
    </div>
  );
}

function BriefingList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm leading-6 text-foreground">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-2.5">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-foreground/35 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function cleanBriefingLine(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/^project overview\s*:\s*/i, "")
    .replace(/^scope text\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function requirementSentence(req: { label: string; value: string }) {
  const label = req.label.replace(/\s+/g, " ").trim();
  const value = req.value.replace(/\s+/g, " ").trim();
  if (!label) return value;
  if (!value) return label;
  return `${label}: ${value}`;
}

function uniqueLines(items: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return items
    .map(cleanBriefingLine)
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildBriefing(data: OpportunityOverviewData) {
  const summaryLines = uniqueLines(data.executiveSummary);
  const projectOverview =
    summaryLines.find((line) => /project|work|improvement|construction|rehabilitation|services/i.test(line)) ??
    summaryLines[0] ??
    null;
  const remainingSummary = summaryLines.filter((line) => line !== projectOverview);

  const licenseRequirements: string[] = [];
  const bondRequirements: string[] = [];
  const primaryRisks: string[] = [];
  const majorRequirements: string[] = [];

  for (const req of data.importantRequirements) {
    const text = requirementSentence(req);
    const haystack = `${req.label} ${req.value}`.toLowerCase();
    if (/license|class\s+[a-z0-9]/i.test(haystack)) licenseRequirements.push(text);
    else if (/bond|bid security|surety/i.test(haystack)) bondRequirements.push(text);
    else if (/liquidated|damage|risk|constraint|mandatory|insurance|prevailing|dir|pre[- ]?bid|job walk/i.test(haystack)) primaryRisks.push(text);
    else majorRequirements.push(text);
  }

  majorRequirements.unshift(...remainingSummary);

  return {
    projectOverview,
    majorRequirements: uniqueLines(majorRequirements).slice(0, 6),
    licenseRequirements: uniqueLines(licenseRequirements).slice(0, 3),
    bondRequirements: uniqueLines(bondRequirements).slice(0, 4),
    primaryRisks: uniqueLines(primaryRisks).slice(0, 5),
  };
}

function SnapshotField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-1">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value ?? "N/A"}</dd>
    </div>
  );
}

function PlaceholderStatus({
  icon,
  message,
}: {
  icon: "spinner" | "none";
  message: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm text-muted-foreground">
      {icon === "spinner" && <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />}
      <p>{message}</p>
    </div>
  );
}
