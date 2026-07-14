import { useCallback, useEffect, useState } from "react";
import { addViewedId, readViewedIds } from "@/lib/viewedOpportunities";

// Per-user viewed-opportunity state backed by localStorage (see
// src/lib/viewedOpportunities.ts). markViewed is synchronous and must be
// called only from a deliberate project-detail activation; it never delays
// navigation.
export function useViewedOpportunities(userId: string | undefined) {
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) {
      setViewedIds(new Set());
      return;
    }
    setViewedIds(new Set(readViewedIds(window.localStorage, userId)));
  }, [userId]);

  const markViewed = useCallback(
    (candidateId: string) => {
      if (!userId) return;
      setViewedIds((prev) => {
        if (prev.has(candidateId)) return prev;
        const next = new Set(prev);
        next.add(candidateId);
        return next;
      });
      addViewedId(window.localStorage, userId, candidateId);
    },
    [userId],
  );

  return { viewedIds, markViewed };
}
