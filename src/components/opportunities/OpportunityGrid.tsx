import type { ReactNode } from "react";

// Page-level grid and section chrome for the Opportunities page. All copy
// rendered here lives outside the protected opportunity cards.

export const OpportunityGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{children}</div>
);

interface OpportunitySectionHeaderProps {
  title: string;
  count: number;
  description: string;
}

export const OpportunitySectionHeader = ({ title, count, description }: OpportunitySectionHeaderProps) => (
  <div className="mb-4">
    <h2 className="text-lg font-semibold text-foreground">
      {title} <span className="font-normal text-muted-foreground">({count})</span>
    </h2>
    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
  </div>
);

export const OpportunitySectionEmpty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
    {children}
  </p>
);
