// CoverageTab — required trades, coverage actions, and bid room link.

import { ExternalLink, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CallListButton } from "@/components/CallListButton";
import { BidListButton } from "@/components/BidListButton";
import { TradeMultiSelect } from "@/components/TradeMultiSelect";
import { getCategoryColor } from "@/lib/tradeTypes";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
  editingTrades: boolean;
  editedTradeIds: string[];
  savingTrades: boolean;
  onEditingTradesChange: (open: boolean) => void;
  onEditedTradeIdsChange: (ids: string[]) => void;
  onSaveTrades: () => void;
}

export function CoverageTab({
  project,
  projectTrades,
  submissions,
  bidRoomUrl,
  copied,
  onCopyBidLink,
  editingTrades,
  editedTradeIds,
  savingTrades,
  onEditingTradesChange,
  onEditedTradeIdsChange,
  onSaveTrades,
}: CoverageTabProps) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Required Trades</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              These trades drive call lists, bid lists, and public Bid Room coverage.
            </p>
          </div>
          <Dialog open={editingTrades} onOpenChange={onEditingTradesChange}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="h-4 w-4 mr-1" />
                {projectTrades.length > 0 ? "Edit Trades" : "Add Trades"}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]" onWheel={(e) => e.stopPropagation()}>
              <DialogHeader>
                <DialogTitle>Edit Required Trades</DialogTitle>
                <DialogDescription>
                  Select the trades needed for this project. AI may prefill this list when Intelligence finds cited trade evidence; your edits become the active coverage list.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <TradeMultiSelect
                  selectedTradeIds={editedTradeIds}
                  onSelectionChange={onEditedTradeIdsChange}
                  stateCode="CA"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    onEditedTradeIdsChange(projectTrades.map((trade) => trade.trade_type_id));
                    onEditingTradesChange(false);
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={onSaveTrades} disabled={savingTrades}>
                  {savingTrades ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    "Save Trades"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {projectTrades.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
            Add required trades to start building call lists, bid lists, and coverage tracking.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {projectTrades.map((trade) => (
              <Badge
                key={trade.id}
                variant="outline"
                className={cn("px-2 py-1 text-xs font-medium border", getCategoryColor(trade.trade_types?.category ?? null))}
              >
                {trade.trade_types?.code && <span className="font-mono mr-1">{trade.trade_types.code}</span>}
                {trade.trade_types?.name ?? "Unknown"}
              </Badge>
            ))}
          </div>
        )}

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
