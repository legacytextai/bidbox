// useProjectReadiness — hook backing the Bid Readiness tab.
//
// Responsibilities:
// 1. Load any persisted `project_readiness_items` rows for the project.
// 2. Compose them with the readiness catalog and current intelligence
//    findings to produce a typed `ReadinessItemView[]`.
// 3. Provide mutators (manual status, notes) that upsert by (project_id, key).

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import type { DossierFinding } from "@/hooks/useOpportunityDossier";
import {
  composeReadinessView,
  READINESS_CATALOG,
  summarizeReadiness,
  type ManualStatus,
  type ReadinessItemRow,
  type ReadinessItemView,
  type ReadinessSummary,
} from "@/lib/bidReadiness";

interface UseProjectReadinessResult {
  loading: boolean;
  items: ReadinessItemView[];
  summary: ReadinessSummary;
  setManualStatus: (key: string, status: ManualStatus) => Promise<void>;
  setNotes: (key: string, notes: string) => Promise<void>;
  reload: () => void;
}

export function useProjectReadiness(
  projectId: string,
  findings: DossierFinding[],
): UseProjectReadinessResult {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReadinessItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("project_readiness_items")
        .select("*")
        .eq("project_id", projectId);
      if (cancelled) return;
      if (error) {
        console.error("[useProjectReadiness] load failed", error);
        setRows([]);
      } else {
        setRows((data ?? []) as unknown as ReadinessItemRow[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadToken]);

  const items = useMemo<ReadinessItemView[]>(() => {
    const byKey = new Map<string, ReadinessItemRow>();
    for (const r of rows) byKey.set(r.key, r);
    return READINESS_CATALOG.map((def) =>
      composeReadinessView(def, findings, byKey.get(def.key) ?? null),
    );
  }, [rows, findings]);

  const summary = useMemo(() => summarizeReadiness(items), [items]);

  const upsert = useCallback(
    async (key: string, patch: Partial<Pick<ReadinessItemRow, "manual_status" | "notes">>) => {
      const view = items.find((i) => i.def.key === key);
      const derived_status = view?.derived ?? "unknown";

      const payload = {
        project_id: projectId,
        key,
        derived_status,
        manual_status: patch.manual_status ?? view?.manual ?? "unset",
        notes: patch.notes ?? view?.notes ?? null,
      };

      // Optimistic local update.
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.key === key);
        const next: ReadinessItemRow = {
          id: idx >= 0 ? prev[idx].id : `tmp-${key}`,
          project_id: projectId,
          key,
          derived_status,
          manual_status: payload.manual_status,
          notes: payload.notes,
          derived_source: null,
          updated_at: new Date().toISOString(),
        };
        if (idx >= 0) {
          const copy = prev.slice();
          copy[idx] = next;
          return copy;
        }
        return [...prev, next];
      });

      const { error } = await supabase
        .from("project_readiness_items")
        .upsert(payload, { onConflict: "project_id,key" });

      if (error) {
        console.error("[useProjectReadiness] upsert failed", error);
        toast({
          title: "Could not save readiness change",
          description: error.message,
          variant: "destructive",
        });
        setReloadToken((t) => t + 1);
      }
    },
    [items, projectId, toast],
  );

  const setManualStatus = useCallback(
    (key: string, status: ManualStatus) => upsert(key, { manual_status: status }),
    [upsert],
  );

  const setNotes = useCallback(
    (key: string, notes: string) => upsert(key, { notes }),
    [upsert],
  );

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  return { loading, items, summary, setManualStatus, setNotes, reload };
}
