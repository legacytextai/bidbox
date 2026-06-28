import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-refresh-secret",
};

type TaskType = "planetbids_scan" | "caltrans_scan";

// One-time backfill: queues Opportunity Intelligence for candidates that existed
// before the autonomous pipeline was deployed. Runs once per environment, gated by
// a sentinel row in agent_tasks. Future refreshes skip it entirely.
async function runOneTimeBackfillIfNeeded(supabase: any, requestedAt: string) {
  // Check sentinel — if it exists, backfill already ran.
  const { data: existing } = await supabase
    .from("agent_tasks")
    .select("id")
    .eq("task_type", "one_time_oi_backfill")
    .limit(1);

  if (existing && existing.length > 0) return { ran: false };

  const activeStatuses = ["pending", "running", "retrying"];

  // Load up to 200 candidates missing OI that are not converted or active.
  const { data: candidates, error } = await supabase
    .from("opportunity_candidates")
    .select("id, source_id, source_url, portal_type, agency, raw_title, bid_due_at")
    .is("converted_project_id", null)
    .not("opportunity_intelligence_status", "in", '("queued","processing","ready")')
    .not("analysis_status", "in", '("queued","analyzing")')
    .not("document_acquisition_status", "in", '("queued","acquiring")')
    .not("document_processing_status", "in", '("queued","processing")')
    .limit(200);

  if (error) {
    console.error("one_time_oi_backfill candidate query failed:", error.message);
    // Insert sentinel anyway so a transient error doesn't cause repeated attempts.
  }

  let queued = 0;
  let skipped = 0;

  if (candidates && candidates.length > 0) {
    // Bulk check active tasks to avoid duplicate work.
    const { data: activeTasks } = await supabase
      .from("agent_tasks")
      .select("payload")
      .in("status", activeStatuses)
      .in("task_type", ["project_analysis", "document_processing", "project_intelligence"]);

    const busyCandidateIds = new Set<string>(
      (activeTasks ?? []).map((t: any) => t.payload?.candidate_id).filter(Boolean),
    );

    for (const candidate of candidates) {
      if (busyCandidateIds.has(candidate.id)) { skipped++; continue; }

      const { data: task, error: taskError } = await supabase
        .from("agent_tasks")
        .insert({
          task_type: "project_analysis",
          status: "pending",
          priority: 2, // lower priority than normal refresh work
          trigger_reason: "one_time_backfill",
          refresh_window: requestedAt.slice(0, 13),
          payload: {
            candidate_id: candidate.id,
            source_id: candidate.source_id,
            source_name: candidate.agency ?? "Unknown source",
            source_url: candidate.source_url,
            portal_type: candidate.portal_type,
            agency: candidate.agency,
            raw_title: candidate.raw_title,
            bid_due_at: candidate.bid_due_at,
            requested_at: requestedAt,
            trigger_reason: "one_time_backfill",
            intelligence_tier: "opportunity",
            preparation_reason: "one_time_backfill",
            phase: "f2_metadata_refresh",
            next_phase: "f4_project_intelligence",
          },
        })
        .select("id")
        .single();

      if (taskError || !task) { skipped++; continue; }

      await supabase
        .from("opportunity_candidates")
        .update({
          analysis_task_id: task.id,
          analysis_requested_at: requestedAt,
          analysis_error: null,
          opportunity_lifecycle_status: "opportunity_intelligence_queued",
          opportunity_intelligence_status: "queued",
          opportunity_intelligence_task_id: task.id,
          opportunity_intelligence_error: null,
        })
        .eq("id", candidate.id);

      queued++;
    }
  }

  // Insert sentinel to prevent future runs.
  await supabase.from("agent_tasks").insert({
    task_type: "one_time_oi_backfill",
    status: "completed",
    priority: 0,
    trigger_reason: "one_time_backfill",
    refresh_window: requestedAt.slice(0, 13),
    payload: { queued, skipped, ran_at: requestedAt },
  });

  console.info(`one_time_oi_backfill complete: queued=${queued} skipped=${skipped}`);
  return { ran: true, queued, skipped };
}

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
      const backfill = await runOneTimeBackfillIfNeeded(supabase, now.toISOString());
      return jsonResponse({
        success: true,
        trigger_reason: triggerReason,
        refresh_window: window,
        sources_considered: sources?.length ?? 0,
        sources_queued: 0,
        queued_task_ids: [],
        message: "No eligible opportunity sources due for refresh",
        ...(backfill.ran ? { one_time_backfill: { queued: backfill.queued, skipped: backfill.skipped } } : {}),
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
      const backfill = await runOneTimeBackfillIfNeeded(supabase, now.toISOString());
      return jsonResponse({
        success: true,
        trigger_reason: triggerReason,
        refresh_window: window,
        sources_considered: sources?.length ?? 0,
        sources_due: eligible.length,
        sources_queued: 0,
        queued_task_ids: [],
        message: "Eligible sources already have active refresh tasks",
        ...(backfill.ran ? { one_time_backfill: { queued: backfill.queued, skipped: backfill.skipped } } : {}),
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

    // One-time backfill: runs once per environment during any scheduled or manual refresh.
    const backfill = await runOneTimeBackfillIfNeeded(supabase, now.toISOString());

    return jsonResponse({
      success: true,
      trigger_reason: triggerReason,
      refresh_window: window,
      sources_considered: sources?.length ?? 0,
      sources_due: eligible.length,
      sources_queued: tasks?.length ?? 0,
      queued_task_ids: (tasks ?? []).map((task: any) => task.id),
      ...(backfill.ran ? { one_time_backfill: { queued: backfill.queued, skipped: backfill.skipped } } : {}),
    });
  } catch (error) {
    console.error("refresh-opportunities error:", error);
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      500,
    );
  }
});
