// DocumentsTab — read-only listing of opportunity + internal documents.
//
// M1 keeps this tab unchanged. Document workspace polish (badges, download
// all, sorting) is M2 and intentionally deferred from this commit.

import { Button } from "@/components/ui/button";
import { OpportunityDocumentsTab } from "@/components/OpportunityDocumentsTab";
import type { DossierDocument } from "@/hooks/useOpportunityDossier";
import type { WorkspaceProjectFile } from "@/lib/opportunityView";

export interface DocumentsTabProps {
  documents: DossierDocument[];
  projectFiles: WorkspaceProjectFile[];
  onDownload: (path: string, name: string) => void;
  onDelete: (id: string, path: string) => void;
}

export function DocumentsTab({ documents, projectFiles, onDownload }: DocumentsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Source Documents
        </h2>
        <OpportunityDocumentsTab documents={documents} />
      </div>

      {projectFiles.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Internal Documents
          </h2>
          <div className="bg-card border border-border rounded-lg p-6 space-y-2">
            {projectFiles.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5 text-sm"
              >
                <p className="font-medium text-foreground truncate">{file.file_name}</p>
                <Button variant="ghost" size="sm" onClick={() => onDownload(file.file_url, file.file_name)}>
                  Download
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
