// Documents tab — flat ordered list of acquired source documents.

import { useState } from "react";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";

function DownloadButton({ doc }: { doc: DossierDocument }) {
  const [loading, setLoading] = useState(false);
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
    } catch {
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
      {loading ? "Downloading…" : "Download"}
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
