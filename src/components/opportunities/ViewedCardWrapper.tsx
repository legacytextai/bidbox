import type { ReactNode } from "react";
import { Eye } from "lucide-react";

// Viewed-state wrapper for opportunity cards on /opportunities. The indicator
// renders on a positioned container OUTSIDE the protected card subtree — the
// card itself is never modified. pointer-events-none guarantees it can never
// intercept clicks meant for the card, its save control, or its links.
export const ViewedCardWrapper = ({ viewed, children }: { viewed: boolean; children: ReactNode }) => (
  <div className="relative">
    {viewed && (
      <span
        aria-label="Already viewed"
        className="pointer-events-none absolute -top-2.5 right-4 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
      >
        <Eye aria-hidden="true" className="h-3 w-3" />
        Viewed
      </span>
    )}
    {children}
  </div>
);
