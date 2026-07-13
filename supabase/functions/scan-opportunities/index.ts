import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { OpportunitySource } from "../_shared/opportunity_driver.ts";
import { runDriver } from "../_shared/driver_router.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SourceRunResult {
  source_id: string;
  source_name: string;
  found: number;
  new: number;
  errors: number;
  queued: number;
  task_id: string | null;
  task_status: string | null;
  task_created_at: string | null;
  queue_state: "queued" | "already_queued" | "not_queued";
}

function refreshWindow(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

async function queueWorkerScanSources(
  sources: OpportunitySource[],
  supabase: ReturnType<typeof createClient>,
  taskType: "planetbids_scan" | "caltrans_scan" | "lacounty_dpw_scan" | "lacmta_scan" | "caleprocure_scan" | "opengov_scan",
  label: string,
  triggerReason: string,
  window: string,
): Promise<SourceRunResult[]> {
  if (sources.length === 0) return [];

  const sourceIds = new Set(sources.map((source) => source.id));

  const { data: activeTasks, error: activeTaskError } = await supabase
    .from("agent_tasks")
    .select("id, status, created_at, payload")
    .eq("task_type", taskType)
    .in("status", ["pending", "running", "retrying"])
    .order("created_at", { ascending: false });

  if (activeTaskError) {
    console.error(`Failed to check active ${label} tasks: ${activeTaskError.message}`);
    return sources.map((source): SourceRunResult => ({
      source_id: source.id,
      source_name: source.name,
      found: 0,
      new: 0,
      errors: 1,
      queued: 0,
      task_id: null,
      task_status: null,
      task_created_at: null,
      queue_state: "not_queued",
    }));
  }

  const activeBySourceId = new Map<string, { id: string; status: string; created_at: string }>();
  for (const task of activeTasks ?? []) {
    const sourceId = task.payload?.source_id;
    if (sourceIds.has(sourceId) && !activeBySourceId.has(sourceId)) {
      activeBySourceId.set(sourceId, {
        id: task.id,
        status: task.status,
        created_at: task.created_at,
      });
    }
  }

  const sourcesToQueue = sources.filter((source) => !activeBySourceId.has(source.id));
  const insertedBySourceId = new Map<string, { id: string; status: string; created_at: string }>();
  let insertErrorMessage: string | null = null;

  if (sourcesToQueue.length > 0) {
    const rows = sourcesToQueue.map((source) => ({
      task_type: taskType,
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

    const { data: queuedTasks, error: queueError } = await supabase
      .from("agent_tasks")
      .insert(rows)
      .select("id, status, created_at, payload");

    if (queueError) {
      insertErrorMessage = queueError.message;
      console.error(`Failed to bulk queue ${label} tasks: ${queueError.message}`);
    } else {
      for (const task of queuedTasks ?? []) {
        const sourceId = task.payload?.source_id;
        if (sourceIds.has(sourceId)) {
          insertedBySourceId.set(sourceId, {
            id: task.id,
            status: task.status,
            created_at: task.created_at,
          });
        }
      }
    }

    if (insertedBySourceId.size > 0) {
      await supabase
        .from("opportunity_sources")
        .update({
          last_refresh_queued_at: new Date().toISOString(),
          last_refresh_status: "queued",
          last_refresh_error: null,
        })
        .in("id", Array.from(insertedBySourceId.keys()));
    }
  }

  return sources.map((source): SourceRunResult => {
    const activeTask = activeBySourceId.get(source.id);
    if (activeTask) {
      return {
        source_id: source.id,
        source_name: source.name,
        found: 0,
        new: 0,
        errors: 0,
        queued: 1,
        task_id: activeTask.id,
        task_status: activeTask.status,
        task_created_at: activeTask.created_at,
        queue_state: "already_queued",
      };
    }

    const insertedTask = insertedBySourceId.get(source.id);
    if (insertedTask) {
      return {
        source_id: source.id,
        source_name: source.name,
        found: 0,
        new: 0,
        errors: 0,
        queued: 1,
        task_id: insertedTask.id,
        task_status: insertedTask.status,
        task_created_at: insertedTask.created_at,
        queue_state: "queued",
      };
    }

    return {
      source_id: source.id,
      source_name: source.name,
      found: 0,
      new: 0,
      errors: insertErrorMessage ? 1 : 0,
      queued: 0,
      task_id: null,
      task_status: null,
      task_created_at: null,
      queue_state: "not_queued",
    };
  });
}

async function scanSource(
  source: OpportunitySource,
  supabase: ReturnType<typeof createClient>,
  firecrawlApiKey: string,
  lovableApiKey: string,
): Promise<SourceRunResult> {
  const logLines: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logLines.push(msg);
  };

  let candidatesFound = 0;
  let candidatesNew = 0;
  let errors = 0;

  // Insert agent_run row
  const { data: runRow, error: runInsertError } = await supabase
    .from("agent_runs")
    .insert({ source_id: source.id, started_at: new Date().toISOString() })
    .select("id")
    .single();

  if (runInsertError || !runRow) {
    console.error(`Failed to create agent_run for source ${source.id}:`, runInsertError);
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors: 1, queued: 0, task_id: null, task_status: null, task_created_at: null, queue_state: "not_queued" };
  }

  const runId: string = runRow.id;
  log(`[${source.name}] agent_run ${runId} started`);

  const finishRun = async () => {
    await supabase
      .from("agent_runs")
      .update({
        completed_at: new Date().toISOString(),
        candidates_found: candidatesFound,
        candidates_new: candidatesNew,
        errors,
        raw_log: logLines.join("\n"),
      })
      .eq("id", runId);
  };

  // Dispatch to the appropriate driver based on portal_type
  const { candidates, errors: driverErrors } = await runDriver(source, {
    supabase,
    firecrawlApiKey,
    lovableApiKey,
    log,
  });

  errors += driverErrors;

  if (driverErrors > 0 && candidates.length === 0) {
    await finishRun();
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors, queued: 0, task_id: null, task_status: null, task_created_at: null, queue_state: "not_queued" };
  }

  // Upsert returned candidates
  for (const candidate of candidates) {
    candidatesFound++;

    const { error: insertError } = await supabase
      .from("opportunity_candidates")
      .insert({
        source_id: source.id,
        source_url: candidate.source_url,
        portal_type: source.portal_type,
        raw_title: candidate.raw_title,
        agency: source.name,
        bid_due_at: candidate.bid_due_at,
        crawl_data: candidate.crawl_data ?? null,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: existing } = await supabase
          .from("opportunity_candidates")
          .select("id, metadata_refresh_count")
          .eq("source_url", candidate.source_url)
          .maybeSingle();
        if (existing?.id) {
          await supabase
            .from("opportunity_candidates")
            .update({
              source_id: source.id,
              portal_type: source.portal_type,
              raw_title: candidate.raw_title,
              agency: source.name,
              bid_due_at: candidate.bid_due_at,
              crawl_data: candidate.crawl_data ?? null,
              last_metadata_refreshed_at: new Date().toISOString(),
              last_metadata_changed_at: new Date().toISOString(),
              metadata_refresh_count: Number(existing.metadata_refresh_count ?? 0) + 1,
              metadata_refresh_source: "scan",
              metadata_refresh_trigger: "manual_refresh",
            })
            .eq("id", existing.id);
          log(`[${source.name}] Refreshed existing candidate: ${candidate.source_url}`);
        } else {
          log(`[${source.name}] Already known: ${candidate.source_url}`);
        }
      } else {
        log(`[${source.name}] Insert error for ${candidate.source_url}: ${insertError.message}`);
        errors++;
      }
    } else {
      candidatesNew++;
      log(`[${source.name}] New candidate: ${candidate.raw_title}`);
    }
  }

  // Update source last_scanned_at
  await supabase
    .from("opportunity_sources")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("id", source.id);

  log(`[${source.name}] Done. found=${candidatesFound} new=${candidatesNew} errors=${errors}`);
  await finishRun();

  return { source_id: source.id, source_name: source.name, found: candidatesFound, new: candidatesNew, errors, queued: 0, task_id: null, task_status: null, task_created_at: null, queue_state: "not_queued" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let sourceIdFilter: string | null = null;
    let triggerReason = "manual_refresh";
    const window = refreshWindow();
    if (req.method === "POST") {
      try {
        const body = await req.json();
        sourceIdFilter = body?.source_id ?? null;
        triggerReason = body?.trigger_reason ?? triggerReason;
      } catch {
        // No body or non-JSON — scan all
      }
    }

    let query = supabase
      .from("opportunity_sources")
      .select("id, name, portal_type, listing_url, scan_interval_hours")
      .eq("scan_enabled", true)
      .eq("refresh_enabled", true);

    if (sourceIdFilter) {
      query = query.eq("id", sourceIdFilter);
    } else {
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      query = query.or(`last_scanned_at.is.null,last_scanned_at.lt.${cutoff}`);
    }

    const { data: sources, error: sourcesError } = await query;

    if (sourcesError) {
      console.error("Failed to query opportunity_sources:", sourcesError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to query sources" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!sources || sources.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sources_scanned: 0,
          total_candidates_found: 0,
          total_candidates_new: 0,
          total_errors: 0,
          total_queued: 0,
          total_newly_queued: 0,
          total_already_queued: 0,
          queued_task_ids: [],
          queued_tasks: [],
          message: "No sources due for scanning",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Scanning ${sources.length} source(s)`);

    const allSources = sources as OpportunitySource[];
    const planetbidsSources = allSources.filter((source) => source.portal_type === "planetbids");
    const caltransSources = allSources.filter((source) => source.portal_type === "caltrans");
    const lacountyDpwSources = allSources.filter((source) => source.portal_type === "lacounty_dpw");
    const lacmtaSources = allSources.filter((source) => source.portal_type === "lacmta");
    const caleprocureSources = allSources.filter((source) => source.portal_type === "caleprocure");
    const opengovSources = allSources.filter((source) => source.portal_type === "opengov");
    const otherSources = allSources.filter((source) => !["planetbids", "caltrans", "lacounty_dpw", "lacmta", "caleprocure", "opengov"].includes(source.portal_type));

    const runs: SourceRunResult[] = [];
    if (planetbidsSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(planetbidsSources, supabase, "planetbids_scan", "PlanetBids", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (caltransSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(caltransSources, supabase, "caltrans_scan", "Caltrans", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (lacountyDpwSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(lacountyDpwSources, supabase, "lacounty_dpw_scan", "LA County DPW", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (lacmtaSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(lacmtaSources, supabase, "lacmta_scan", "LA Metro", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (caleprocureSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(caleprocureSources, supabase, "caleprocure_scan", "Cal eProcure", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (opengovSources.length > 0) {
      const queuedRuns = await queueWorkerScanSources(opengovSources, supabase, "opengov_scan", "OpenGov", triggerReason, window);
      runs.push(...queuedRuns);
    }

    if (otherSources.length > 0 && !firecrawlApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (otherSources.length > 0 && !lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const skippedNonPlanetBids = otherSources.length > 30;
    const sourcesToScan = skippedNonPlanetBids ? [] : otherSources;

    for (const [index, source] of sourcesToScan.entries()) {
      const result = await scanSource(source, supabase, firecrawlApiKey!, lovableApiKey!);
      runs.push(result);
      if (index < sourcesToScan.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const totalFound = runs.reduce((s, r) => s + r.found, 0);
    const totalNew = runs.reduce((s, r) => s + r.new, 0);
    const totalErrors = runs.reduce((s, r) => s + r.errors, 0);
    const totalQueued = runs.reduce((s, r) => s + r.queued, 0);
    const queuedTasks = runs
      .filter((r) => r.task_id)
      .map((r) => ({
        task_id: r.task_id,
        source_id: r.source_id,
        source_name: r.source_name,
        status: r.task_status,
        created_at: r.task_created_at,
        queue_state: r.queue_state,
      }));

    return new Response(
      JSON.stringify({
        success: true,
        sources_scanned: runs.length,
        total_candidates_found: totalFound,
        total_candidates_new: totalNew,
        total_errors: totalErrors,
        total_queued: totalQueued,
        total_newly_queued: runs.filter((r) => r.queue_state === "queued").length,
        total_already_queued: runs.filter((r) => r.queue_state === "already_queued").length,
        queued_task_ids: queuedTasks.map((t) => t.task_id),
        queued_tasks: queuedTasks,
        trigger_reason: triggerReason,
        refresh_window: window,
        partial: skippedNonPlanetBids,
        skipped_non_planetbids_sources: skippedNonPlanetBids ? otherSources.length : 0,
        runs,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("scan-opportunities error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
