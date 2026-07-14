import { OPPORTUNITY_TAB_ORDER, type OpportunityTab } from "@/lib/opportunityTabs";

interface OpportunityTabsProps {
  activeTab: OpportunityTab;
  counts: Record<OpportunityTab, number>;
  onTabChange: (tab: OpportunityTab) => void;
}

// Tab bar for the Opportunities page. Rendered order and counts come from the
// shared predicates so the badge numbers always equal rendered membership.
export const OpportunityTabs = ({ activeTab, counts, onTabChange }: OpportunityTabsProps) => (
  <div className="flex gap-2 flex-wrap">
    {OPPORTUNITY_TAB_ORDER.map((f) => (
      <button
        key={f.value}
        onClick={() => onTabChange(f.value)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          activeTab === f.value
            ? "bg-[hsl(var(--bidbox-blue))] text-white"
            : "bg-muted text-muted-foreground hover:bg-accent"
        }`}
      >
        {f.label} <span className="ml-1 opacity-70">{counts[f.value]}</span>
      </button>
    ))}
  </div>
);
