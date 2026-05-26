import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OpportunitySource {
  id: string;
  name: string;
  portal_type: string;
  listing_url: string;
  scan_interval_hours: number;
}

interface PlanetBidsOpportunity {
  title: string;
  invitation_number: string | null;
  bid_id: string | null;
  due_date: string | null;
}

interface GenericOpportunity {
  url: string;
  title: string;
  bid_due_date: string | null;
}

interface SourceRunResult {
  source_id: string;
  source_name: string;
  found: number;
  new: number;
  errors: number;
}

function extractPortalId(url: string): string | null {
  const match = url.match(/\/portal\/(\d+)\//);
  return match ? match[1] : null;
}

function buildPlanetBidsDetailUrl(portalId: string, bidId: string): string {
  return `https://vendors.planetbids.com/portal/${portalId}/bo/bo-detail/${bidId}`;
}

function isValidCandidateUrl(url: string, listingUrl: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (url === listingUrl) return false;
    const hasQuery = parsed.search.length > 1;
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const hasDeepPath = pathSegments.length >= 2;
    return hasQuery || hasDeepPath;
  } catch {
    return false;
  }
}

function parseBidDueDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    if (raw.includes("T")) {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const [year, month, day] = raw.split("-").map(Number);
    if (!year || !month || !day) return null;
    // Treat bare date as noon PST (UTC-8) = 20:00 UTC
    const d = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
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
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors: 1 };
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

  // For PlanetBids: extract portal ID before doing anything else
  let portalId: string | null = null;
  if (source.portal_type === "planetbids") {
    portalId = extractPortalId(source.listing_url);
    if (!portalId) {
      log(`[${source.name}] Could not extract portal ID from URL — skipping`);
      errors++;
      await finishRun();
      return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
    }
    log(`[${source.name}] Portal ID: ${portalId}`);
  }

  // Step 1: Firecrawl scrape
  // PlanetBids pages are JS-rendered and need more time to load
  const waitFor = source.portal_type === "planetbids" ? 8000 : 5000;
  log(`[${source.name}] Scraping listing (waitFor=${waitFor}ms): ${source.listing_url}`);

  let markdown = "";
  try {
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: source.listing_url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor,
      }),
    });

    const scrapeData = await scrapeResponse.json();
    if (!scrapeResponse.ok || !scrapeData.success) {
      log(`[${source.name}] Firecrawl scrape failed: ${JSON.stringify(scrapeData).substring(0, 300)}`);
      errors++;
      await finishRun();
      return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
    }

    markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    log(`[${source.name}] Scraped ${markdown.length} chars`);
  } catch (e) {
    log(`[${source.name}] Firecrawl fetch error: ${e}`);
    errors++;
    await finishRun();
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
  }

  if (markdown.length < 100) {
    log(`[${source.name}] Markdown too short, likely empty page`);
    errors++;
    await finishRun();
    return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
  }

  // Step 2: LLM extraction — branched by portal type
  log(`[${source.name}] Running LLM extraction...`);

  if (source.portal_type === "planetbids") {
    // ── PlanetBids path ──────────────────────────────────────────────────────
    let opportunities: PlanetBidsOpportunity[] = [];

    try {
      const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are extracting bid opportunities from a PlanetBids listing page.
Extract ONLY rows where Stage = Bidding.
Do NOT return rows where Stage is Closed, Rejected, Awarded, or any value other than Bidding.
For each qualifying row, find the bid_id by looking for href links in the format /bo-detail/{number} embedded in the page content. The invitation_number alone (e.g. GP-26-0016) does NOT contain the numeric bid_id — it must come from a /bo-detail/{number} link. If no such link is found for a row, set bid_id to null.`,
            },
            {
              role: "user",
              content: `Extract all active bidding opportunities from this PlanetBids listing page.

SOURCE URL: ${source.listing_url}

CONTENT:
${markdown.substring(0, 15000)}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_planetbids_opportunities",
                description: "Extract active bidding opportunities from a PlanetBids listing page",
                parameters: {
                  type: "object",
                  properties: {
                    opportunities: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: {
                            type: "string",
                            description: "Bid title as shown on the listing",
                          },
                          invitation_number: {
                            type: "string",
                            description: "Invitation or solicitation number (e.g. GP-26-0016)",
                          },
                          bid_id: {
                            type: "string",
                            description: "Numeric ID found in a /bo-detail/{number} href link on the page. NOT derived from the invitation_number. Null if no such link is found.",
                          },
                          due_date: {
                            type: "string",
                            description: "Bid closing date in YYYY-MM-DD format if shown, otherwise null",
                          },
                        },
                        required: ["title"],
                      },
                    },
                  },
                  required: ["opportunities"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_planetbids_opportunities" } },
        }),
      });

      if (!llmResponse.ok) {
        const errText = await llmResponse.text();
        log(`[${source.name}] LLM request failed: ${llmResponse.status} ${errText.substring(0, 300)}`);
        errors++;
        await finishRun();
        return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
      }

      const llmData = await llmResponse.json();
      const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        opportunities = parsed.opportunities || [];
        log(`[${source.name}] LLM returned ${opportunities.length} raw items`);
      }
    } catch (e) {
      log(`[${source.name}] LLM error: ${e}`);
      errors++;
      await finishRun();
      return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
    }

    // Step 3: Build URLs and upsert candidates
    for (const opp of opportunities) {
      if (!opp.bid_id) {
        log(`[${source.name}] Skipped — no bid_id for: ${opp.invitation_number ?? opp.title}`);
        continue;
      }

      const detailUrl = buildPlanetBidsDetailUrl(portalId!, opp.bid_id);
      candidatesFound++;

      const bidDueAt = parseBidDueDate(opp.due_date);

      const { error: insertError } = await supabase
        .from("opportunity_candidates")
        .insert({
          source_id: source.id,
          source_url: detailUrl,
          portal_type: source.portal_type,
          raw_title: opp.title?.substring(0, 500) || null,
          agency: source.name,
          bid_due_at: bidDueAt,
        });

      if (insertError) {
        if (insertError.code === "23505") {
          log(`[${source.name}] Already known: ${detailUrl}`);
        } else {
          log(`[${source.name}] Insert error for ${detailUrl}: ${insertError.message}`);
          errors++;
        }
      } else {
        candidatesNew++;
        log(`[${source.name}] New candidate: ${opp.title}`);
      }
    }
  } else {
    // ── Generic path (non-PlanetBids) ────────────────────────────────────────
    let opportunities: GenericOpportunity[] = [];

    try {
      const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `You are a web scraper assistant. Extract a list of individual bid or project opportunities from a public procurement listing page. Each item must be a distinct project with its own detail page URL. Do not return category links, navigation links, search filters, or the listing page URL itself. Only return items that are clearly individual solicitations or contracts.`,
            },
            {
              role: "user",
              content: `Extract all individual project opportunities from this procurement listing page.\n\nSOURCE URL: ${source.listing_url}\n\nCONTENT:\n${markdown.substring(0, 15000)}`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_opportunity_list",
                description: "Extract a list of individual procurement opportunities from a listing page",
                parameters: {
                  type: "object",
                  properties: {
                    opportunities: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          url: {
                            type: "string",
                            description: "Full absolute URL to the individual project detail page",
                          },
                          title: {
                            type: "string",
                            description: "Project or bid title as shown on the listing",
                          },
                          bid_due_date: {
                            type: "string",
                            description: "Bid closing or due date in YYYY-MM-DD format if shown, otherwise null",
                          },
                        },
                        required: ["url", "title"],
                      },
                    },
                  },
                  required: ["opportunities"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_opportunity_list" } },
        }),
      });

      if (!llmResponse.ok) {
        const errText = await llmResponse.text();
        log(`[${source.name}] LLM request failed: ${llmResponse.status} ${errText.substring(0, 300)}`);
        errors++;
        await finishRun();
        return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
      }

      const llmData = await llmResponse.json();
      const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        opportunities = parsed.opportunities || [];
        log(`[${source.name}] LLM returned ${opportunities.length} raw items`);
      }
    } catch (e) {
      log(`[${source.name}] LLM error: ${e}`);
      errors++;
      await finishRun();
      return { source_id: source.id, source_name: source.name, found: 0, new: 0, errors };
    }

    for (const opp of opportunities) {
      if (!opp.url || !isValidCandidateUrl(opp.url, source.listing_url)) {
        log(`[${source.name}] Skipped invalid URL: ${opp.url}`);
        continue;
      }

      candidatesFound++;
      const bidDueAt = parseBidDueDate(opp.bid_due_date);

      const { error: insertError } = await supabase
        .from("opportunity_candidates")
        .insert({
          source_id: source.id,
          source_url: opp.url,
          portal_type: source.portal_type,
          raw_title: opp.title?.substring(0, 500) || null,
          agency: source.name,
          bid_due_at: bidDueAt,
        });

      if (insertError) {
        if (insertError.code === "23505") {
          log(`[${source.name}] Already known: ${opp.url}`);
        } else {
          log(`[${source.name}] Insert error for ${opp.url}: ${insertError.message}`);
          errors++;
        }
      } else {
        candidatesNew++;
        log(`[${source.name}] New candidate: ${opp.title}`);
      }
    }
  }

  // Update source last_scanned_at
  await supabase
    .from("opportunity_sources")
    .update({ last_scanned_at: new Date().toISOString() })
    .eq("id", source.id);

  log(`[${source.name}] Done. found=${candidatesFound} new=${candidatesNew} errors=${errors}`);
  await finishRun();

  return { source_id: source.id, source_name: source.name, found: candidatesFound, new: candidatesNew, errors };
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
      const result = await scanSource(source, supabase, firecrawlApiKey, lovableApiKey);
      runs.push(result);
      if (sources.indexOf(source) < sources.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    const totalFound = runs.reduce((s, r) => s + r.found, 0);
    const totalNew = runs.reduce((s, r) => s + r.new, 0);
    const totalErrors = runs.reduce((s, r) => s + r.errors, 0);

    return new Response(
      JSON.stringify({
        success: true,
        sources_scanned: runs.length,
        total_candidates_found: totalFound,
        total_candidates_new: totalNew,
        total_errors: totalErrors,
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
