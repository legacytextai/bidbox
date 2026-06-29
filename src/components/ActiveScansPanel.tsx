import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Clock, X, ChevronDown, ChevronRight } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TaskStatus = "pending" | "running" | "complete" | "failed" | "retrying";

interface ScanTask {
  id: string;
  source_name: string;
  portal_type: string;
  status: TaskStatus;
  error: string | null;
}

interface Props {
  taskIds: string[];
  onDismiss: () => void;
  isQueuing?: boolean;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Queued",
  running: "Scanning…",
  retrying: "Retrying…",
  complete: "Complete",
  failed: "Failed",
};

// Pretty label for known portals; fallback derives one from the slug so new
// drivers automatically render with a readable name and no UI change.
const PORTAL_LABEL_OVERRIDES: Record<string, string> = {
  planetbids: "PlanetBids",
  caltrans: "Caltrans",
};

function portalLabel(portalType: string): string {
  if (!portalType) return "Other";
  if (PORTAL_LABEL_OVERRIDES[portalType]) return PORTAL_LABEL_OVERRIDES[portalType];
  return portalType
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "complete":
      return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "running":
    case "retrying":
      return <Loader2 className="h-4 w-4 text-[hsl(var(--bidbox-blue))] animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function ActiveScansPanel({ taskIds, onDismiss, isQueuing = false }: Props) {
  const [tasks, setTasks] = useState<ScanTask[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Initial fetch
  useEffect(() => {
    if (taskIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("id, status, error, payload, task_type")
        .in("id", taskIds);
      if (cancelled || error || !data) return;
      setTasks(
        data.map((t: any) => ({
          id: t.id,
          status: t.status as TaskStatus,
          error: t.error ?? null,
          source_name: t.payload?.source_name ?? "Unknown source",
          portal_type:
            t.payload?.portal_type ??
            (typeof t.task_type === "string" ? t.task_type.replace(/_scan$/, "") : ""),
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [taskIds]);

  // Realtime updates
  useEffect(() => {
    if (taskIds.length === 0) return;
    const idSet = new Set(taskIds);
    const channel = supabase
      .channel(`active-scans-${taskIds[0]}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "agent_tasks" },
        (payload) => {
          const row: any = payload.new;
          if (!idSet.has(row.id)) return;
          setTasks((prev) =>
            prev.map((t) =>
              t.id === row.id
                ? { ...t, status: row.status as TaskStatus, error: row.error ?? null }
                : t,
            ),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [taskIds]);

  const { completed, total, percent, allDone } = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(
      (t) => t.status === "complete" || t.status === "failed",
    ).length;
    const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
    return { completed, total, percent, allDone: total > 0 && completed === total };
  }, [tasks]);

  // Group tasks by portal so each driver renders in its own section. Future
  // drivers appear automatically — no UI change required.
  const groups = useMemo(() => {
    const byPortal = new Map<string, ScanTask[]>();
    for (const t of tasks) {
      const key = t.portal_type || "other";
      if (!byPortal.has(key)) byPortal.set(key, []);
      byPortal.get(key)!.push(t);
    }
    const rank = (s: TaskStatus) =>
      s === "running" || s === "retrying" ? 0 : s === "pending" ? 1 : 2;
    return Array.from(byPortal.entries())
      .map(([portal, items]) => ({
        portal,
        label: portalLabel(portal),
        items: items.slice().sort((a, b) => rank(a.status) - rank(b.status)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  // Auto-dismiss when done (but not while still queuing)
  useEffect(() => {
    if (!allDone || isQueuing) return;
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [allDone, isQueuing, onDismiss]);

  if (taskIds.length === 0 && !isQueuing) return null;

  return (
    <div className="bg-card border border-border rounded-lg px-4 py-2 mb-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
          {allDone && !isQueuing ? (
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          ) : (
            <Loader2 className="h-4 w-4 text-[hsl(var(--bidbox-blue))] animate-spin shrink-0" />
          )}
          <span className="text-sm font-semibold text-foreground shrink-0">
            {total === 0 && isQueuing
              ? "Scanning… queuing sources"
              : allDone && !isQueuing
              ? `Scan Complete — ${total} sources`
              : `Scanning… ${Math.min(completed + 1, total)} / ${total}`}
          </span>
          <Progress value={percent} className="h-1.5 flex-1 ml-2" />
        </button>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 px-2 shrink-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {expanded && (
      <div className="max-h-48 overflow-y-auto space-y-3 mt-3">

        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queuing tasks…</p>
        ) : (
          groups.map((group) => (
            <div key={group.portal}>
              <div className="flex items-center gap-2 px-2 py-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {group.items.length} {group.items.length === 1 ? "source" : "sources"}
                </span>
              </div>
              <div className="space-y-1.5">
                {group.items.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusIcon status={t.status} />
                      <span className="truncate text-foreground">{t.source_name}</span>
                    </div>
                    {t.status === "failed" && t.error ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs font-medium text-red-600 cursor-help">
                            {STATUS_LABEL[t.status]}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">{t.error}</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span
                        className={`text-xs font-medium ${
                          t.status === "complete"
                            ? "text-green-600"
                            : t.status === "running" || t.status === "retrying"
                            ? "text-[hsl(var(--bidbox-blue))]"
                            : "text-muted-foreground"
                        }`}
                      >
                        {STATUS_LABEL[t.status]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
