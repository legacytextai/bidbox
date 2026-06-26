// Documents tab — shows acquired source documents grouped by family.

import type { DossierDocument } from "@/hooks/useOpportunityDossier";

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

const PROCESSING_STATUS_LABELS: Record<string, string> = {
  processed: "Processed",
  processing: "Processing",
  queued: "Queued",
  failed: "Failed",
  partial: "Partial",
  skipped: "Skipped",
};

function processingStatusLabel(status: string | null): string {
  return PROCESSING_STATUS_LABELS[status ?? ""] ?? status ?? "—";
}

function processingStatusStyle(status: string | null): string {
  if (status === "processed") return "text-green-700";
  if (status === "failed") return "text-red-600";
  if (status === "processing" || status === "queued") return "text-blue-700";
  return "text-muted-foreground";
}

interface Props {
  documents: DossierDocument[];
}

export function OpportunityDocumentsTab({ documents }: Props) {
  if (documents.length === 0) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">Documents have not been acquired yet.</p>
      </div>
    );
  }

  // Group by document_family, preserving preferred order then alphabetical for unknowns
  const grouped = new Map<string, DossierDocument[]>();
  for (const doc of documents) {
    const family = doc.document_family?.trim() || "Other";
    const list = grouped.get(family) ?? [];
    list.push(doc);
    grouped.set(family, list);
  }

  const orderedFamilies = [
    ...FAMILY_ORDER.filter((f) => grouped.has(f)),
    ...Array.from(grouped.keys())
      .filter((k) => !FAMILY_ORDER.includes(k))
      .sort(),
  ];

  return (
    <div className="space-y-4">
      {orderedFamilies.map((family) => {
        const docs = grouped.get(family)!;
        return (
          <section key={family} className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">
              {family} <span className="font-normal opacity-60">({docs.length})</span>
            </h2>
            <ul className="space-y-2">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {doc.file_name ?? "Untitled document"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {doc.document_class ?? "Uncategorized"}
                      {typeof doc.text_page_count === "number"
                        ? ` · ${doc.text_page_count} pages`
                        : ""}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium uppercase tracking-wide shrink-0 ${processingStatusStyle(doc.processing_status)}`}>
                    {processingStatusLabel(doc.processing_status)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
