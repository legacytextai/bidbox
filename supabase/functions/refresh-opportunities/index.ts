import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-refresh-secret",
};

type TaskType = "planetbids_scan" | "caltrans_scan";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function refreshWindow(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function resolveTaskType(portalType: string): TaskType | null {
  if (portalType === "planetbids") return "planetbids_scan";
  if (portalType === "caltrans") return "caltrans_scan";
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const configuredSecret = Deno.env.get("OPPORTUNITY_REFRESH_SECRET");
    if (configuredSecret) {
      const providedSecret = req.headers.get("x-refresh-secret");
      if (providedSecret !== configuredSecret) {
        return jsonResponse({ success: false, error: "Unauthorized" }, 401);
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const triggerReason = body?.trigger_reason ?? "scheduled_refresh";
    const now = new Date();
    const window = body?.refresh_window ?? refreshWindow(now);
    const force = Boolean(body?.force);

    const { data: sources, error: sourcesError } = await supabase
      .from("opportunity_sources")
      .select("id, name, portal_type, listing_url, scan_interval_hours, refresh_cadence_hours, last_refresh_completed_at, last_refresh_queued_at")
      .eq("scan_enabled", true)
      .eq("refresh_enabled", true);

    if (sourcesError) {
      console.error("refresh-opportunities source lookup failed:", sourcesError);
      return jsonResponse({ success: false, error: "Failed to query sources" }, 500);
    }

    const eligible = (sources ?? []).filter((source: any) => {
      if (!resolveTaskType(source.portal_type)) return false;
      if (force) return true;
      const cadenceHours = Number(source.refresh_cadence_hours ?? source.scan_interval_hours ?? 24);
      const last = source.last_refresh_completed_at ?? source.last_refresh_queued_at;
      if (!last) return true;
      const ageMs = now.getTime() - new Date(last).getTime();
      return ageMs >= cadenceHours * 60 * 60 * 1000;
    });

    if (eligible.length === 0) {
      return jsonResponse({
        success: true,
        trigger_reason: triggerReason,
        refresh_window: window,
        sources_considered: sources?.length ?? 0,
        sources_queued: 0,
        queued_task_ids: [],
        message: "No eligible opportunity sources due for refresh",
      });
    }

    const { data: activeTasks, error: activeTaskError } = await supabase
      .from("agent_tasks")
      .select("id, task_type, status, payload")
      .in("status", ["pending", "running", "retrying"])
      .in("task_type", ["planetbids_scan", "caltrans_scan"]);

    if (activeTaskError) {
      console.error("refresh-opportunities active task lookup failed:", activeTaskError);
      return jsonResponse({ success: false, error: "Failed to check active scan tasks" }, 500);
    }

    const activeSourceIds = new Set((activeTasks ?? []).map((task: any) => task.payload?.source_id).filter(Boolean));
    const rows = eligible
      .filter((source: any) => !activeSourceIds.has(source.id))
      .map((source: any) => ({
        task_type: resolveTaskType(source.portal_type),
        status: "pending",
        priority: 0,
        trigger_reason: triggerReason,
        refresh_window: window,
        payload: {
          source_id: source.id,
          source_name: source.name,
          listing_url: source.listing_url,
          portal_type: source.portal_type,
          trigger_reason: triggerReason,
          refresh_window: window,
        },
      }));

    if (rows.length === 0) {
      return jsonResponse({
        success: true,
        trigger_reason: triggerReason,
        refresh_window: window,
        sources_considered: sources?.length ?? 0,
        sources_due: eligible.length,
        sources_queued: 0,
        queued_task_ids: [],
        message: "Eligible sources already have active refresh tasks",
      });
    }

    const { data: tasks, error: insertError } = await supabase
      .from("agent_tasks")
      .insert(rows)
      .select("id, payload");

    if (insertError) {
      console.error("refresh-opportunities task insert failed:", insertError);
      return jsonResponse({ success: false, error: "Failed to queue refresh tasks" }, 500);
    }

    const queuedSourceIds = (tasks ?? []).map((task: any) => task.payload?.source_id).filter(Boolean);
    if (queuedSourceIds.length > 0) {
      await supabase
        .from("opportunity_sources")
        .update({
          last_refresh_queued_at: now.toISOString(),
          last_refresh_status: "queued",
          last_refresh_error: null,
        })
        .in("id", queuedSourceIds);
    }

    return jsonResponse({
      success: true,
      trigger_reason: triggerReason,
      refresh_window: window,
      sources_considered: sources?.length ?? 0,
      sources_due: eligible.length,
      sources_queued: tasks?.length ?? 0,
      queued_task_ids: (tasks ?? []).map((task: any) => task.id),
    });
  } catch (error) {
    console.error("refresh-opportunities error:", error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
