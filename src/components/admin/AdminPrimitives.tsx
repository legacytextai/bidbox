import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SourceHealth } from "@/hooks/useAdminCoverage";

/**
 * Shared primitives for internal admin dashboards. Every future admin page
 * (Source Health drill-down, Scan Queue, Worker Health, ...) composes these
 * so the section acquires a consistent look without per-page styling.
 */

export const StatCard = ({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) => {
  const toneClass =
    tone === "good" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad" ? "text-destructive" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
};

export const AdminSection = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="text-lg">{title}</CardTitle>
      {description && <CardDescription>{description}</CardDescription>}
    </CardHeader>
    <CardContent className="space-y-4">{children}</CardContent>
  </Card>
);

const HEALTH_STYLES: Record<SourceHealth, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  warning: { label: "Stale", className: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 hover:bg-red-100" },
  never: { label: "Never scanned", className: "bg-slate-100 text-slate-700 hover:bg-slate-100" },
  disabled: { label: "Disabled", className: "bg-slate-100 text-slate-500 hover:bg-slate-100" },
};

export const HealthPill = ({ health }: { health: SourceHealth }) => {
  const s = HEALTH_STYLES[health];
  return <Badge variant="secondary" className={s.className}>{s.label}</Badge>;
};

export const BarList = ({
  items,
  maxItems = 12,
}: {
  items: { label: string; count: number; sub?: string }[];
  maxItems?: number;
}) => {
  const shown = items.slice(0, maxItems);
  const max = Math.max(1, ...shown.map((i) => i.count));
  return (
    <div className="space-y-1.5">
      {shown.map((i) => (
        <div key={i.label} className="flex items-center gap-3 text-sm">
          <span className="w-44 shrink-0 truncate" title={i.label}>{i.label}</span>
          <div className="flex-1 h-2.5 rounded bg-muted overflow-hidden">
            <div
              className="h-full rounded bg-[hsl(var(--bidbox-blue))]"
              style={{ width: `${Math.max(2, (i.count / max) * 100)}%` }}
            />
          </div>
          <span className="w-14 shrink-0 text-right tabular-nums font-medium">{i.count}</span>
          {i.sub && <span className="w-24 shrink-0 text-xs text-muted-foreground text-right">{i.sub}</span>}
        </div>
      ))}
      {shown.length === 0 && <p className="text-sm text-muted-foreground">No data yet.</p>}
    </div>
  );
};

// timeAgo lives in @/lib/adminFormat (non-component exports break fast refresh).
