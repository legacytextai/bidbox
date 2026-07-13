import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type QualificationJobStatus = "queued" | "running" | "complete" | "failed" | "superseded";

export type QualificationJob = Tables<"qualification_jobs"> & { status: QualificationJobStatus };

export function useQualificationJob(userId?: string | null) {
  const [job, setJob] = useState<QualificationJob | null>(null);
  const [hasBidProfile, setHasBidProfile] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) {
      setJob(null);
      setHasBidProfile(false);
      setLoading(false);
      return;
    }
    const [{ data: profile }, { data: latestJob }] = await Promise.all([
      supabase.from("gc_qualification_profiles").select("id").eq("profile_id", userId).maybeSingle(),
      supabase.from("qualification_jobs").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    setHasBidProfile(Boolean(profile));
    setJob((latestJob as QualificationJob | null) ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase.channel(`qualification-job-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "qualification_jobs", filter: `user_id=eq.${userId}` }, () => void refresh())
      .subscribe();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const retry = useCallback(async () => {
    const { data, error } = await supabase.rpc("queue_qualification_rebuild", { p_bid_profile_id: job?.bid_profile_id ?? null });
    if (error) throw error;
    await refresh();
    return data as QualificationJob;
  }, [job?.bid_profile_id, refresh]);

  return {
    job,
    hasBidProfile,
    loading,
    refresh,
    retry,
    isUpdating: job?.status === "queued" || job?.status === "running",
  };
}
