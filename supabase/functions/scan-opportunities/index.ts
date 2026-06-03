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
}

async function scanSource(
  source: OpportunitySource,
  supabase: ReturnType<typeof createClient>,
  firecrawlApiKey: string,
  lovableApiKey: string,
  authHeader: string,
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
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors: 1, queued: 0 };
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

  // PlanetBids sources are handled by the Railway worker via agent_tasks queue
  if (source.portal_type === 'planetbids') {
    const { error: queueError } = await supabase
      .from('agent_tasks')
      .insert({
        task_type: 'planetbids_scan',
        status: 'pending',
        priority: 0,
        payload: {
          source_id: source.id,
          source_name: source.name,
          listing_url: source.listing_url,
          portal_type: source.portal_type,
        },
      });

    if (queueError) {
      log(`[${source.name}] Failed to queue PlanetBids task: ${queueError.message}`);
      await finishRun();
      return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors: 1, queued: 0 };
    }

    log(`[${source.name}] PlanetBids task queued → agent_tasks`);
    await finishRun();
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors: 0, queued: 1 };
  }

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
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors, queued: 0 };
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
        log(`[${source.name}] Already known: ${candidate.source_url}`);
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

  if (authHeader) {
    try {
      const qualifyUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/qualify-candidates`;
      const qualifyRes = await fetch(qualifyUrl, {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (qualifyRes.ok) {
        const q = await qualifyRes.json();
        console.log(`[${source.name}] qualify-candidates: evaluated=${q.evaluated} green=${q.auto_green} yellow=${q.auto_yellow} red=${q.auto_red}`);
      } else {
        console.warn(`[${source.name}] qualify-candidates returned ${qualifyRes.status}`);
      }
    } catch (e) {
      console.warn(`[${source.name}] qualify-candidates error: ${e}`);
    }
  }

  return { source_id: source.id, source_name: source.name, found: candidatesFound, new: candidatesNew, errors, queued: 0 };
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

    if (!firecrawlApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "FIRECRAWL_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let sourceIdFilter: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        sourceIdFilter = body?.source_id ?? null;
      } catch {
        // No body or non-JSON — scan all
      }
    }

    let query = supabase
      .from("opportunity_sources")
      .select("id, name, portal_type, listing_url, scan_interval_hours")
      .eq("scan_enabled", true);

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
        JSON.stringify({ success: true, sources_scanned: 0, message: "No sources due for scanning" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`Scanning ${sources.length} source(s)`);

    const runs: SourceRunResult[] = [];
    for (const source of sources as OpportunitySource[]) {
      const result = await scanSource(source, supabase, firecrawlApiKey, lovableApiKey, authHeader);
      runs.push(result);
      if (sources.indexOf(source) < sources.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const totalFound = runs.reduce((s, r) => s + r.found, 0);
    const totalNew = runs.reduce((s, r) => s + r.new, 0);
    const totalErrors = runs.reduce((s, r) => s + r.errors, 0);
    const totalQueued = runs.reduce((s, r) => s + r.queued, 0);

    return new Response(
      JSON.stringify({
        success: true,
        sources_scanned: runs.length,
        total_candidates_found: totalFound,
        total_candidates_new: totalNew,
        total_errors: totalErrors,
        total_queued: totalQueued,
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
