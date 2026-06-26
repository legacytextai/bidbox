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

      {/* ── 2. Executive Summary — full intelligence briefing ───────────── */}
      {/* Combines AI-generated prose + license requirements + critical bid    */}
      {/* requirements into one coherent section. No separate sub-sections.    */}
      <OverviewSection title="Executive Summary">
        {hasIntelligence ? (
          <div>
            {/* Prose paragraphs */}
            {data.executiveSummary.length > 0 && (
              <div className="space-y-4 text-[15px] text-foreground leading-relaxed">
                {data.executiveSummary.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            {/* Requirements — continuation of the same briefing */}
            {(data.licenseRequirements || data.importantRequirements.length > 0) && (
              <ul
                className={[
                  "space-y-3 text-sm",
                  data.executiveSummary.length > 0 ? "mt-5 pt-5 border-t border-border" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {data.licenseRequirements && (
                  <li className="flex gap-2.5">
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-foreground/40 shrink-0" />
                    <div>
                      <span className="font-medium text-foreground">License Requirements: </span>
                      <span className="text-foreground">{data.licenseRequirements}</span>
                    </div>
                  </li>
                )}
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
            message="Intelligence has not been prepared for this opportunity. Visit the Intelligence tab to request analysis."
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
