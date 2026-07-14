import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { parseOpportunityTab, type OpportunityTab } from "@/lib/opportunityTabs";
import { SCROLL_ANCHOR_KEY } from "@/components/opportunities/types";

// URL-backed Opportunities page state. The active tab lives in `?tab=`
// (all | for-you | saved | closed); missing or invalid values fall back to
// For You unconditionally — no conditional defaults based on profile
// completeness or any other per-user state. `?q=` is reserved for future
// search work and is neither read nor written here.
export function useOpportunitiesPageState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseOpportunityTab(searchParams.get("tab"));

  const setActiveTab = useCallback(
    (tab: OpportunityTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      });
    },
    [setSearchParams],
  );

  // Returning from a detail page via its "Back to Opportunities" button lands
  // on a bare /opportunities URL. The card click stored the active tab
  // alongside the sessionStorage scroll anchor; restore it once, before the
  // grid renders, so the user comes back to the tab they left. Browser
  // back-navigation and refresh already preserve the tab via the URL itself.
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (searchParams.get("tab")) return;

    const raw = sessionStorage.getItem(SCROLL_ANCHOR_KEY);
    if (!raw) return;
    let anchorTab: string | undefined;
    try {
      anchorTab = JSON.parse(raw)?.tab;
    } catch {
      return;
    }
    if (!anchorTab || parseOpportunityTab(anchorTab) !== anchorTab) return;
    if (anchorTab === parseOpportunityTab(null)) return; // already the default
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", anchorTab as OpportunityTab);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount restore
  }, []);

  return { activeTab, setActiveTab };
}
