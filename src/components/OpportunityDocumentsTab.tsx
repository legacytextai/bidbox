// Documents tab — flat ordered list of acquired source documents.

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";

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

function DownloadButton({ doc }: { doc: DossierDocument }) {
  const [loading, setLoading] = useState(false);

  if (doc.acquisition_status !== "acquired" || !doc.storage_path) return null;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const bucket = doc.storage_bucket ?? "opportunity-documents";
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(doc.storage_path!, 3600);
      if (error || !data?.signedUrl) throw error ?? new Error("Signed URL generation failed");
      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = doc.file_name ?? "document";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {loading ? "…" : "Download"}
    </button>
  );
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

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <ul className="space-y-2">
        {documents.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium text-foreground truncate">
                {doc.file_name ?? "Untitled document"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {typeof doc.text_page_count === "number"
                  ? `${doc.text_page_count} pages`
                  : null}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <DownloadButton doc={doc} />
              <span className={`text-[10px] font-medium uppercase tracking-wide ${processingStatusStyle(doc.processing_status)}`}>
                {processingStatusLabel(doc.processing_status)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
