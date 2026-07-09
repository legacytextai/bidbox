// Documents tab — uniform document policy (docs/initiatives/uniform-document-policy.md):
//   Case A: acquired documents → rows with working Download buttons.
//   Case B: document titles known from discovery metadata, bytes not in BidBox
//           yet → still show the titles as rows (never a bare "not acquired"
//           message); downloads arrive via Prepare Intelligence (F2-full) or,
//           once the per-document backend path exists, on-demand (F2-lite).
//   Case C: no document list known → clear empty state + source portal link.
// User-facing language: Download / Downloading… / Retry Download only — no
// backend vocabulary.

import { useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";
import type { KnownSourceDocument } from "@/lib/opportunityDomain";

function DownloadButton({ doc }: { doc: DossierDocument }) {
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { toast } = useToast();

  if (doc.acquisition_status !== "acquired" || !doc.storage_path) return null;

  const handleDownload = async () => {
    setLoading(true);
    try {
      const bucket = doc.storage_bucket ?? "opportunity-documents";
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(doc.storage_path!, 3600);

      if (error || !data?.signedUrl) {
        setFailed(true);
        toast({
          title: "Download failed",
          description: "Could not generate a download link. Please try again or contact support.",
          variant: "destructive",
        });
        return;
      }

      const a = document.createElement("a");
      a.href = data.signedUrl;
      a.download = doc.file_name ?? "document";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setFailed(false);
    } catch {
      setFailed(true);
      toast({
        title: "Download failed",
        description: "An unexpected error occurred. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={loading}
      className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download className="h-3.5 w-3.5" />
      {loading ? "Downloading…" : failed ? "Retry Download" : "Download"}
    </button>
  );
}

function SourcePortalLink({ sourceUrl }: { sourceUrl: string }) {
  return (
    <a
      href={sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Open Source Portal
    </a>
  );
}

interface Props {
  documents: DossierDocument[];
  // Document titles known from discovery metadata — shown when no documents
  // exist in BidBox yet (Case B). Optional so existing call sites (project
  // workspace, where documents always exist post-analysis) are unchanged.
  knownSourceDocuments?: KnownSourceDocument[];
  sourceUrl?: string | null;
}

export function OpportunityDocumentsTab({ documents, knownSourceDocuments, sourceUrl }: Props) {
  if (documents.length === 0) {
    const known = knownSourceDocuments ?? [];

    // Case B — titles known, bytes not in BidBox yet.
    if (known.length > 0) {
      return (
        <div className="bg-card border border-border rounded-lg p-6">
          <ul className="space-y-2">
            {known.map((doc, i) => (
              <li
                key={`${doc.title}-${i}`}
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="font-medium text-foreground truncate">{doc.title}</p>
                </div>
                {doc.fileType && (
                  <span className="shrink-0 text-xs uppercase text-muted-foreground">{doc.fileType}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Downloads become available after you click Prepare Intelligence, or open the source portal.
            </p>
            {sourceUrl && <SourcePortalLink sourceUrl={sourceUrl} />}
          </div>
        </div>
      );
    }

    // Case C — no document list known.
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          No document list available yet. Open the source portal to view documents.
        </p>
        {sourceUrl && <SourcePortalLink sourceUrl={sourceUrl} />}
      </div>
    );
  }

  // Case A — acquired documents with working downloads.
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
              {typeof doc.text_page_count === "number" && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {doc.text_page_count} pages
                </p>
              )}
            </div>
            <DownloadButton doc={doc} />
          </li>
        ))}
      </ul>
    </div>
  );
}
