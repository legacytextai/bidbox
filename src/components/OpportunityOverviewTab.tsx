// Overview tab — stable template. Always renders all sections.
// Missing fields show N/A / Not identified — sections are never added or removed.

import { AlertTriangle, Loader2 } from "lucide-react";
import type { OpportunityOverviewData } from "@/lib/opportunityView";
import { isOIActive, isOIReady, resolveOILabel } from "@/lib/opportunityDomain";

interface Props {
  data: OpportunityOverviewData;
}

export function OpportunityOverviewTab({ data }: Props) {
  const oiReady = isOIReady(data.oiStatus);
  const oiActive = isOIActive(data.oiStatus);

  return (
    <div className="space-y-6">
      {/* Project Snapshot */}
      <OverviewSection title="Project Snapshot">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 text-sm">
          <SnapshotField label="Agency" value={data.agency} />
          <SnapshotField label="Department" value={data.department} />
          <SnapshotField label="Solicitation No." value={data.solicitationId} />
          <SnapshotField label="Bid Due" value={data.bidDue.display} />
          <SnapshotField label="Job Walk / Pre-Bid" value={data.jobWalk} />
          <SnapshotField label="Estimated Value" value={data.estimatedValue} />
          <SnapshotField label="Location" value={data.projectAddress} />
          <SnapshotField label="County" value={data.county} />
          <SnapshotField label="Portal" value={data.portalType} />
        </dl>
        {data.bidDue.warning && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2.5 text-sm text-yellow-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-600" />
            <p>{data.bidDue.warning}</p>
          </div>
        )}
      </OverviewSection>

      {/* Executive Summary */}
      <OverviewSection title="Executive Summary">
        {oiReady && data.executiveSummary.length > 0 ? (
          <div className="space-y-3 text-sm text-foreground leading-relaxed">
            {data.executiveSummary.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : oiActive ? (
          <PlaceholderStatus icon="spinner" message={`Intelligence is being prepared — ${resolveOILabel(data.oiStatus).toLowerCase()}.`} />
        ) : oiReady ? (
          <PlaceholderStatus icon="none" message="No executive summary was generated for this opportunity." />
        ) : (
          <PlaceholderStatus icon="none" message="Intelligence has not been prepared for this opportunity. View the Intelligence tab to request analysis." />
        )}
      </OverviewSection>

      {/* Key Dates */}
      <OverviewSection title="Key Dates">
        <div className="space-y-0 divide-y divide-border text-sm">
          {/* Bid due always shown first */}
          <KeyDateRow label="Bid Due" value={data.bidDue.display} />
          {data.jobWalk && <KeyDateRow label="Job Walk / Pre-Bid" value={data.jobWalk} />}
          {data.keyDates.map((kd) => (
            <KeyDateRow key={kd.id} label={kd.label} value={kd.display} />
          ))}
          {!data.jobWalk && data.keyDates.length === 0 && (
            <p className="py-3 text-muted-foreground">No additional key dates identified.</p>
          )}
        </div>
      </OverviewSection>

      {/* Bid Items */}
      <OverviewSection title="Bid Items">
        <p className="text-sm text-muted-foreground">
          Structured bid items coming soon.
        </p>
      </OverviewSection>

      {/* Important Requirements */}
      <OverviewSection title="Important Requirements">
        {data.importantRequirements.length > 0 ? (
          <ul className="space-y-3 text-sm">
            {data.importantRequirements.map((req) => (
              <li key={req.id} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground/40 shrink-0" />
                <div>
                  <span className="font-medium text-foreground">{req.label}: </span>
                  <span className="text-foreground">{req.value}</span>
                </div>
              </li>
            ))}
          </ul>
        ) : oiReady ? (
          <p className="text-sm text-muted-foreground">Not identified.</p>
        ) : (
          <PlaceholderStatus icon="none" message="Not identified — intelligence not yet available." />
        )}
      </OverviewSection>

      {/* Quick Facts */}
      <OverviewSection title="Quick Facts">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-8 gap-y-5 text-sm">
          <SnapshotField label="License Requirements" value={data.licenseRequirements} />
          <SnapshotField label="Contract Duration" value={data.contractDuration} />
          <SnapshotField label="Liquidated Damages" value={data.liquidatedDamages} />
        </dl>
      </OverviewSection>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OverviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-5">
        {title}
      </h2>
      {children}
    </section>
  );
}

function SnapshotField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground mb-0.5">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value ?? "N/A"}</dd>
    </div>
  );
}

function KeyDateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-foreground text-right">{value}</span>
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
