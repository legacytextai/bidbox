// BidReadinessTab — M1 Foundation.
//
// Replaces the legacy <BidReadinessChecklist /> mount inside the Project
// Workspace. The legacy checklist is intentionally left on disk and continues
// to operate on the `project_bid_readiness` table for any other surface that
// still mounts it (e.g. ProjectDetail, OpportunityIntelligenceWorkspace).
//
// This tab consumes:
//   - useProjectReadiness(projectId, findings) — the new domain hook
//   - DossierFinding[] from the Opportunity Intelligence report
// and renders one row per catalog item with:
//   - Effective status badge (Ready / Not Ready / Needs Review)
//   - "Confirm" and "Needs Review" controls (manual override)
//   - Evidence list of supporting intelligence findings
//   - Optional estimator notes

import { useState } from "react";
import { ClipboardCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useProjectReadiness } from "@/hooks/useProjectReadiness";
import {
  EFFECTIVE_BADGE_CLASS,
  EFFECTIVE_LABEL,
  type ReadinessItemView,
} from "@/lib/bidReadiness";
import type { DossierFinding } from "@/hooks/useOpportunityDossier";

export interface BidReadinessTabProps {
  projectId: string;
  findings: DossierFinding[];
}

export function BidReadinessTab({ projectId, findings }: BidReadinessTabProps) {
  const { loading, items, summary, setManualStatus, setNotes } =
    useProjectReadiness(projectId, findings);

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading readiness…
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Summary header */}
      <div className="bg-card border border-border rounded-lg p-4 flex flex-wrap items-center gap-3">
        <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm font-semibold text-foreground">Bid Readiness</p>
        <div className="flex flex-wrap gap-2 ml-auto text-xs">
          <Badge variant="outline" className={EFFECTIVE_BADGE_CLASS.ready}>
            {summary.ready} Ready
          </Badge>
          <Badge variant="outline" className={EFFECTIVE_BADGE_CLASS.needs_review}>
            {summary.needsReview} Needs Review
          </Badge>
          <Badge variant="outline" className={EFFECTIVE_BADGE_CLASS.not_ready}>
            {summary.notReady} Not Ready
          </Badge>
        </div>
      </div>

      {/* Items */}
      <div className="bg-card border border-border rounded-lg divide-y divide-border">
        {items.map((item) => (
          <ReadinessRow
            key={item.def.key}
            item={item}
            onConfirm={() => setManualStatus(item.def.key, "confirmed")}
            onNeedsReview={() => setManualStatus(item.def.key, "needs_review")}
            onClear={() => setManualStatus(item.def.key, "unset")}
            onNotes={(notes) => setNotes(item.def.key, notes)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Derived status reflects what BidBox detected from the Intelligence Report.
        Manual confirmation overrides the displayed status without changing the underlying data.
      </p>
    </div>
  );
}

interface ReadinessRowProps {
  item: ReadinessItemView;
  onConfirm: () => void;
  onNeedsReview: () => void;
  onClear: () => void;
  onNotes: (notes: string) => void;
}

function ReadinessRow({ item, onConfirm, onNeedsReview, onClear, onNotes }: ReadinessRowProps) {
  const [notesDraft, setNotesDraft] = useState(item.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">{item.def.label}</p>
            <Badge variant="outline" className={EFFECTIVE_BADGE_CLASS[item.effective]}>
              {EFFECTIVE_LABEL[item.effective]}
            </Badge>
            {item.manual !== "unset" && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                manual
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{item.def.description}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={item.manual === "confirmed" ? "default" : "outline"}
            size="sm"
            onClick={onConfirm}
          >
            Confirm
          </Button>
          <Button
            variant={item.manual === "needs_review" ? "default" : "outline"}
            size="sm"
            onClick={onNeedsReview}
          >
            Needs Review
          </Button>
          {item.manual !== "unset" && (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {item.evidence.length > 0 && (
        <Collapsible className="mt-3">
          <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
            {item.evidence.length} supporting finding{item.evidence.length === 1 ? "" : "s"}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1.5">
            {item.evidence.map((f) => (
              <div key={f.id} className="text-xs bg-muted/40 rounded-md px-3 py-2">
                <p className="font-medium text-foreground">{f.label}</p>
                {f.value_text && (
                  <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{f.value_text}</p>
                )}
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                  {f.category} · {f.status}
                </p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={notesOpen} onOpenChange={setNotesOpen} className="mt-3">
        <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {item.notes ? "Edit notes" : "Add notes"}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          <Textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Internal notes for this readiness item…"
            className="text-sm"
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setNotesDraft(item.notes ?? "");
                setNotesOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onNotes(notesDraft);
                setNotesOpen(false);
              }}
            >
              Save
            </Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
