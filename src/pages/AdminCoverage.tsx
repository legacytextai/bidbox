import { Layout } from "@/components/Layout";
import { AdminGuard } from "@/components/admin/AdminGuard";
import { StatCard, AdminSection, HealthPill, BarList } from "@/components/admin/AdminPrimitives";
import { timeAgo } from "@/lib/adminFormat";
import { useAdminCoverage } from "@/hooks/useAdminCoverage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

/**
 * Admin › Coverage — the first internal operations dashboard.
 *
 * Data comes from existing production tables only (see useAdminCoverage).
 * When Procurement Atlas Phase 0 lands its registry
 * (agencies/agency_portals/portal_families) and views, the Coverage and
 * Expansion sections upgrade from source-derived numbers to true
 * registry-backed agency coverage.
 */

// Known-but-unsupported portal families, from the California expansion
// strategy (2026-07). These are strategy estimates, not registry facts —
// replaced by the Atlas family_opportunity view when Phase 0 ships.
const KNOWN_UNSUPPORTED = [
  { family: "PlanetBids (statewide sweep remainder)", estimate: "~75–200 agencies", status: "config-only" },
  { family: "OpenGov Procurement", estimate: "~40–80 agencies", status: "driver needed" },
  { family: "BidNet Direct — CA Purchasing Group", estimate: "70+ agencies", status: "driver needed" },
  { family: "Cal eProcure / CSCR (state agencies)", estimate: "dozens of state depts", status: "driver needed" },
  { family: "Bonfire", estimate: "~30–60 agencies", status: "driver needed" },
  { family: "LADWP (ersp), SD County, OCTA, SANDAG…", estimate: "~10–15 high-value customs", status: "agency-direct" },
];

const CA_TARGET_SOURCES = 300; // Waves 0–3 strategy target (docs: CA expansion strategy)

const STATUS_BADGE: Record<string, string> = {
  complete: "bg-emerald-100 text-emerald-800",
  running: "bg-blue-100 text-blue-800",
  pending: "bg-slate-100 text-slate-700",
  retrying: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

const AdminCoverageContent = () => {
  const { data, isLoading, isError, error, refetch, isRefetching, dataUpdatedAt } = useAdminCoverage();

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-72" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6">
        <p className="text-destructive font-medium">Failed to load coverage data.</p>
        <p className="text-sm text-muted-foreground mt-1">{error instanceof Error ? error.message : "Unknown error"}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const workerAgeMin = data.lastWorkerActivityAt
    ? Math.floor((Date.now() - new Date(data.lastWorkerActivityAt).getTime()) / 60000)
    : null;
  // Nightly cadence: the worker is presumed OK if it has done anything in ~26h.
  const workerTone = workerAgeMin === null ? "warn" : workerAgeMin < 26 * 60 ? "good" : "bad";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Coverage</h1>
          <p className="text-sm text-muted-foreground">
            Internal operations · updated {timeAgo(new Date(dataUpdatedAt).toISOString())}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Coverage ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard label="Configured sources" value={data.totalSources} hint="opportunity_sources rows" />
        <StatCard label="Active" value={data.enabledSources} tone="good" hint="scan_enabled = true" />
        <StatCard label="Disabled" value={data.disabledSources} tone={data.disabledSources > 0 ? "warn" : "default"} hint="seeded / pending validation" />
        <StatCard label="Opportunities" value={data.totalCandidates.toLocaleString()} hint="all-time candidates" />
        <StatCard label="Portal families" value={data.families.length} hint="distinct portal_type" />
        <StatCard
          label="Worker activity"
          value={timeAgo(data.lastWorkerActivityAt)}
          tone={workerTone}
          hint="last task started/completed"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <AdminSection
          title="Coverage by portal family"
          description={`Sources and opportunities per family${data.candidateSampleTruncated ? " (opportunity rollups computed on most-recent sample)" : ""}`}
        >
          <BarList
            items={data.families.map((f) => ({
              label: f.portalType,
              count: f.sourceCount,
              sub: `${f.candidateCount.toLocaleString()} opps`,
            }))}
          />
        </AdminSection>

        <AdminSection title="Coverage by county" description="Opportunity counts by candidate county">
          <BarList items={data.countyCounts.map((c) => ({ label: c.county, count: c.count }))} />
        </AdminSection>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <AdminSection title="Opportunity growth" description="New opportunities discovered per month (last 6 months)">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthlyGrowth}>
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} width={40} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} />
                <Bar dataKey="count" fill="hsl(var(--bidbox-blue))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </AdminSection>

        <AdminSection title="Recently added sources" description="Newest agencies configured for scanning">
          <div className="space-y-2">
            {data.newestSources.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm gap-2">
                <span className="truncate" title={s.name}>{s.name}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{s.portal_type}</Badge>
                  <span className="text-xs text-muted-foreground w-16 text-right">{timeAgo(s.created_at)}</span>
                </span>
              </div>
            ))}
          </div>
        </AdminSection>
      </div>

      {/* ── Source Health ────────────────────────────────────────── */}
      <AdminSection
        title="Source health"
        description="Atlas MVP-3 thresholds: failed = last refresh failed · stale = no completed activity within 2× scan interval"
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Healthy" value={data.healthCounts.healthy} tone="good" />
          <StatCard label="Stale" value={data.healthCounts.warning} tone={data.healthCounts.warning > 0 ? "warn" : "default"} />
          <StatCard label="Failed" value={data.healthCounts.failed} tone={data.healthCounts.failed > 0 ? "bad" : "default"} />
          <StatCard label="Never scanned" value={data.healthCounts.never} tone={data.healthCounts.never > 0 ? "warn" : "default"} />
          <StatCard label="Disabled" value={data.healthCounts.disabled} />
        </div>

        {(data.failingSources.length > 0 || data.staleSources.length > 0) && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Family</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="max-w-[360px]">Last error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data.failingSources, ...data.staleSources].map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium max-w-[260px] truncate" title={s.name}>{s.name}</TableCell>
                  <TableCell><Badge variant="outline">{s.portal_type}</Badge></TableCell>
                  <TableCell><HealthPill health={s.health} /></TableCell>
                  <TableCell className="tabular-nums">{timeAgo(s.lastActivityAt)}</TableCell>
                  <TableCell className="max-w-[360px] truncate text-xs text-muted-foreground" title={s.last_refresh_error ?? ""}>
                    {s.last_refresh_error ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data.failingSources.length === 0 && data.staleSources.length === 0 && (
          <p className="text-sm text-muted-foreground">No failing or stale sources. All enabled sources are within cadence.</p>
        )}
      </AdminSection>

      {/* ── Driver Health ────────────────────────────────────────── */}
      <AdminSection title="Driver health" description="Production drivers, the agencies each covers, and recent failures by family">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Portal family</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Sources</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Opportunities</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Last completed</TableHead>
              <TableHead className="text-right">Recent fails</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.families.map((f) => (
              <TableRow key={f.portalType}>
                <TableCell className="font-medium">{f.portalType}</TableCell>
                <TableCell className="text-xs">{f.driver?.driver_name ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{f.driver?.driver_mode ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{f.sourceCount}</TableCell>
                <TableCell className="text-right tabular-nums">{f.enabledCount}</TableCell>
                <TableCell className="text-right tabular-nums">{f.candidateCount.toLocaleString()}</TableCell>
                <TableCell>
                  <span className="flex gap-1 flex-wrap">
                    {f.healthCounts.failed > 0 && <Badge variant="secondary" className="bg-red-100 text-red-800">{f.healthCounts.failed} failed</Badge>}
                    {f.healthCounts.warning > 0 && <Badge variant="secondary" className="bg-amber-100 text-amber-800">{f.healthCounts.warning} stale</Badge>}
                    {f.healthCounts.failed === 0 && f.healthCounts.warning === 0 && <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">ok</Badge>}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{timeAgo(f.lastCompletedAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{f.recentFailures || "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AdminSection>

      {/* ── Expansion Progress ───────────────────────────────────── */}
      <AdminSection
        title="Expansion progress"
        description="Source-derived today; upgrades to registry-backed agency coverage when Procurement Atlas Phase 0 lands"
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Configured" value={data.totalSources} />
          <StatCard label="In production" value={data.enabledSources} tone="good" />
          <StatCard label="Pending validation" value={data.disabledSources} hint="seeded scan_enabled=false" />
          <StatCard
            label="CA strategy target"
            value={`${Math.round((data.totalSources / CA_TARGET_SOURCES) * 100)}%`}
            hint={`${data.totalSources} of ~${CA_TARGET_SOURCES} sources (Waves 0–3)`}
          />
        </div>
        <div>
          <div className="h-2.5 rounded bg-muted overflow-hidden">
            <div
              className="h-full rounded bg-[hsl(var(--bidbox-blue))]"
              style={{ width: `${Math.min(100, (data.totalSources / CA_TARGET_SOURCES) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Progress toward the California expansion strategy target (~{CA_TARGET_SOURCES} sources across Waves 0–3).
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Known unsupported family</TableHead>
              <TableHead>Estimated unlock</TableHead>
              <TableHead>Path</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {KNOWN_UNSUPPORTED.map((k) => (
              <TableRow key={k.family}>
                <TableCell className="font-medium">{k.family}</TableCell>
                <TableCell className="text-muted-foreground">{k.estimate}</TableCell>
                <TableCell><Badge variant="outline">{k.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="text-xs text-muted-foreground">
          Estimates from the 2026-07 California expansion strategy; the Atlas registry replaces these with verified counts.
        </p>
      </AdminSection>

      {/* ── Operations ───────────────────────────────────────────── */}
      <AdminSection title="Operations" description="Background queue, recent activity, and failures across all agent task types">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Queue: pending" value={data.queueCounts.pending} />
          <StatCard label="Running" value={data.queueCounts.running} tone={data.queueCounts.running > 0 ? "good" : "default"} />
          <StatCard label="Retrying" value={data.queueCounts.retrying} tone={data.queueCounts.retrying > 0 ? "warn" : "default"} />
          <StatCard label="Failed (24h)" value={data.queueCounts.failed24h} tone={data.queueCounts.failed24h > 0 ? "bad" : "default"} />
          <StatCard
            label="Avg scan duration"
            value={data.avgScanDurationMin !== null ? `${data.avgScanDurationMin.toFixed(1)}m` : "—"}
            hint="last 50 completed scans"
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-2">Recent tasks</h3>
            <div className="space-y-1.5 max-h-80 overflow-auto pr-1">
              {data.recentTasks.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-mono text-xs" title={t.task_type}>{t.task_type}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <Badge variant="secondary" className={STATUS_BADGE[t.status] ?? ""}>{t.status}</Badge>
                    <span className="text-xs text-muted-foreground w-16 text-right">{timeAgo(t.created_at)}</span>
                  </span>
                </div>
              ))}
              {data.recentTasks.length === 0 && <p className="text-sm text-muted-foreground">No recent tasks.</p>}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2">Recent failures</h3>
            <div className="space-y-2 max-h-80 overflow-auto pr-1">
              {data.recentFailures.map((t) => (
                <div key={t.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs">{t.task_type}</span>
                    <span className="text-xs text-muted-foreground">{timeAgo(t.created_at)}</span>
                  </div>
                  <p className="text-xs text-destructive/80 truncate" title={t.error ?? ""}>{t.error ?? "No error recorded"}</p>
                </div>
              ))}
              {data.recentFailures.length === 0 && (
                <p className="text-sm text-muted-foreground">No recent task failures.</p>
              )}
            </div>
          </div>
        </div>
      </AdminSection>
    </div>
  );
};

const AdminCoverage = () => (
  <Layout showSidebar>
    <AdminGuard>
      <AdminCoverageContent />
    </AdminGuard>
  </Layout>
);

export default AdminCoverage;
