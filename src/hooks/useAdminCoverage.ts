import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Data layer for the Admin Coverage Dashboard.
 *
 * Design notes (deliberate):
 * - Zero new schema. Everything derives from tables that already exist and
 *   are authenticated-readable (opportunity_sources, opportunity_candidates,
 *   portal_drivers, agent_tasks). The Procurement Atlas registry
 *   (agencies / agency_portals / portal_families) and its agency_coverage /
 *   family_opportunity / source_health views are designed but not yet in
 *   production — when Atlas Phase 0 lands, this hook swaps its rollups for
 *   those views instead of computing client-side. Do not duplicate those
 *   concepts here; compute, don't persist.
 * - Health semantics follow the Atlas MVP-3 thresholds
 *   (docs/initiatives/procurement-atlas-implementation-plan.md §5.3):
 *   failed = last_refresh_status 'failed'; stale/warning = no completed
 *   activity within 2x the scan interval; never = never scanned.
 * - Row volumes are small at current scale (~80 sources, a few thousand
 *   candidates). Candidates are fetched as skinny rows with paging capped at
 *   CANDIDATE_FETCH_CAP; the exact total always comes from a head count, and
 *   `candidateSampleTruncated` flags when rollups are computed on a sample.
 */

const CANDIDATE_PAGE = 1000;
const CANDIDATE_FETCH_CAP = 10000;
const STALE_MULTIPLIER = 2;

export interface SourceRow {
  id: string;
  name: string;
  portal_type: string;
  listing_url: string;
  scan_enabled: boolean;
  scan_interval_hours: number | null;
  last_scanned_at: string | null;
  created_at: string;
  last_refresh_status: string | null;
  last_refresh_completed_at: string | null;
  last_refresh_failed_at: string | null;
  last_refresh_error: string | null;
}

export interface DriverRow {
  portal_type: string;
  driver_name: string;
  driver_mode: string;
  enabled: boolean;
}

interface CandidateRow {
  county: string | null;
  portal_type: string | null;
  source_id: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  task_type: string;
  status: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export type SourceHealth = "healthy" | "warning" | "failed" | "never" | "disabled";

export interface SourceWithHealth extends SourceRow {
  health: SourceHealth;
  lastActivityAt: string | null;
  candidateCount: number;
}

export interface FamilyRollup {
  portalType: string;
  driver: DriverRow | null;
  sourceCount: number;
  enabledCount: number;
  candidateCount: number;
  healthCounts: Record<SourceHealth, number>;
  lastCompletedAt: string | null;
  recentFailures: number;
}

export interface CoverageModel {
  // Coverage
  totalSources: number;
  enabledSources: number;
  disabledSources: number;
  totalCandidates: number;
  candidateSampleTruncated: boolean;
  families: FamilyRollup[];
  countyCounts: { county: string; count: number }[];
  monthlyGrowth: { month: string; count: number }[];
  newestSources: SourceRow[];
  // Source health
  sources: SourceWithHealth[];
  healthCounts: Record<SourceHealth, number>;
  failingSources: SourceWithHealth[];
  staleSources: SourceWithHealth[];
  // Operations
  queueCounts: { pending: number; running: number; retrying: number; failed24h: number };
  recentTasks: TaskRow[];
  recentFailures: TaskRow[];
  avgScanDurationMin: number | null;
  lastWorkerActivityAt: string | null;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 36e5;
}

function classifyHealth(s: SourceRow): { health: SourceHealth; lastActivityAt: string | null } {
  const lastActivityAt =
    [s.last_scanned_at, s.last_refresh_completed_at]
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  if (!s.scan_enabled) return { health: "disabled", lastActivityAt };
  if (s.last_refresh_status === "failed") return { health: "failed", lastActivityAt };
  if (!lastActivityAt) return { health: "never", lastActivityAt };

  const interval = s.scan_interval_hours && s.scan_interval_hours > 0 ? s.scan_interval_hours : 24;
  const age = hoursSince(lastActivityAt);
  if (age !== null && age > interval * STALE_MULTIPLIER) return { health: "warning", lastActivityAt };
  if (s.last_refresh_status === "partial") return { health: "warning", lastActivityAt };
  return { health: "healthy", lastActivityAt };
}

async function fetchAll(): Promise<CoverageModel> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- some columns are newer than the Lovable-generated types
  const sb = supabase as any;

  const dayAgo = new Date(Date.now() - 24 * 36e5).toISOString();

  const [
    sourcesRes,
    driversRes,
    candidateCountRes,
    pendingRes,
    runningRes,
    retryingRes,
    failed24Res,
    recentTasksRes,
    recentFailuresRes,
  ] = await Promise.all([
    sb.from("opportunity_sources")
      .select("id, name, portal_type, listing_url, scan_enabled, scan_interval_hours, last_scanned_at, created_at, last_refresh_status, last_refresh_completed_at, last_refresh_failed_at, last_refresh_error")
      .order("created_at", { ascending: false }),
    sb.from("portal_drivers").select("portal_type, driver_name, driver_mode, enabled"),
    sb.from("opportunity_candidates").select("id", { count: "exact", head: true }),
    sb.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "pending"),
    sb.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "running"),
    sb.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "retrying"),
    sb.from("agent_tasks").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", dayAgo),
    sb.from("agent_tasks")
      .select("id, task_type, status, error, created_at, started_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(25),
    sb.from("agent_tasks")
      .select("id, task_type, status, error, created_at, started_at, completed_at")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  if (sourcesRes.error) throw sourcesRes.error;
  if (driversRes.error) throw driversRes.error;

  const sources: SourceRow[] = sourcesRes.data ?? [];
  const drivers: DriverRow[] = driversRes.data ?? [];
  const totalCandidates: number = candidateCountRes.count ?? 0;

  // Skinny candidate rows for rollups, paged with a hard cap.
  const candidates: CandidateRow[] = [];
  for (let from = 0; from < CANDIDATE_FETCH_CAP; from += CANDIDATE_PAGE) {
    const { data, error } = await sb
      .from("opportunity_candidates")
      .select("county, portal_type, source_id, created_at")
      .order("created_at", { ascending: false })
      .range(from, from + CANDIDATE_PAGE - 1);
    if (error) throw error;
    candidates.push(...(data ?? []));
    if (!data || data.length < CANDIDATE_PAGE) break;
  }
  const candidateSampleTruncated = totalCandidates > candidates.length;

  // Scan-duration sample from completed scan tasks across known portal types.
  const scanTaskTypes = [...new Set(sources.map((s) => `${s.portal_type}_scan`))];
  let avgScanDurationMin: number | null = null;
  if (scanTaskTypes.length > 0) {
    const { data: scanTasks } = await sb
      .from("agent_tasks")
      .select("started_at, completed_at")
      .in("task_type", scanTaskTypes)
      .eq("status", "complete")
      .order("completed_at", { ascending: false })
      .limit(50);
    const durations = (scanTasks ?? [])
      .filter((t: TaskRow) => t.started_at && t.completed_at)
      .map((t: TaskRow) => (new Date(t.completed_at!).getTime() - new Date(t.started_at!).getTime()) / 60000)
      .filter((m: number) => m >= 0 && m < 240);
    if (durations.length > 0) {
      avgScanDurationMin = durations.reduce((a: number, b: number) => a + b, 0) / durations.length;
    }
  }

  // Per-source candidate counts + rollups.
  const candidatesBySource = new Map<string, number>();
  const countyMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  for (const c of candidates) {
    if (c.source_id) candidatesBySource.set(c.source_id, (candidatesBySource.get(c.source_id) ?? 0) + 1);
    const county = c.county?.trim() || "Unknown";
    countyMap.set(county, (countyMap.get(county) ?? 0) + 1);
    const month = c.created_at.slice(0, 7); // YYYY-MM
    monthMap.set(month, (monthMap.get(month) ?? 0) + 1);
  }

  const sourcesWithHealth: SourceWithHealth[] = sources.map((s) => ({
    ...s,
    ...classifyHealth(s),
    candidateCount: candidatesBySource.get(s.id) ?? 0,
  }));

  const healthCounts: Record<SourceHealth, number> = { healthy: 0, warning: 0, failed: 0, never: 0, disabled: 0 };
  for (const s of sourcesWithHealth) healthCounts[s.health]++;

  // Family rollups.
  const driverByType = new Map(drivers.map((d) => [d.portal_type, d]));
  const familyMap = new Map<string, FamilyRollup>();
  for (const s of sourcesWithHealth) {
    let fam = familyMap.get(s.portal_type);
    if (!fam) {
      fam = {
        portalType: s.portal_type,
        driver: driverByType.get(s.portal_type) ?? null,
        sourceCount: 0,
        enabledCount: 0,
        candidateCount: 0,
        healthCounts: { healthy: 0, warning: 0, failed: 0, never: 0, disabled: 0 },
        lastCompletedAt: null,
        recentFailures: 0,
      };
      familyMap.set(s.portal_type, fam);
    }
    fam.sourceCount++;
    if (s.scan_enabled) fam.enabledCount++;
    fam.candidateCount += s.candidateCount;
    fam.healthCounts[s.health]++;
    if (s.last_refresh_completed_at && (!fam.lastCompletedAt || s.last_refresh_completed_at > fam.lastCompletedAt)) {
      fam.lastCompletedAt = s.last_refresh_completed_at;
    }
  }
  for (const t of (recentFailuresRes.data ?? []) as TaskRow[]) {
    const type = t.task_type.replace(/_scan$/, "");
    const fam = familyMap.get(type);
    if (fam) fam.recentFailures++;
  }

  // Growth: last 6 calendar months, oldest first.
  const monthlyGrowth: { month: string; count: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyGrowth.push({
      month: d.toLocaleString("en-US", { month: "short" }),
      count: monthMap.get(key) ?? 0,
    });
  }

  const recentTasks = (recentTasksRes.data ?? []) as TaskRow[];
  const lastWorkerActivityAt =
    recentTasks
      .flatMap((t) => [t.started_at, t.completed_at])
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  return {
    totalSources: sources.length,
    enabledSources: sourcesWithHealth.filter((s) => s.scan_enabled).length,
    disabledSources: sourcesWithHealth.filter((s) => !s.scan_enabled).length,
    totalCandidates,
    candidateSampleTruncated,
    families: [...familyMap.values()].sort((a, b) => b.sourceCount - a.sourceCount),
    countyCounts: [...countyMap.entries()]
      .map(([county, count]) => ({ county, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    monthlyGrowth,
    newestSources: sources.slice(0, 8),
    sources: sourcesWithHealth,
    healthCounts,
    failingSources: sourcesWithHealth.filter((s) => s.health === "failed"),
    staleSources: sourcesWithHealth.filter((s) => s.health === "warning"),
    queueCounts: {
      pending: pendingRes.count ?? 0,
      running: runningRes.count ?? 0,
      retrying: retryingRes.count ?? 0,
      failed24h: failed24Res.count ?? 0,
    },
    recentTasks,
    recentFailures: (recentFailuresRes.data ?? []) as TaskRow[],
    avgScanDurationMin,
    lastWorkerActivityAt,
  };
}

export function useAdminCoverage() {
  return useQuery({
    queryKey: ["admin-coverage"],
    queryFn: fetchAll,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });
}
