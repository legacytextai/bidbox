// ⚠️ PROTECTED OPPORTUNITY CARD — do not modify without explicit product-owner
// authorization. See docs/initiatives/opportunities-page-facelift.md
// ("Protected Opportunity Card Rule"). This file is a verbatim extraction of
// `renderCard` from src/pages/Opportunities.tsx: badges, labels, metadata rows,
// buttons, status pills, layout, spacing, colors, typography, hover and focus
// behavior must all remain unchanged. The only authorized addition is the
// `onOpen` callback used by the page to record viewed state; it must never
// delay or alter navigation.

import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Building2, ExternalLink, CalendarCheck2, Bookmark, Info } from "lucide-react";
import { resolveEstimatedValue, resolvePortalStyle } from "@/lib/opportunityDomain";
import { formatInProjectTimezone } from "@/lib/timezoneUtils";
import { SCROLL_ANCHOR_KEY, type Candidate } from "./types";

function formatBidDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return formatInProjectTimezone(
    d.toISOString(),
    "America/Los_Angeles",
    "MM/dd/yyyy"
  );
}

function daysUntilBidDue(iso: string | null): { text: string; colorClass: string } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due.getTime())) return null;
  const nowYmd = formatInProjectTimezone(new Date().toISOString(), "America/Los_Angeles", "yyyy-MM-dd");
  const dueYmd = formatInProjectTimezone(due.toISOString(), "America/Los_Angeles", "yyyy-MM-dd");
  const toUTC = (ymd: string) =>
    Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
  const days = Math.round((toUTC(dueYmd) - toUTC(nowYmd)) / 86_400_000);
  if (days < 0) return { text: "Closed", colorClass: "text-muted-foreground" };
  if (days === 0) return { text: "Today", colorClass: "text-red-600" };
  if (days === 1) return { text: "Tomorrow", colorClass: "text-red-600" };
  if (days <= 3) return { text: `${days} days`, colorClass: "text-red-600" };
  if (days <= 7) return { text: `${days} days`, colorClass: "text-amber-500" };
  return { text: `${days} days`, colorClass: "text-green-600" };
}

function formatEstimatedValue(crawlData: any): string | null {
  return resolveEstimatedValue(crawlData);
}

export interface OpportunityCardProps {
  candidate: Candidate;
  navIds?: string[];
  saved: boolean;
  onCalendar: boolean;
  filterReasons: string[];
  viewed?: boolean;
  onToggleSaved: (candidate: Candidate) => void;
  // Fired synchronously when the user activates the card's project-detail
  // path (card click, keyboard activation, or the View Project CTA), just
  // before navigation. The page uses it to record viewed state.
  onOpen?: (candidateId: string) => void;
}

export const OpportunityCard = ({
  candidate,
  navIds,
  saved,
  onCalendar,
  filterReasons,
  viewed,
  onToggleSaved,
  onOpen,
}: OpportunityCardProps) => {
  const navigate = useNavigate();
  const estimatedValue = formatEstimatedValue(candidate.crawl_data);
  const goToOpportunity = () => {
    sessionStorage.setItem(
      SCROLL_ANCHOR_KEY,
      JSON.stringify({ id: candidate.id, scrollY: window.scrollY }),
    );
    onOpen?.(candidate.id);
    navigate(
      `/opportunities/${candidate.id}`,
      navIds ? { state: { navIds } } : undefined,
    );
  };

  return (
    <div
      data-candidate-id={candidate.id}
      role="button"
      tabIndex={0}
      onClick={goToOpportunity}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          goToOpportunity();
        }
      }}
      className="bg-card border border-border rounded-lg p-6 flex flex-col gap-3 cursor-pointer hover:border-blue-300 hover:shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-300"
    >
      {/* Top content — grows to push button to bottom */}
      <div className="flex-1 flex flex-col gap-3">
        {/* Title + actions */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base text-foreground leading-snug">
              {candidate.raw_title ?? "Untitled Opportunity"}
            </h3>
            {candidate.agency && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {candidate.agency}
              </p>
            )}
            {onCalendar && (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] uppercase tracking-wide font-medium text-blue-600">
                <CalendarCheck2 className="h-3 w-3 shrink-0" />
                On Calendar
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSaved(candidate);
              }}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                saved ? "text-blue-700 bg-blue-50 hover:bg-blue-100" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
              aria-label={saved ? "Unsave opportunity" : "Save opportunity"}
              title={saved ? "Unsave opportunity" : "Save opportunity"}
            >
              <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
            </button>
            <a
              href={candidate.source_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Open source page"
              aria-label="Open source page"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Portal pill */}
        {candidate.portal_type && (
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${resolvePortalStyle(candidate.portal_type)}`}
            >
              {candidate.portal_type}
            </span>
          </div>
        )}

        {filterReasons.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
            <p className="flex items-start gap-1.5 text-xs font-semibold">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Filtered out: {filterReasons[0]}
            </p>
            {filterReasons.length > 1 && (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {filterReasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* Estimated value — prominent */}
        {estimatedValue && (
          <p className="text-2xl font-bold text-foreground leading-none">{estimatedValue}</p>
        )}
      </div>

      {/* Bid due + countdown — anchored directly above button */}
      <div className="flex items-center gap-2">
        <p className="text-sm text-foreground font-medium">
          Bid Due: {formatBidDate(candidate.bid_due_at)}
        </p>
        {(() => {
          const countdown = daysUntilBidDue(candidate.bid_due_at);
          if (!countdown) return null;
          const bgMap: Record<string, string> = {
            "text-red-600": "bg-red-50",
            "text-amber-500": "bg-amber-50",
            "text-green-600": "bg-green-50",
            "text-muted-foreground": "bg-muted",
          };
          return (
            <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${bgMap[countdown.colorClass] ?? "bg-muted"} ${countdown.colorClass}`}>
              {countdown.text}
            </span>
          );
        })()}
      </div>

      {/* CTA — unified, always at bottom */}
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          goToOpportunity();
        }}
        className="w-full bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100 shadow-none"
      >
        View Project
      </Button>
    </div>
  );
};
