// OverviewTab — read-only project + opportunity overview.

import type { NavigateFunction } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpportunityOverviewTab } from "@/components/OpportunityOverviewTab";
import type {
  OpportunityOverviewData,
  PursuitStatus,
  WorkspaceProject,
} from "@/lib/opportunityView";

const PURSUIT_STATUS_LABELS: Record<PursuitStatus, string> = {
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  passed: "Passed",
  submitted: "Submitted",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export interface OverviewTabProps {
  project: WorkspaceProject;
  overview: OpportunityOverviewData | null;
  reportReady: boolean;
  pursuitStatus: PursuitStatus;
  candidateId: string | undefined;
  onNavigate: NavigateFunction;
}

export function OverviewTab({
  project,
  overview,
  reportReady,
  pursuitStatus,
  candidateId,
  onNavigate,
}: OverviewTabProps) {
  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Pursuit Status</p>
            <p className="mt-1 font-medium text-foreground">{PURSUIT_STATUS_LABELS[pursuitStatus]}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bid Due</p>
            <p className="mt-1 font-medium text-foreground">{formatDate(project.bid_due_at)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Agency</p>
            <p className="mt-1 font-medium text-foreground">{project.agency ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Added to Calendar</p>
            <p className="mt-1 font-medium text-foreground">{formatDate(project.added_to_calendar_at)}</p>
          </div>
        </div>
      </div>

      {overview ? (
        <OpportunityOverviewTab data={overview} />
      ) : (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          {reportReady === false ? (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Preparing Opportunity Intelligence…</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Opportunity Intelligence overview is not available.
              {candidateId && (
                <Button variant="link" size="sm" onClick={() => onNavigate(`/opportunities/${candidateId}`)}>
                  View opportunity
                </Button>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
