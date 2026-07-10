// Documents tab — uniform document policy (docs/initiatives/uniform-document-policy.md):
//   Case A: acquired documents → rows with instant Download (signed URL).
//   Case B: document titles known from discovery metadata → rows with
//           on-demand Download (F2-lite): the edge function returns a signed
//           URL if the file is already in BidBox, otherwise starts a
//           single-candidate acquisition and this component polls until the
//           file is ready. No F3/F4 cascade. Rows without a supported
//           on-demand path render title + type only.
//   Case C: no document list known → clear empty state + source portal link.
// User-facing language: Download / Downloading… / Retry Download / Unavailable
// only — backend state stays invisible.

import { useRef, useState } from "react";
import { Download, ExternalLink, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";
import type { KnownSourceDocument } from "@/lib/opportunityDomain";

const ON_DEMAND_POLL_INTERVAL_MS = 4000;
const ON_DEMAND_POLL_TIMEOUT_MS = 3 * 60 * 1000; // acquisition runs ~20-60s; leave headroom

function triggerBrowserDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

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

      triggerBrowserDownload(data.signedUrl, doc.file_name ?? "document");
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

// F2-lite: on-demand download for a document whose bytes may not be in BidBox
// yet. Calls the download-opportunity-document edge function, which either
// returns a signed URL immediately or starts a single-candidate acquisition;
// we poll the same function until the file is ready.
function OnDemandDownloadButton({
  candidateId,
  doc,
  onDownloaded,
}: {
  candidateId: string;
  doc: KnownSourceDocument;
  onDownloaded?: () => void;
}) {
  const [state, setState] = useState<"idle" | "working" | "retry" | "unavailable">("idle");
  const cancelled = useRef(false);
  const { toast } = useToast();

  const requestOnce = async (): Promise<{ status: string; signed_url?: string; file_name?: string }> => {
    const { data, error } = await supabase.functions.invoke("download-opportunity-document", {
      body: {
        candidate_id: candidateId,
        source_document_key: doc.sourceKey,
        document_title: doc.title,
      },
    });
    if (error) throw new Error(error.message ?? "Request failed");
    return data as { status: string; signed_url?: string; file_name?: string };
  };

  const handleDownload = async () => {
    setState("working");
    cancelled.current = false;
    const deadline = Date.now() + ON_DEMAND_POLL_TIMEOUT_MS;
    try {
      // First call may return ready immediately, or start the download and
      // report pending — in which case we poll until ready or timeout.
      for (;;) {
        const res = await requestOnce();
        if (cancelled.current) return;
        if (res.status === "ready" && res.signed_url) {
          triggerBrowserDownload(res.signed_url, res.file_name ?? doc.title);
          setState("idle");
          onDownloaded?.();
          return;
        }
        if (res.status === "unavailable" || res.status === "unsupported") {
          setState("unavailable");
          toast({
            title: "Document unavailable",
            description: "This document can't be downloaded from BidBox. Open the source portal to view it.",
          });
          return;
        }
        if (res.status !== "pending") {
          throw new Error("Download did not complete");
        }
        if (Date.now() > deadline) {
          throw new Error("Timed out waiting for the download");
        }
        await new Promise((r) => setTimeout(r, ON_DEMAND_POLL_INTERVAL_MS));
      }
    } catch {
      if (!cancelled.current) {
        setState("retry");
        toast({
          title: "Download failed",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  if (state === "unavailable") {
    return <span className="shrink-0 text-xs text-muted-foreground">Unavailable</span>;
  }

  return (
    <button
      onClick={handleDownload}
      disabled={state === "working"}
      className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Download className="h-3.5 w-3.5" />
      {state === "working" ? "Downloading…" : state === "retry" ? "Retry Download" : "Download"}
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
  candidateId?: string | null;
  sourceUrl?: string | null;
  // Called after an on-demand download completes so the parent can refresh
  // the document rows (the acquisition may have added more acquired files).
  onDownloaded?: () => void;
}

export function OpportunityDocumentsTab({ documents, knownSourceDocuments, candidateId, sourceUrl, onDownloaded }: Props) {
  if (documents.length === 0) {
    const known = knownSourceDocuments ?? [];

    // Case B — titles known, bytes not necessarily in BidBox yet.
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
                <div className="flex items-center gap-3 shrink-0">
                  {doc.fileType && (
                    <span className="text-xs uppercase text-muted-foreground">{doc.fileType}</span>
                  )}
                  {doc.sourceKey && candidateId && (
                    <OnDemandDownloadButton candidateId={candidateId} doc={doc} onDownloaded={onDownloaded} />
                  )}
                </div>
              </li>
            ))}
          </ul>
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
