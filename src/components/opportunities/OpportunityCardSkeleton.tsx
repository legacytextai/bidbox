import { Skeleton } from "@/components/ui/skeleton";

// Grid-card skeleton for the Opportunities page cold-load shell. Deliberately
// matches OpportunityCard's outer dimensions (border, padding, rounded corners)
// so first paint doesn't visibly reflow when real cards commit.
export const OpportunityCardSkeleton = () => (
  <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
    <Skeleton className="h-3 w-24" />
    <Skeleton className="h-5 w-full" />
    <Skeleton className="h-5 w-4/5" />
    <Skeleton className="h-4 w-2/3" />
    <div className="flex gap-2 mt-2">
      <Skeleton className="h-6 w-16 rounded-full" />
      <Skeleton className="h-6 w-20 rounded-full" />
    </div>
  </div>
);

export const OpportunityGridSkeleton = ({ count = 6 }: { count?: number }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {Array.from({ length: count }).map((_, i) => (
      <OpportunityCardSkeleton key={i} />
    ))}
  </div>
);
