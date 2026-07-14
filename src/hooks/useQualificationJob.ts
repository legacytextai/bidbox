import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { isJobForCurrentProfileVersion, isQualificationUpdating } from "@/lib/qualificationJobState";

export type QualificationJobStatus = "queued" | "running" | "complete" | "failed" | "superseded";

export type QualificationJob = Tables<"qualification_jobs"> & { status: QualificationJobStatus };

export function useQualificationJob(userId?: string | null) {
  const [job, setJob] = useState<QualificationJob | null>(null);
  const [hasBidProfile, setHasBidProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const retryInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    if (!userId) {
      setJob(null);
      setHasBidProfile(false);
      setLoading(false);
      setError(null);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("gc_qualification_profiles")
      .select("id, profile_version")
      .eq("profile_id", userId)
      .maybeSingle();
    if (sequence !== refreshSequence.current) return;
    if (profileError) {
      setError(profileError.message);
      setLoading(false);
      return;
    }

    let latestJob: QualificationJob | null = null;
    if (profile) {
      const { data, error: jobError } = await supabase
        .from("qualification_jobs")
        .select("*")
        .eq("user_id", userId)
        .eq("bid_profile_id", profile.id)
        .eq("profile_version", profile.profile_version)
        .order("updated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sequence !== refreshSequence.current) return;
      if (jobError) {
        setError(jobError.message);
        setLoading(false);
        return;
      }
      if (isJobForCurrentProfileVersion(profile, data as QualificationJob | null)) {
        latestJob = data as QualificationJob;
      }
    }

    setHasBidProfile(Boolean(profile));
    setJob(latestJob);
    setError(null);
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
      refreshSequence.current += 1;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [refresh, userId]);

  const retry = useCallback(async () => {
    if (retryInFlight.current) return null;
    retryInFlight.current = true;
    try {
      const { data, error } = await supabase.rpc("queue_qualification_rebuild", { p_bid_profile_id: job?.bid_profile_id ?? null });
      if (error) throw error;
      await refresh();
      return data as QualificationJob;
    } finally {
      retryInFlight.current = false;
    }
  }, [job?.bid_profile_id, refresh]);

  return {
    job,
    hasBidProfile,
    loading,
    error,
    refresh,
    retry,
    isUpdating: isQualificationUpdating(job?.status),
  };
}
