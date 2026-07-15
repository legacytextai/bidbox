import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Building2, RefreshCw, ChevronDown, Check, Filter, SlidersHorizontal } from "lucide-react";
import { fetchCompanyPursuits, upsertPursuit, type PursuitLite } from "@/lib/tenant";
import { Layout } from "@/components/Layout";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { ActiveScansPanel } from "@/components/ActiveScansPanel";
import {
  getCardFilterReasons,
  type OpportunityCardReasonContext,
  type StoredQualification,
} from "@/lib/opportunityVisibility";
import { useAuth } from "@/hooks/useAuth";
import { useQualificationJob } from "@/hooks/useQualificationJob";
import { fetchAllPages } from "@/lib/paginatedRows";
import { OpportunityCard } from "@/components/opportunities/OpportunityCard";
import { ViewedCardWrapper } from "@/components/opportunities/ViewedCardWrapper";
import { OpportunityTabs } from "@/components/opportunities/OpportunityTabs";
import {
  OpportunityGrid,
  OpportunitySectionEmpty,
  OpportunitySectionHeader,
} from "@/components/opportunities/OpportunityGrid";
import { SCROLL_ANCHOR_KEY, type Candidate, type AnalysisStatus, type AutoStatus, type CandidateStatus, type DocumentAcquisitionStatus, type DocumentProcessingStatus } from "@/components/opportunities/types";
import {
  getCandidateCounty,
  isAllTabFilteredOutMember,
  isAllTabMember,
  isClosedTabMember,
  isSavedTabMember,
  type OpportunityTab,
} from "@/lib/opportunityTabs";
import {
  classifyForYouSection,
  EMPTY_BID_PROFILE,
  type BidProfileParams,
} from "@/lib/bidProfileMatching";
import { useOpportunitiesPageState } from "@/hooks/useOpportunitiesPageState";
import { useViewedOpportunities } from "@/hooks/useViewedOpportunities";
import {
  readCandidatesCache,
  writeCandidatesCache,
  readUserSideCache,
  writeUserSideCache,
  isFresh,
} from "@/lib/opportunitiesCache";
import { OpportunityGridSkeleton } from "@/components/opportunities/OpportunityCardSkeleton";

interface QualificationRow {
  opportunity_candidate_id: string;
  status: StoredQualification["status"];
  primary_reason: string;
  reasons: string[] | null;
}

// Active-state definitions for the realtime safety-net polling fallback.
// Extend these lists as new long-running agent statuses (e.g. F3/F4: processing,
// extracting, chunking, generating) are introduced.
const ACTIVE_DOCUMENT_STATUSES: DocumentAcquisitionStatus[] = ["queued", "acquiring"];
const ACTIVE_DOCUMENT_PROCESSING_STATUSES: DocumentProcessingStatus[] = ["queued", "processing"];
const ACTIVE_ANALYSIS_STATUSES: AnalysisStatus[] = ["queued", "analyzing"];
const QUERY_TIMEOUT_MS = 10000;

// Slim list-view select. Every removed field is fetched on-demand by the
// detail page (`useOpportunityDossier`); grep-verified zero consumers in the
// list-view surface (cards, opportunityDomain, opportunityTabs,
// opportunityVisibility, bidProfileMatching, calendar helpers). MUST retain
// portal_summary / scope_text / required_licenses / required_naics — they are
// direct inputs to the For You construction classifier and the LA Metro
// hardening relies on portal_summary when normalized scope_text is absent.
// Bump OPPORTUNITIES_CACHE_VERSION in opportunitiesCache.ts when this shape
// changes so a stale row shape cannot be resurrected from cache.
const OPPORTUNITY_LIST_SELECT = `
  id,
  source_url,
  portal_type,
  portal_bid_id,
  raw_title,
  agency,
  bid_due_at,
  scope_text,
  portal_summary,
  required_licenses,
  required_naics,
  status,
  review_notes,
  converted_project_id,
  created_at,
  auto_status,
  auto_status_reason,
  qualification_score,
  qualified_at,
  estimated_value,
  estimated_value_low,
  estimated_value_high,
  county,
  analysis_status,
  document_acquisition_status,
  document_processing_status,
  opportunity_lifecycle_status,
  opportunity_intelligence_status,
  ingestion_status,
  ingestion_issue_reason,
  global_exclusion_code,
  global_exclusion_reason,
  canonical_candidate_id,
  opportunity_sources(name, last_scanned_at)
`;

function withTimeout<T>(promise: PromiseLike<T>, label: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const NO_VALUE_SENTINEL = "__none__";

type SortKey = "due_asc" | "due_desc" | "added_desc" | "added_asc";

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: "Bid Due (Soonest First)", value: "due_asc" },
  { label: "Bid Due (Latest First)", value: "due_desc" },
  { label: "Recently Added", value: "added_desc" },
  { label: "Oldest Added", value: "added_asc" },
];

interface FacetMultiSelectProps {
  label: string;
  icon?: React.ReactNode;
  options: string[];
  hasNone: boolean;
  noneLabel: string;
  value: string[];
  onChange: (next: string[]) => void;
  searchPlaceholder?: string;
}

const FacetMultiSelect = ({
  label,
  icon,
  options,
  hasNone,
  noneLabel,
  value,
  onChange,
  searchPlaceholder,
}: FacetMultiSelectProps) => {
  const [open, setOpen] = useState(false);
  const toggle = (key: string) => {
    if (value.includes(key)) onChange(value.filter((v) => v !== key));
    else onChange([...value, key]);
  };
  const count = value.length;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
        >
          {icon}
          <span>{label}</span>
          {count > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 h-5 text-xs">
              {count}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="end">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? "Search..."} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const selected = value.includes(opt);
                return (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => toggle(opt)}
                    className="flex items-center gap-2"
                  >
                    <Check
                      className={`h-4 w-4 ${selected ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="truncate">{opt}</span>
                  </CommandItem>
                );
              })}
              {hasNone && (
                <CommandItem
                  value={noneLabel}
                  onSelect={() => toggle(NO_VALUE_SENTINEL)}
                  className="flex items-center gap-2"
                >
                  <Check
                    className={`h-4 w-4 ${value.includes(NO_VALUE_SENTINEL) ? "opacity-100" : "opacity-0"}`}
                  />
                  <span className="italic text-muted-foreground">{noneLabel}</span>
                </CommandItem>
              )}
            </CommandGroup>
            {count > 0 && (
              <div className="border-t p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-center text-xs"
                  onClick={() => onChange([])}
                >
                  Clear {label}
                </Button>
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const Opportunities = () => {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [savedCandidateIds, setSavedCandidateIds] = useState<Set<string>>(new Set());
  // Tenant boundary: company-scoped pursuit rows overlaid on canonical
  // candidates (dual-read; legacy candidate columns remain the fallback).
  const [pursuitByCandidate, setPursuitByCandidate] = useState<Map<string, PursuitLite>>(new Map());
  const [qualificationByCandidate, setQualificationByCandidate] = useState<Map<string, StoredQualification>>(new Map());
  // Operational Bid Profile parameters (geography + project size). Licensing
  // and NAICS exist on the profile but do not participate in filtering.
  const [bidProfile, setBidProfile] = useState<BidProfileParams>(EMPTY_BID_PROFILE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("due_asc");
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [agencyFilter, setAgencyFilter] = useState<string[]>([]);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filteredOutOpen, setFilteredOutOpen] = useState(false);
  const [activeScanTaskIds, setActiveScanTaskIds] = useState<string[]>([]);
  const [scanStartedAt, setScanStartedAt] = useState<string | null>(null);
  const [scanActive, setScanActive] = useState(false);
  // Per-slice readiness — drives tab-scoped first-paint gates so the "All" and
  // "Closed" tabs paint the instant candidates are back, while "For You" waits
  // for the bid profile and "Saved" waits for the saved-id set.
  const [candidatesReady, setCandidatesReady] = useState(false);
  const [savedReady, setSavedReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, authReady } = useAuth();
  const qualificationJob = useQualificationJob(user?.id);
  const completedQualificationJob = useRef<string | null>(null);
  const lastObservedQualificationJob = useRef<{ id: string; status: string } | null>(null);
  const { activeTab, setActiveTab } = useOpportunitiesPageState();
  const { viewedIds, markViewed } = useViewedOpportunities(user?.id);

  const mapRow = useCallback((row: any): Candidate => ({
    id: row.id,
    source_url: row.source_url,
    portal_type: row.portal_type,
    portal_bid_id: row.portal_bid_id ?? null,
    raw_title: row.raw_title,
    agency: row.agency,
    bid_due_at: row.bid_due_at,
    scope_text: row.scope_text,
    portal_summary: row.portal_summary ?? null,
    required_licenses: row.required_licenses ?? null,
    required_naics: row.required_naics ?? null,
    status: row.status as CandidateStatus,
    review_notes: row.review_notes,
    converted_project_id: row.converted_project_id,
    created_at: row.created_at,
    source_name: row.opportunity_sources?.name ?? null,
    auto_status: (row.auto_status ?? null) as AutoStatus,
    auto_status_reason: row.auto_status_reason ?? null,
    qualification_score: row.qualification_score ?? null,
    qualified_at: row.qualified_at ?? null,
    crawl_data: row.crawl_data ?? (row.estimated_value ? { estimated_value: row.estimated_value } : null),
    estimated_value: row.estimated_value ?? null,
    estimated_value_low: row.estimated_value_low ?? null,
    estimated_value_high: row.estimated_value_high ?? null,
    county: row.county ?? row.crawl_data?.county ?? null,
    analysis_status: (row.analysis_status ?? "not_requested") as AnalysisStatus,
    // The fields below are not selected in OPPORTUNITY_LIST_SELECT (list view
    // doesn't consume them). Kept on the type so the detail page's fetched
    // rows still map through mapRow if ever needed; here they resolve to null.
    analysis_task_id: row.analysis_task_id ?? null,
    analysis_requested_at: row.analysis_requested_at ?? null,
    analysis_started_at: row.analysis_started_at ?? null,
    analysis_completed_at: row.analysis_completed_at ?? null,
    analysis_error: row.analysis_error ?? null,
    document_acquisition_status: (row.document_acquisition_status ?? "not_requested") as DocumentAcquisitionStatus,
    document_acquisition_started_at: row.document_acquisition_started_at ?? null,
    document_acquisition_completed_at: row.document_acquisition_completed_at ?? null,
    document_acquisition_error: row.document_acquisition_error ?? null,
    document_processing_status: (row.document_processing_status ?? "not_requested") as DocumentProcessingStatus,
    document_processing_started_at: row.document_processing_started_at ?? null,
    document_processing_completed_at: row.document_processing_completed_at ?? null,
    document_processing_error: row.document_processing_error ?? null,
    opportunity_lifecycle_status: row.opportunity_lifecycle_status ?? null,
    opportunity_intelligence_status: row.opportunity_intelligence_status ?? null,
    opportunity_intelligence_task_id: row.opportunity_intelligence_task_id ?? null,
    opportunity_intelligence_ready_at: row.opportunity_intelligence_ready_at ?? null,
    opportunity_intelligence_error: row.opportunity_intelligence_error ?? null,
    ingestion_status: row.ingestion_status ?? "valid",
    ingestion_issue_reason: row.ingestion_issue_reason ?? null,
    global_exclusion_code: row.global_exclusion_code ?? null,
    global_exclusion_reason: row.global_exclusion_reason ?? null,
    canonical_candidate_id: row.canonical_candidate_id ?? null,
  }), []);

  const loadInFlightRef = useRef(false);
  // Dirty flags — flipped by local writes (toggle saved, save notes, save
  // profile) so a late-arriving cache-revalidation slice can't clobber the
  // user's in-progress edit. Reset each time a fresh load starts.
  const dirtySavedRef = useRef(false);
  const dirtyPursuitsRef = useRef(false);
  const dirtyProfileRef = useRef(false);

  const loadCandidates = useCallback(async (opts?: { silent?: boolean; userId?: string }) => {
    const silent = opts?.silent === true;
    const userId = opts?.userId ?? user?.id ?? null;
    // Non-silent loads are the ones that flip the page-level loading spinner.
    // Guard against re-entrancy so a bounced bootstrap effect (auth listener
    // ticks, dep churn) can't stack overlapping loads and race the final
    // setLoading(false) into never firing.
    if (!silent) {
      if (loadInFlightRef.current) return;
      loadInFlightRef.current = true;
      dirtySavedRef.current = false;
      dirtyPursuitsRef.current = false;
      dirtyProfileRef.current = false;
    }
    if (!silent) setLoadError(null);

    const perfMark = (label: string) => {
      if (typeof performance !== "undefined") {
        try { performance.mark(`opps:${label}:${silent ? "silent" : "cold"}`); } catch { /* noop */ }
      }
    };
    perfMark("load-start");

    // Candidate page fetcher — PostgREST's default max is 1000 rows/request
    // (pgrst.db_max_rows unset in prod, verified 2026-07-14). Fire pages 1
    // and 2 in parallel to shave ~one RTT off the common case where total
    // rows are between 1000 and 2000; fall through to the sequential loop
    // when page 2 is full.
    const PAGE_SIZE = 1000;
    const MAX_CANDIDATE_ROWS = 50000;
    const fetchPage = (from: number) => withTimeout(
      supabase
        .from("opportunity_candidates")
        .select(OPPORTUNITY_LIST_SELECT)
        // Server-side ingestion filter. Quarantined rows are already excluded
        // client-side by every tab predicate via isQuarantined, so grid
        // membership is unchanged (delta verified 0 for All/For You/Saved/
        // Closed/Filtered Out/globally-excluded/duplicates). Bottom Filtered
        // Out section is unaffected because it contains globally-excluded
        // rows, all of which are ingestion_status='valid'.
        .eq("ingestion_status", "valid")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1),
      `opportunity candidates page ${from / PAGE_SIZE + 1}`,
    );

    const candidatesPromise = (async () => {
      const data: any[] = [];
      const [page1, page2] = await Promise.all([fetchPage(0), fetchPage(PAGE_SIZE)]);
      if (page1.error) throw page1.error;
      if (page2.error) throw page2.error;
      const b1 = page1.data ?? [];
      const b2 = page2.data ?? [];
      data.push(...b1, ...b2);
      if (b1.length === PAGE_SIZE) {
        console.info(`[opps] page 1 returned exactly ${PAGE_SIZE} rows`);
      }
      // Sequential fallback if page 2 also came back full — total > 2000.
      if (b2.length === PAGE_SIZE) {
        console.info(`[opps] page 2 returned exactly ${PAGE_SIZE} rows — falling through to sequential paginator`);
        for (let from = PAGE_SIZE * 2; ; from += PAGE_SIZE) {
          const { data: page, error } = await fetchPage(from);
          if (error) throw error;
          const batch = page ?? [];
          data.push(...batch);
          if (batch.length < PAGE_SIZE) break;
          if (data.length >= MAX_CANDIDATE_ROWS) {
            console.warn(`[opps] candidate pagination hit the ${MAX_CANDIDATE_ROWS}-row safety ceiling; some rows may be omitted`);
            break;
          }
        }
      }
      return data;
    })();

    // Fire user-side queries in parallel with the candidate fetch. Each is
    // an independent slice with its own state setter; failures on individual
    // slices don't block the grid from painting (For You still fails closed
    // on qualification/profile error via the outer catch, matching prior
    // behavior).
    const userSidePromise = userId ? Promise.allSettled([
      withTimeout(
        (supabase as any)
          .from("saved_opportunities")
          .select("opportunity_candidate_id")
          .eq("user_id", userId),
        "saved opportunities",
      ),
      withTimeout(fetchCompanyPursuits(), "company pursuits"),
      fetchAllPages<QualificationRow>((from, to) => withTimeout(
        (supabase as any)
          .from("user_opportunity_qualifications")
          .select("opportunity_candidate_id, status, primary_reason, reasons")
          .eq("user_id", userId)
          .eq("active", true)
          .order("opportunity_candidate_id", { ascending: true })
          .range(from, to),
        `user opportunity qualifications page ${from / 1000 + 1}`,
      )),
      withTimeout(
        (supabase as any)
          .from("gc_qualification_profiles")
          .select("target_counties, min_project_value, max_project_value")
          .eq("profile_id", userId)
          .maybeSingle(),
        "bid profile",
      ),
    ]) : Promise.resolve(null);

    try {
      const data = await candidatesPromise;
      const rows: Candidate[] = data.map(mapRow);
      perfMark("candidates-ready");

      // Paint candidates immediately — tabs that don't need side data ("all",
      // "closed") can render on the very next frame while user-side slices
      // hydrate in the background.
      if (silent) {
        setCandidates((prev) => {
          const prevById = new Map(prev.map((c) => [c.id, c]));
          const changedIds: string[] = [];
          for (const r of rows) {
            const p = prevById.get(r.id);
            if (
              !p ||
              p.document_acquisition_status !== r.document_acquisition_status ||
              p.document_processing_status !== r.document_processing_status ||
              p.analysis_status !== r.analysis_status ||
              p.status !== r.status ||
              p.converted_project_id !== r.converted_project_id
            ) {
              changedIds.push(r.id);
            }
          }
          if (changedIds.length > 0) console.info("[opps] polling applied diff", { changedIds });
          return rows;
        });
      } else {
        setCandidates(rows);
      }
      setCandidatesReady(true);

      const scannedDates: string[] = data
        .map((r: any) => r.opportunity_sources?.last_scanned_at)
        .filter(Boolean);
      const nextLastScanned = scannedDates.length > 0
        ? scannedDates.sort().reverse()[0]
        : null;
      if (nextLastScanned) setLastScannedAt(nextLastScanned);
      writeCandidatesCache(rows, nextLastScanned);

      const userSide = await userSidePromise;
      let pursuits = new Map<string, PursuitLite>();
      let savedSet: Set<string> | null = null;
      let qualMap: Map<string, StoredQualification> | null = null;
      let profileParams: BidProfileParams | null = null;
      let hasBidProfile = false;

      if (userSide && userId) {
        const [savedResult, pursuitsResult, qualificationResult, profileResult] = userSide;

        if (savedResult.status === "fulfilled" && !(savedResult.value as any)?.error) {
          savedSet = new Set(
            ((savedResult.value as any)?.data ?? [])
              .map((r: any) => r.opportunity_candidate_id)
              .filter(Boolean),
          );
          if (!dirtySavedRef.current) setSavedCandidateIds(savedSet);
        } else if (savedResult.status === "rejected") {
          console.warn("[opps] saved opportunities skipped", savedResult.reason);
        }
        setSavedReady(true);

        if (pursuitsResult.status === "fulfilled") {
          pursuits = pursuitsResult.value;
          if (!dirtyPursuitsRef.current) setPursuitByCandidate(pursuits);
        } else {
          console.warn("[opps] pursuits skipped", pursuitsResult.reason);
        }

        if (qualificationResult.status === "fulfilled") {
          qualMap = new Map(qualificationResult.value.map((row) => [
            row.opportunity_candidate_id,
            { status: row.status, primary_reason: row.primary_reason, reasons: row.reasons ?? [] },
          ]));
          setQualificationByCandidate(qualMap);
        } else {
          // Fail closed: never turn a partial/missing qualification map into
          // apparent matches.
          throw qualificationResult.reason;
        }

        if (profileResult.status === "fulfilled" && !(profileResult.value as any)?.error) {
          const profileRow = (profileResult.value as any)?.data;
          profileParams = {
            targetCounties: profileRow?.target_counties ?? [],
            minProjectValue: profileRow?.min_project_value ?? null,
            maxProjectValue: profileRow?.max_project_value ?? null,
          };
          hasBidProfile = Boolean(profileRow);
          if (!dirtyProfileRef.current) setBidProfile(profileParams);
        } else {
          throw profileResult.status === "rejected"
            ? profileResult.reason
            : new Error("bid profile load failed");
        }
        setProfileReady(true);
      }

      if (!silent) {
        const initialNotes: Record<string, string> = {};
        rows.forEach((r) => {
          initialNotes[r.id] = pursuits.get(r.id)?.triage_notes ?? r.review_notes ?? "";
        });
        setNotes(initialNotes);
      }

      if (userId && savedSet && qualMap && profileParams) {
        writeUserSideCache(userId, {
          saved: savedSet,
          pursuits,
          qualification: qualMap,
          bidProfile: profileParams,
          hasBidProfile,
        });
      }
      perfMark("load-end");
      try {
        performance.measure("opps:total", `opps:load-start:${silent ? "silent" : "cold"}`, `opps:load-end:${silent ? "silent" : "cold"}`);
      } catch { /* noop */ }
    } catch (err) {
      console.error("[opps] loadCandidates failed", err);
      if (!silent) {
        setLoadError(err instanceof Error ? err.message : "Failed to load opportunities");
        toast({ title: "Error", description: "Failed to load opportunities", variant: "destructive" });
      }
    } finally {
      if (!silent) {
        setLoading(false);
        loadInFlightRef.current = false;
      }
    }
  }, [toast, mapRow, user?.id]);

  // Auth gate: redirect unauthenticated users. Runs whenever the auth status
  // itself changes — NOT on every render — so a token refresh event that
  // produces a new `user` object reference for the same id doesn't retrigger
  // the bootstrap load.
  useEffect(() => {
    if (!authReady) return;
    if (!user) navigate("/auth");
  }, [authReady, user, navigate]);

  // Bootstrap load: runs exactly once per authenticated user id. Deliberately
  // does NOT depend on `loadCandidates` identity — that dep was the cause of
  // the "stuck on Loading opportunities..." bug: any dep churn re-flipped
  // `setLoading(true)` and stacked overlapping loads.
  const bootstrappedForUserRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authReady || !user) return;
    if (bootstrappedForUserRef.current === user.id) return;
    bootstrappedForUserRef.current = user.id;

    // Stale-while-revalidate: seed React state from the in-memory cache so the
    // page paints real cards instantly on warm mount, then always kick off a
    // background revalidation. The cache module clears itself on SIGNED_OUT
    // and account switch so cross-account leakage is impossible.
    const cachedCandidates = readCandidatesCache();
    const cachedUser = readUserSideCache(user.id);
    const hasFreshCandidates = isFresh(cachedCandidates);
    const hasFreshUser = isFresh(cachedUser);

    if (cachedCandidates) {
      setCandidates(cachedCandidates.rows);
      if (cachedCandidates.lastScannedAt) setLastScannedAt(cachedCandidates.lastScannedAt);
      setCandidatesReady(true);
    } else {
      setCandidates([]);
      setCandidatesReady(false);
    }
    if (cachedUser) {
      setSavedCandidateIds(new Set(cachedUser.saved));
      setPursuitByCandidate(new Map(cachedUser.pursuits));
      setQualificationByCandidate(new Map(cachedUser.qualification));
      setBidProfile(cachedUser.bidProfile);
      setSavedReady(true);
      setProfileReady(true);
    } else {
      setPursuitByCandidate(new Map());
      setQualificationByCandidate(new Map());
      setSavedCandidateIds(new Set());
      setBidProfile(EMPTY_BID_PROFILE);
      setSavedReady(false);
      setProfileReady(false);
    }
    // Hide the legacy full-page spinner as soon as any cached slice is
    // available; the always-rendered shell + skeleton grid handles cold load.
    setLoading(!(hasFreshCandidates && hasFreshUser));
    setAgencyFilter([]);
    void loadCandidates({ userId: user.id });

    // Rehydrate active scan panel if there are non-terminal portal scan
    // tasks still running in the background (survives reloads/navigation).
    // Portal-agnostic: matches any "<portal>_scan" task type.
    (async () => {
      const sinceIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
      const { data: activeTasks } = await supabase
        .from("agent_tasks")
        .select("id, created_at")
        .like("task_type", "%_scan")
        .in("status", ["pending", "running", "retrying"])
        .gte("created_at", sinceIso);
      if (activeTasks && activeTasks.length > 0) {
        setActiveScanTaskIds(activeTasks.map((t: any) => t.id));
        setScanStartedAt(activeTasks.map((t: any) => t.created_at).sort()[0]);
        setScanActive(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally gated on user id, not loadCandidates identity
  }, [authReady, user?.id]);

  // Watchdog: if the loading spinner is somehow still up 15s after we started,
  // surface it in the console so we get a signal next time instead of a silent hang.
  useEffect(() => {
    if (!loading) return;
    const t = window.setTimeout(() => {
      console.warn("[opps] loading watchdog tripped — still loading after 15s", {
        userId: user?.id,
        authReady,
        inFlight: loadInFlightRef.current,
      });
    }, 15000);
    return () => window.clearTimeout(t);
  }, [loading, user?.id, authReady]);


  useEffect(() => {
    const job = qualificationJob.job;
    if (!job?.id) return;

    const previous = lastObservedQualificationJob.current;
    lastObservedQualificationJob.current = { id: job.id, status: job.status };

    if (job.status !== "complete") return;
    if (completedQualificationJob.current === job.id) return;

    // If the latest job is already complete when the page mounts, it is
    // historical state, not a new completion. Mark it as seen so navigating to
    // /opportunities doesn't show "Opportunities updated" every time.
    if (previous?.id !== job.id || previous.status === "complete") {
      completedQualificationJob.current = job.id;
      return;
    }

    completedQualificationJob.current = job.id;
    void loadCandidates({ silent: true });
    toast({ title: "Opportunities updated", description: "Your latest Bid Profile results are now active." });
  }, [qualificationJob.job?.id, qualificationJob.job?.status, loadCandidates, toast]);

  // Realtime: opportunity_candidates INSERT/UPDATE
  useEffect(() => {
    const channel = supabase
      .channel("opportunity-candidates-feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "opportunity_candidates" },
        async (payload) => {
          const newRow: any = payload.new;
          console.info("[opps] realtime INSERT", { id: newRow?.id });
          // Fetch joined source name
          const { data: src } = await supabase
            .from("opportunity_sources")
            .select("name, last_scanned_at")
            .eq("id", newRow.source_id)
            .maybeSingle();
          const mapped = mapRow({ ...newRow, opportunity_sources: src ?? null });
          setCandidates((prev) =>
            prev.some((c) => c.id === mapped.id) ? prev : [mapped, ...prev],
          );
          if (src?.last_scanned_at) setLastScannedAt(src.last_scanned_at);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "opportunity_candidates" },
        (payload) => {
          const updated: any = payload.new;
          console.info("[opps] realtime UPDATE", {
            id: updated?.id,
            doc_status: updated?.document_acquisition_status,
            processing_status: updated?.document_processing_status,
            analysis_status: updated?.analysis_status,
          });
          setCandidates((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? mapRow({ ...updated, opportunity_sources: { name: c.source_name } })
                : c,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [mapRow]);

  // Realtime safety-net: poll when at least one candidate is in an active
  // (non-terminal) workflow state. Stops automatically when everything is
  // terminal. Keeps Realtime as the primary update mechanism.
  const { hasActiveCandidates, activeCount } = useMemo(() => {
    let count = 0;
    for (const c of candidates) {
      const docActive = ACTIVE_DOCUMENT_STATUSES.includes(c.document_acquisition_status);
      const processingActive = ACTIVE_DOCUMENT_PROCESSING_STATUSES.includes(c.document_processing_status);
      const analysisActive = ACTIVE_ANALYSIS_STATUSES.includes(c.analysis_status);
      if (docActive || processingActive || analysisActive) count += 1;
    }
    return { hasActiveCandidates: count > 0, activeCount: count };
  }, [candidates]);

  const pollInFlightRef = useRef(false);

  // Restore scroll position to the last-clicked opportunity card once, per
  // mount, after the list has finished loading (and the cards have therefore
  // committed to the DOM). Runs identically whether the user arrived via the
  // browser Back button or the "Back to Opportunities" button, since both
  // simply remount this component at the /opportunities route.
  const scrollRestoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (loading || scrollRestoreAttemptedRef.current) return;
    scrollRestoreAttemptedRef.current = true;

    const raw = sessionStorage.getItem(SCROLL_ANCHOR_KEY);
    if (!raw) return;
    sessionStorage.removeItem(SCROLL_ANCHOR_KEY);

    let anchor: { id: string; scrollY: number } | null = null;
    try {
      anchor = JSON.parse(raw);
    } catch {
      return;
    }
    if (!anchor) return;

    const target = document.querySelector(`[data-candidate-id="${CSS.escape(anchor.id)}"]`);
    if (target) {
      target.scrollIntoView({ block: "center" });
    } else if (typeof anchor.scrollY === "number") {
      // Card no longer present (e.g. filters changed) — fall back to the raw
      // offset rather than leaving the user at the top.
      window.scrollTo({ top: anchor.scrollY });
    }
  }, [loading]);

  // Full-dataset polling intentionally removed: Realtime channel
  // (`opportunity-candidates-feed`) streams INSERT/UPDATE events, and the
  // qualification job hook polls its own row. Refreshing every candidate row
  // every 7s was flooding the network and could re-race the loading spinner.
  // Qualification job completion triggers a single silent refresh in the
  // effect above (see `qualificationJob.job` watcher). Do not reintroduce a
  // dataset-wide interval without explicit product approval.
  void pollInFlightRef; void hasActiveCandidates; void activeCount;

  // Realtime: stream agent_tasks INSERTs into the panel as soon as scan-opportunities queues them
  useEffect(() => {
    if (!scanActive || !scanStartedAt) return;
    const startedMs = new Date(scanStartedAt).getTime();
    const channel = supabase
      .channel(`scan-task-inserts-${startedMs}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_tasks" },
        (payload) => {
          const row: any = payload.new;
          if (!(typeof row?.task_type === "string" && row.task_type.endsWith("_scan"))) return;
          const createdMs = new Date(row.created_at).getTime();
          if (createdMs < startedMs - 1000) return;
          setActiveScanTaskIds((prev) => (prev.includes(row.id) ? prev : [...prev, row.id]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [scanActive, scanStartedAt]);

  const handleScanNow = async () => {
    setScanLoading(true);
    const startedAt = new Date().toISOString();
    setScanStartedAt(startedAt);
    setActiveScanTaskIds([]);
    setScanActive(true);

    try {
      const { data, error } = await supabase.functions.invoke("scan-opportunities");
      if (error) throw error;

      const totalQueued: number = data?.total_queued ?? 0;
      const sourcesScanned: number = data?.sources_scanned ?? 0;

      // Backstop: catch any tasks that the INSERT subscription missed (e.g. before it subscribed)
      if (totalQueued > 0) {
        const { data: queuedTasks } = await supabase
          .from("agent_tasks")
          .select("id")
          .like("task_type", "%_scan")
          .gte("created_at", startedAt);
        if (queuedTasks && queuedTasks.length > 0) {
          setActiveScanTaskIds((prev) => {
            const merged = new Set(prev);
            queuedTasks.forEach((t: any) => merged.add(t.id));
            return Array.from(merged);
          });
        }
        toast({
          title: "Refresh started",
          description: `${totalQueued} source${totalQueued === 1 ? "" : "s"} queued. Opportunities update as portal metadata refreshes.`,
        });
      } else if (sourcesScanned === 0) {
        toast({
          title: "No sources due",
          description: "All sources were refreshed recently. Try again later.",
        });
        setScanActive(false);
      } else {
        toast({
          title: "Refresh complete",
          description: `${data?.total_candidates_new ?? 0} new opportunities found.`,
        });
        setScanActive(false);
        await loadCandidates();
      }
    } catch (e: any) {
      toast({ title: "Refresh failed", description: e?.message ?? "Unknown error", variant: "destructive" });
      setScanActive(false);
    } finally {
      setScanLoading(false);
    }
  };

  const handleNotesSave = async (id: string) => {
    const note = notes[id] ?? "";
    // Notes are tenant-owned state. Never write them to the shared canonical
    // opportunity row; pursuits is protected by company-scoped RLS.
    const wrote = await upsertPursuit(id, { triage_notes: note || null });
    if (!wrote) {
      toast({ title: "Error", description: "Failed to save notes", variant: "destructive" });
      return;
    }
    setPursuitByCandidate((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) next.set(id, { ...existing, triage_notes: note || null });
      return next;
    });
  };

  const handleToggleSaved = async (candidate: Candidate) => {
    const wasSaved = savedCandidateIds.has(candidate.id);
    dirtySavedRef.current = true;
    setSavedCandidateIds((prev) => {
      const next = new Set(prev);
      if (wasSaved) next.delete(candidate.id);
      else next.add(candidate.id);
      return next;
    });

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/auth"); return; }

      if (wasSaved) {
        const { error } = await (supabase as any)
          .from("saved_opportunities")
          .delete()
          .eq("user_id", session.user.id)
          .eq("opportunity_candidate_id", candidate.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("saved_opportunities")
          .upsert(
            { user_id: session.user.id, opportunity_candidate_id: candidate.id },
            { onConflict: "user_id,opportunity_candidate_id" },
          );
        if (error) throw error;
      }

      toast({
        title: wasSaved ? "Removed from Saved" : "Saved opportunity",
        description: wasSaved ? "This opportunity was removed from your Saved tab." : "This opportunity now appears in Saved.",
      });
    } catch (e: any) {
      setSavedCandidateIds((prev) => {
        const next = new Set(prev);
        if (wasSaved) next.add(candidate.id);
        else next.delete(candidate.id);
        return next;
      });
      toast({
        title: wasSaved ? "Failed to unsave" : "Failed to save",
        description: e?.message ?? "Please try again.",
        variant: "destructive",
      });
    }
  };

  // Distinct county / agency options from loaded candidates.
  const { countyOptions, agencyOptions, hasNoCounty, hasNoAgency } = useMemo(() => {
    const counties = new Set<string>();
    const agencies = new Set<string>();
    let noCounty = false;
    let noAgency = false;
    for (const c of candidates) {
      const cty = getCandidateCounty(c);
      if (cty) counties.add(cty);
      else noCounty = true;
      const ag = (c.agency ?? "").trim();
      if (ag) agencies.add(ag);
      else noAgency = true;
    }
    return {
      countyOptions: Array.from(counties).sort((a, b) => a.localeCompare(b)),
      agencyOptions: Array.from(agencies).sort((a, b) => a.localeCompare(b)),
      hasNoCounty: noCounty,
      hasNoAgency: noAgency,
    };
  }, [candidates]);

  const matchesFacets = useCallback(
    (c: Candidate) => {
      if (agencyFilter.length > 0) {
        const ag = (c.agency ?? "").trim();
        const key = ag || NO_VALUE_SENTINEL;
        if (!agencyFilter.includes(key)) return false;
      }
      return true;
    },
    [agencyFilter],
  );

  const buildComparator = useCallback((key: SortKey) => {
    return (a: Candidate, b: Candidate): number => {
      if (key === "added_desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      if (key === "added_asc") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      const aDue = a.bid_due_at ? new Date(a.bid_due_at).getTime() : null;
      const bDue = b.bid_due_at ? new Date(b.bid_due_at).getTime() : null;
      if (aDue === null && bDue === null) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (aDue === null) return 1;
      if (bDue === null) return -1;
      if (key === "due_desc") return bDue - aDue;
      return aDue - bDue;
    };
  }, []);

  // Tab membership — single source of truth for BOTH rendered lists and badge
  // counts, built from the shared pure predicates (src/lib/opportunityTabs.ts,
  // src/lib/bidProfileMatching.ts). Per-user qualification output
  // (user_opportunity_qualifications) deliberately plays no role here: it only
  // feeds the existing card-internal "Filtered out" messaging.
  const tabLists = useMemo(() => {
    const all: Candidate[] = [];
    const allFilteredOut: Candidate[] = [];
    const saved: Candidate[] = [];
    const closed: Candidate[] = [];
    const forYouConfirmed: Candidate[] = [];
    const forYouUnpriced: Candidate[] = [];

    for (const c of candidates) {
      if (!matchesFacets(c)) continue;
      if (isClosedTabMember(c)) {
        closed.push(c);
        continue;
      }
      if (isSavedTabMember(c, savedCandidateIds)) saved.push(c);
      if (isAllTabMember(c)) {
        all.push(c);
        // For You: same globally valid, canonical, open inventory as All,
        // filtered directly by construction evidence plus the operational Bid
        // Profile parameters, then split into priced vs unpriced sections.
        const section = classifyForYouSection(c, bidProfile);
        if (section === "confirmed") forYouConfirmed.push(c);
        else if (section === "unpriced") forYouUnpriced.push(c);
      } else if (isAllTabFilteredOutMember(c)) {
        allFilteredOut.push(c);
      }
    }

    // The selected sort applies independently within each list/section; the
    // two For You sections are never intermixed.
    const cmp = buildComparator(sortKey);
    all.sort(cmp);
    allFilteredOut.sort(cmp);
    saved.sort(cmp);
    closed.sort(cmp);
    forYouConfirmed.sort(cmp);
    forYouUnpriced.sort(cmp);

    return { all, allFilteredOut, saved, closed, forYouConfirmed, forYouUnpriced };
  }, [candidates, matchesFacets, savedCandidateIds, bidProfile, sortKey, buildComparator]);

  const tabCounts: Record<OpportunityTab, number> = useMemo(() => ({
    all: tabLists.all.length,
    "for-you": tabLists.forYouConfirmed.length + tabLists.forYouUnpriced.length,
    saved: tabLists.saved.length,
    closed: tabLists.closed.length,
  }), [tabLists]);

  const hasActiveFacetFilters = agencyFilter.length > 0;

  // Global validity and the authenticated user's qualification are distinct.
  // Qualification reasons are presentation-scoped so they cannot leak into
  // the unfiltered All inventory.
  const hasActiveQualifications = qualificationByCandidate.size > 0;

  // Records viewed state on deliberate project-detail activation, and stamps
  // the active tab onto the scroll anchor the card just wrote so returning
  // from the detail page restores this tab. Synchronous — never delays
  // navigation.
  const handleCardOpen = useCallback((candidateId: string) => {
    markViewed(candidateId);
    try {
      const raw = sessionStorage.getItem(SCROLL_ANCHOR_KEY);
      if (raw) {
        const anchor = JSON.parse(raw);
        if (anchor?.id === candidateId) {
          sessionStorage.setItem(SCROLL_ANCHOR_KEY, JSON.stringify({ ...anchor, tab: activeTab }));
        }
      }
    } catch {
      // Anchor stamping is best-effort; viewed state already recorded.
    }
  }, [markViewed, activeTab]);

  const renderCandidateCard = (
    candidate: Candidate,
    navIds?: string[],
    cardContext: OpportunityCardReasonContext = "for-you",
  ) => (
    <ViewedCardWrapper key={candidate.id} viewed={viewedIds.has(candidate.id)}>
      <OpportunityCard
        candidate={candidate}
        navIds={navIds}
        saved={savedCandidateIds.has(candidate.id)}
        onCalendar={
          Boolean(pursuitByCandidate.get(candidate.id)?.project_id) ||
          (candidate.status === "converted" && !!candidate.converted_project_id)
        }
        filterReasons={getCardFilterReasons(
          candidate,
          qualificationByCandidate.get(candidate.id),
          hasActiveQualifications,
          cardContext,
        )}
        viewed={viewedIds.has(candidate.id)}
        onToggleSaved={handleToggleSaved}
        onOpen={handleCardOpen}
      />
    </ViewedCardWrapper>
  );

  // Ordered ID lists passed as nav context to the detail page so Prev/Next
  // arrows stay within the rendered view.
  const currentTabList =
    activeTab === "all" ? tabLists.all
    : activeTab === "saved" ? tabLists.saved
    : activeTab === "closed" ? tabLists.closed
    : null;
  const forYouNavIds = useMemo(
    () => [...tabLists.forYouConfirmed, ...tabLists.forYouUnpriced].map((c) => c.id),
    [tabLists.forYouConfirmed, tabLists.forYouUnpriced],
  );
  const currentTabNavIds = useMemo(
    () => (currentTabList ? currentTabList.map((c) => c.id) : forYouNavIds),
    [currentTabList, forYouNavIds],
  );

  // Tab-scoped first-paint gate. All/Closed paint the instant candidates are
  // back; Saved additionally waits for the saved-id set; For You additionally
  // waits for the Bid Profile. Qualifications and pursuits hydrate in the
  // background and re-render in place — never a gate. Warm-cache mounts have
  // both readiness flags true immediately.
  const firstPaintReady = (() => {
    if (!candidatesReady) return false;
    if (activeTab === "saved") return savedReady;
    if (activeTab === "for-you") return profileReady;
    return true;
  })();

  return (
    <Layout showSidebar={true}>
      <TooltipProvider delayDuration={150}>
        {loadError ? (
          <div className="flex flex-col items-center justify-center gap-3 min-h-[calc(100vh-4rem)] text-center px-6">
            <p className="text-sm text-muted-foreground max-w-md">
              We couldn't load opportunities. {loadError}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                void loadCandidates();
              }}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : (
          <div className="p-8">
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-3xl font-bold text-foreground">Opportunities</h1>
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleScanNow}
                        disabled={scanLoading}
                        className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${scanLoading ? "animate-spin" : ""}`} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Re-Scan</TooltipContent>
                  </Tooltip>
                  Last scanned: {timeAgo(lastScannedAt)}
                </p>
              </div>
            </div>

            {scanActive && (
              <ActiveScansPanel
                taskIds={activeScanTaskIds}
                isQueuing={scanLoading}
                onDismiss={() => {
                  setActiveScanTaskIds([]);
                  setScanActive(false);
                  setScanStartedAt(null);
                }}
              />
            )}

            {qualificationJob.isUpdating && (
              <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                <p className="font-medium">Updating opportunities for your new Bid Profile</p>
                <p className="mt-1 text-blue-800">
                  Existing results remain visible until the update completes
                  {qualificationJob.job?.total_candidates
                    ? ` (${qualificationJob.job.processed_candidates} of ${qualificationJob.job.total_candidates})`
                    : ""}.
                </p>
              </div>
            )}
            {qualificationJob.job?.status === "failed" && (
              <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
                <span>The Bid Profile update failed. Your previous complete results are still active.</span>
                <Button variant="outline" size="sm" onClick={() => void qualificationJob.retry()}>Retry</Button>
              </div>
            )}


            {/* Filter tabs + sort */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <OpportunityTabs activeTab={activeTab} counts={tabCounts} onTabChange={setActiveTab} />
              <div className="flex items-center gap-2 flex-wrap">
                <Popover open={sortMenuOpen} onOpenChange={setSortMenuOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9 gap-2">
                      <Filter className="h-3.5 w-3.5" />
                      <span>Filter</span>
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-1 w-[220px]" align="end">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setSortKey(opt.value);
                          setSortMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md hover:bg-accent ${
                          sortKey === opt.value ? "text-foreground font-medium" : "text-muted-foreground"
                        }`}
                      >
                        <Check
                          className={`h-4 w-4 ${sortKey === opt.value ? "opacity-100" : "opacity-0"}`}
                        />
                        <span>{opt.label}</span>
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
                <FacetMultiSelect
                  label="Agency"
                  icon={<Building2 className="h-3.5 w-3.5" />}
                  options={agencyOptions}
                  hasNone={hasNoAgency}
                  noneLabel="(No agency)"
                  value={agencyFilter}
                  onChange={setAgencyFilter}
                  searchPlaceholder="Search agencies..."
                />
                {hasActiveFacetFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAgencyFilter([])}
                    className="text-sm text-muted-foreground hover:text-foreground"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </div>

            {/* Cards */}
            {!firstPaintReady ? (
              <OpportunityGridSkeleton count={6} />
            ) : activeTab === "for-you" ? (
              <>
                {/* Profile guidance — a subtle note, never blocking the list */}
                <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Powered by your Bid Profile. Complete or adjust your profile to refine these opportunities.
                  </span>
                  <button
                    onClick={() => navigate("/qualification-profile")}
                    className="font-medium text-blue-700 hover:underline"
                  >
                    Adjust Bid Profile
                  </button>
                </div>

                <section className="mb-10">
                  <OpportunitySectionHeader
                    title="Confirmed Price Matches"
                    count={tabLists.forYouConfirmed.length}
                    description="Confirmed estimates within your Bid Profile parameters."
                  />
                  {tabLists.forYouConfirmed.length === 0 ? (
                    <OpportunitySectionEmpty>
                      No confirmed-price opportunities currently fall within your selected parameters.
                    </OpportunitySectionEmpty>
                  ) : (
                    <OpportunityGrid>
                      {tabLists.forYouConfirmed.map((c) => renderCandidateCard(c, forYouNavIds, "for-you"))}
                    </OpportunityGrid>
                  )}
                </section>

                <section
                  data-testid="unpriced-opportunities-section"
                  className="mt-14 rounded-xl border-t-4 border-slate-300 bg-slate-100/80 px-4 py-8 sm:px-6 lg:px-8"
                >
                  <div data-testid="unpriced-opportunities-section-header">
                    <OpportunitySectionHeader
                      title="Unpriced Opportunities"
                      count={tabLists.forYouUnpriced.length}
                      description="These opportunities match your selected geography, but no confirmed engineer's estimate. Review bid documents to determine project size."
                    />
                  </div>
                  {tabLists.forYouUnpriced.length === 0 ? (
                    <OpportunitySectionEmpty>
                      No unpriced construction opportunities currently match your selected geography.
                    </OpportunitySectionEmpty>
                  ) : (
                    <div data-testid="unpriced-opportunities-card-grid">
                      <OpportunityGrid>
                        {tabLists.forYouUnpriced.map((c) => renderCandidateCard(c, forYouNavIds, "for-you"))}
                      </OpportunityGrid>
                    </div>
                  )}
                </section>
              </>
            ) : (currentTabList?.length ?? 0) === 0 && !(activeTab === "all" && tabLists.allFilteredOut.length > 0) ? (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <p className="text-lg font-medium text-foreground mb-2">No opportunities found</p>
                <p className="text-sm text-muted-foreground mb-6">
                  {activeTab === "all"
                    ? "Click Refresh Now to discover and update bids from Caltrans and PlanetBids."
                    : "No opportunities in this view."}
                </p>
                {activeTab === "all" && (
                  <Button
                    onClick={handleScanNow}
                    disabled={scanLoading}
                    className="bg-[hsl(var(--bidbox-blue))] text-white hover:bg-[hsl(var(--bidbox-blue))]/90"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${scanLoading ? "animate-spin" : ""}`} />
                    {scanLoading ? "Refreshing..." : "Refresh Now"}
                  </Button>
                )}
              </div>
            ) : (
              <>
                {(currentTabList?.length ?? 0) === 0 ? (
                  <div className="text-sm text-muted-foreground py-12 text-center">
                    No opportunities match this view.
                  </div>
                ) : (
                  <OpportunityGrid>
                    {(currentTabList ?? []).map((c) => renderCandidateCard(
                      c,
                      currentTabNavIds,
                      activeTab === "all" ? "all-main" : activeTab,
                    ))}
                  </OpportunityGrid>
                )}
                {activeTab === "all" && tabLists.allFilteredOut.length > 0 && (
                  <Collapsible
                    open={filteredOutOpen}
                    onOpenChange={setFilteredOutOpen}
                    className="mt-10"
                  >
                    <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${filteredOutOpen ? "rotate-0" : "-rotate-90"}`}
                      />
                      Filtered Out ({tabLists.allFilteredOut.length})
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-4">
                      <div className="opacity-70">
                        <OpportunityGrid>
                          {tabLists.allFilteredOut.map((c) => renderCandidateCard(c, undefined, "all-filtered"))}
                        </OpportunityGrid>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </>
            )}
          </div>
        )}
      </TooltipProvider>
    </Layout>
  );
};

export default Opportunities;
