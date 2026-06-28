// CoverageTab — trades + bid room link.

import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CallListButton } from "@/components/CallListButton";
import { BidListButton } from "@/components/BidListButton";
import type {
  WorkspaceProject,
  WorkspaceProjectSubmission,
  WorkspaceProjectTrade,
} from "@/lib/opportunityView";

export interface CoverageTabProps {
  project: WorkspaceProject;
  projectTrades: WorkspaceProjectTrade[];
  submissions: WorkspaceProjectSubmission[];
  bidRoomUrl: string;
  copied: boolean;
  onCopyBidLink: () => void;
}

export function CoverageTab({
  project,
  projectTrades,
  submissions,
  bidRoomUrl,
  copied,
  onCopyBidLink,
}: CoverageTabProps) {
  return (
    <div className="space-y-6 max-w-2xl">
      {projectTrades.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No trades assigned. Trades management is available in the legacy workspace via Projects.
          </p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Trades</h2>
          <div className="space-y-2">
            {projectTrades.map((trade) => (
              <div key={trade.id} className="flex items-center justify-between rounded-md border border-border p-3">
                <p className="text-sm font-medium">{trade.trade_types?.name ?? "Unknown"}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 pt-4">
            <CallListButton
              projectId={project.id}
              projectName={project.name}
              gcId={project.gc_id ?? ""}
              hasSelectedTrades={projectTrades.length > 0}
            />
            <BidListButton
              projectId={project.id}
              projectName={project.name}
              gcId={project.gc_id ?? ""}
              hasSelectedTrades={projectTrades.length > 0}
              projectCounty={project.county ?? undefined}
            />
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Bid Room</h2>
        <p className="text-sm text-muted-foreground break-all mb-3">{bidRoomUrl}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCopyBidLink}>
            {copied ? "Copied" : "Copy Link"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(bidRoomUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-4 w-4 mr-2" />
            Open Bid Room
          </Button>
        </div>
        {submissions.length > 0 && (
          <p className="mt-3 text-sm text-muted-foreground">
            {submissions.length} submission{submissions.length !== 1 ? "s" : ""} received.
          </p>
        )}
      </div>
    </div>
  );
}
