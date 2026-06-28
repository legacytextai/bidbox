// IntelligenceTab — wraps ProjectWorkspaceIntelligenceView with a typed
// candidate guard. Behavior unchanged from the previous inline tab.

import { ProjectWorkspaceIntelligenceView } from "@/components/IntelligenceReportView";
import type {
  DossierActiveTask,
  DossierCandidate,
  DossierCitation,
  DossierDocument,
  DossierFinding,
  DossierLinkedProject,
  DossierReport,
} from "@/hooks/useOpportunityDossier";

export interface IntelligenceTabProps {
  candidate: DossierCandidate | null;
  report: DossierReport | null;
  findings: DossierFinding[];
  citationsByFinding: Map<string, DossierCitation[]>;
  documents: DossierDocument[];
  activeTask: DossierActiveTask | null;
  linkedProject: DossierLinkedProject;
  reportReady: boolean;
  analysisWorkActive: boolean;
  reload: () => void;
}

export function IntelligenceTab(props: IntelligenceTabProps) {
  if (!props.candidate) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 text-center">
        <p className="text-sm text-muted-foreground">No linked opportunity found.</p>
      </div>
    );
  }
  return <ProjectWorkspaceIntelligenceView {...props} candidate={props.candidate} />;
}
