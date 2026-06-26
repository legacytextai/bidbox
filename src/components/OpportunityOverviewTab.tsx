// Overview tab — stable template. All sections always render.
// Missing fields show N/A / Not identified — sections are never added or removed.
//
// Section structure follows docs/design-guidelines.md §Component Standards — Opportunity Overview:
//   1. Project Snapshot   2. Executive Summary   3. Key Dates
//   4. Key Requirements   5. Bid Items            6. Documents

import { AlertTriangle, Loader2 } from "lucide-react";
import type { OpportunityOverviewData } from "@/lib/opportunityView";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";
import { isOIActive, isOIReady, resolveOILabel } from "@/lib/opportunityDomain";

const FAMILY_ORDER = [
  "Plans",
  "Specifications",
  "Addenda",
  "Bid Forms",
  "Insurance",
  "Bonds",
  "Labor Compliance",
  "Bidder Communications",
  "Supporting Documents",
];

interface Props {
  data: OpportunityOverviewData;
  documents: DossierDocument[];
}

export function OpportunityOverviewTab({ data, documents }: Props) {
  const oiReady = isOIReady(data.oiStatus);
  const oiActive = isOIActive(data.oiStatus);

  // Simple family count for Documents summary
  const familyCounts = (() => {
    const counts = new Map<string, number>();
    for (const doc of documents) {
      const family = doc.document_family?.trim() || "Other";
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    return [
      ...FAMILY_ORDER.filter((f) => counts.has(f)).map((f) => ({ family: f, count: counts.get(f)! })),
      ...Array.from(counts.entries())
        .filter(([k]) => !FAMILY_ORDER.includes(k))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([family, count]) => ({ family, count })),
    ];
  })();

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
          <SnapshotField label="Location"           value={data.projectAddress} />
          <SnapshotField label="County"             value={data.county} />
          <SnapshotField label="Portal"             value={data.portalType} />
          <SnapshotField label="Contract Duration"  value={data.contractDuration} />
          <SnapshotField label="Liquidated Damages" value={data.liquidatedDamages} />
        </dl>
        {data.bidDue.warning && (
          <div className="mt-6 flex items-start gap-2.5 rounded border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-600" />
            <p>{data.bidDue.warning}</p>
          </div>
        )}
      </OverviewSection>

      {/* ── 2. Executive Summary ────────────────────────────────────────── */}
      <OverviewSection title="Executive Summary">
        {oiReady && data.executiveSummary.length > 0 ? (
          <div className="space-y-4 text-[15px] text-foreground leading-relaxed">
            {data.executiveSummary.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : oiActive ? (
          <PlaceholderStatus icon="spinner" message={`Intelligence is being prepared — ${resolveOILabel(data.oiStatus).toLowerCase()}.`} />
        ) : oiReady ? (
          <PlaceholderStatus icon="none" message="No executive summary was generated for this opportunity." />
        ) : (
          <PlaceholderStatus icon="none" message="Intelligence has not been prepared for this opportunity. Visit the Intelligence tab to request analysis." />
        )}
      </OverviewSection>

      {/* ── 3. Key Dates — additional dates beyond Project Snapshot ─────── */}
      {/* Bid Due and Job Walk live in Project Snapshot and are not repeated here. */}
      <OverviewSection title="Key Dates">
        {data.keyDates.length > 0 ? (
          <div className="divide-y divide-border">
            {data.keyDates.map((kd) => (
              <KeyDateRow key={kd.id} label={kd.label} value={kd.display} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No additional key dates identified.</p>
        )}
      </OverviewSection>

      {/* ── 4. Key Requirements ─────────────────────────────────────────── */}
      {/* License requirements from crawl metadata, then critical bid_requirements findings. */}
      <OverviewSection title="Key Requirements">
        {(data.licenseRequirements || data.importantRequirements.length > 0) ? (
          <ul className="space-y-3 text-sm">
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
        ) : oiReady ? (
          <p className="text-sm text-muted-foreground">Not identified.</p>
        ) : (
          <PlaceholderStatus icon="none" message="Not yet available — intelligence has not been prepared." />
        )}
      </OverviewSection>

      {/* ── 5. Bid Items ─────────────────────────────────────────────────── */}
      <OverviewSection title="Bid Items">
        <p className="text-sm text-muted-foreground">
          Structured bid items coming soon.
        </p>
      </OverviewSection>

      {/* ── 6. Documents ─────────────────────────────────────────────────── */}
      <OverviewSection title="Documents">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Documents have not been acquired yet.</p>
        ) : (
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {familyCounts.map(({ family, count }) => (
              <span key={family} className="text-foreground">
                {family} <span className="text-muted-foreground">({count})</span>
              </span>
            ))}
          </div>
        )}
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

function KeyDateRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
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
