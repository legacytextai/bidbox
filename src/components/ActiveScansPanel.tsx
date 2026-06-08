import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, Clock, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TaskStatus = "pending" | "running" | "complete" | "failed" | "retrying";

interface ScanTask {
  id: string;
  source_name: string;
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

  // Initial fetch
  useEffect(() => {
    if (taskIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("id, status, error, payload")
        .in("id", taskIds);
      if (cancelled || error || !data) return;
      setTasks(
        data.map((t: any) => ({
          id: t.id,
          status: t.status as TaskStatus,
          error: t.error ?? null,
          source_name: t.payload?.source_name ?? "Unknown source",
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

  // Auto-dismiss when done (but not while still queuing)
  useEffect(() => {
    if (!allDone || isQueuing) return;
    const t = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(t);
  }, [allDone, isQueuing, onDismiss]);

  if (taskIds.length === 0 && !isQueuing) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {allDone && !isQueuing ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : (
            <Loader2 className="h-5 w-5 text-[hsl(var(--bidbox-blue))] animate-spin" />
          )}
          <h2 className="font-semibold text-foreground">
            {total === 0 && isQueuing
              ? "Scanning… queuing sources"
              : allDone && !isQueuing
              ? `Scan Complete — ${total} sources scanned`
              : `Scanning… ${completed} / ${total}`}
          </h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="h-7 px-2">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Progress value={percent} className="h-2 mb-4" />

      <div className="max-h-64 overflow-y-auto space-y-1.5">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queuing tasks…</p>
        ) : (
          tasks
            .slice()
            .sort((a, b) => {
              const rank = (s: TaskStatus) =>
                s === "running" || s === "retrying" ? 0 : s === "pending" ? 1 : 2;
              return rank(a.status) - rank(b.status);
            })
            .map((t) => (
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
            ))
        )}
      </div>
    </div>
  );
}
