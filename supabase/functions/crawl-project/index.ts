import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Portal detection patterns
const PORTAL_PATTERNS: Array<{ type: string; patterns: RegExp[] }> = [
  { type: 'caltrans', patterns: [/ppmoe\.dot\.ca\.gov/i, /dot\.ca\.gov.*(?:bid|project|advertisement)/i] },
  { type: 'planetbids', patterns: [/planetbids\.com/i] },
  { type: 'epro', patterns: [/epro\.[a-z]+\.gov/i] },
  { type: 'ersp', patterns: [/ersp\.ladwp\.com/i] },
  { type: 'bonfirehub', patterns: [/bonfirehub\.com/i] },
  { type: 'ramp', patterns: [/rampla\.org/i] },
];

function detectPortalType(url: string): string {
  const normalizedUrl = url.toLowerCase();
  for (const portal of PORTAL_PATTERNS) {
    for (const pattern of portal.patterns) {
      if (pattern.test(normalizedUrl)) {
        return portal.type;
      }
    }
  }
  return 'unknown';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, source_url } = await req.json();

    if (!project_id || !source_url) {
      return new Response(
        JSON.stringify({ success: false, error: "project_id and source_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Crawling project ${project_id} from ${source_url}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Detect portal type
    const portalType = detectPortalType(source_url);
    console.log(`Detected portal type: ${portalType}`);

    // Use Firecrawl to scrape the page
    const firecrawlApiKey = Deno.env.get("FIRECRAWL_API_KEY");
    if (!firecrawlApiKey) {
      console.error("FIRECRAWL_API_KEY not configured");
      // Update project with partial info
      await supabase.from("projects").update({
        portal_type: portalType,
        last_crawled_at: new Date().toISOString(),
        crawl_snapshot: { error: "Firecrawl not configured", timestamp: new Date().toISOString() }
      }).eq("id", project_id);
      
      return new Response(
        JSON.stringify({ success: false, error: "Firecrawl not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Scrape the page with Firecrawl
    const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${firecrawlApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: source_url,
        formats: ["markdown", "html"],
        onlyMainContent: true,
        waitFor: 3000,
      }),
    });

    const scrapeData = await scrapeResponse.json();

    if (!scrapeResponse.ok || !scrapeData.success) {
      console.error("Firecrawl scrape failed:", scrapeData);
      await supabase.from("projects").update({
        portal_type: portalType,
        last_crawled_at: new Date().toISOString(),
        crawl_snapshot: { error: "Scrape failed", details: scrapeData, timestamp: new Date().toISOString() }
      }).eq("id", project_id);
      
      return new Response(
        JSON.stringify({ success: false, error: "Failed to scrape page" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
    const metadata = scrapeData.data?.metadata || scrapeData.metadata || {};
    const pageTitle = metadata.title || "";

    console.log(`Scraped ${markdown.length} chars of markdown, title: ${pageTitle}`);

    // Store raw snapshot for debugging
    const crawlSnapshot = {
      timestamp: new Date().toISOString(),
      url: source_url,
      portal_type: portalType,
      title: pageTitle,
      markdown_length: markdown.length,
      metadata,
    };

    // Run LLM semantic extraction
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    let semanticData: any = null;

    if (lovableApiKey && markdown.length > 100) {
      console.log("Running LLM semantic extraction...");
      
      const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${lovableApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a construction project metadata extractor. Extract structured information from public works project pages.

RULES:
- Only mark values as true if EXPLICITLY stated in the text
- If something is ambiguous or not mentioned, return null
- For mandatory job walk: only true if words like "mandatory", "required", "must attend", "failure to attend will disqualify" appear
- Extract dates in ISO 8601 format if found
- Be conservative - when in doubt, return null`
            },
            {
              role: "user",
              content: `Extract project information from this public works project page:

PAGE TITLE: ${pageTitle}

CONTENT:
${markdown.substring(0, 12000)}

Extract the information using the provided function.`
            }
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_project_info",
                description: "Extract structured project information from a public works project page",
                parameters: {
                  type: "object",
                  properties: {
                    project_title: {
                      type: "string",
                      description: "The official project name/title"
                    },
                    agency: {
                      type: "string",
                      description: "The government agency or organization posting the project"
                    },
                    bid_due_date: {
                      type: "string",
                      description: "Bid due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss) if found"
                    },
                    scope_summary: {
                      type: "string",
                      description: "Brief summary of project scope (1-2 sentences)"
                    },
                    job_walk: {
                      type: "object",
                      properties: {
                        exists: { type: "boolean", description: "Is a job walk/site visit mentioned?" },
                        mandatory: { type: "boolean", description: "Is attendance explicitly required/mandatory? null if not specified" },
                        details: { type: "string", description: "Date, time, location of job walk if mentioned" }
                      },
                      required: ["exists"]
                    },
                    eligibility: {
                      type: "object",
                      properties: {
                        restricted: { type: "boolean", description: "Are there bidder eligibility restrictions?" },
                        notes: { type: "string", description: "Specific eligibility requirements (license, prequalification, etc.)" }
                      },
                      required: ["restricted"]
                    },
                    documents: {
                      type: "object",
                      properties: {
                        visible: { type: "boolean", description: "Are project documents listed/visible on page?" },
                        accessible: { type: "boolean", description: "Can documents be downloaded without login?" }
                      },
                      required: ["visible"]
                    },
                    disqualification_language: {
                      type: "string",
                      description: "Any text about bid disqualification conditions"
                    }
                  },
                  required: ["project_title", "job_walk", "eligibility", "documents"],
                  additionalProperties: false
                }
              }
            }
          ],
          tool_choice: { type: "function", function: { name: "extract_project_info" } }
        }),
      });

      if (llmResponse.ok) {
        const llmData = await llmResponse.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          try {
            semanticData = JSON.parse(toolCall.function.arguments);
            console.log("LLM extraction successful:", JSON.stringify(semanticData).substring(0, 200));
          } catch (e) {
            console.error("Failed to parse LLM response:", e);
          }
        }
      } else {
        const errorText = await llmResponse.text();
        console.error("LLM request failed:", llmResponse.status, errorText);
      }
    }

    // Build update object
    const updateData: Record<string, any> = {
      portal_type: portalType,
      last_crawled_at: new Date().toISOString(),
      crawl_snapshot: { ...crawlSnapshot, semantic: semanticData },
    };

    if (semanticData) {
      // Only update name if we extracted one and it's meaningful
      if (semanticData.project_title && semanticData.project_title.length > 3) {
        // Check if current name is placeholder
        const { data: currentProject } = await supabase
          .from("projects")
          .select("name")
          .eq("id", project_id)
          .single();
        
        if (currentProject?.name?.startsWith("Project from ")) {
          updateData.name = semanticData.project_title.substring(0, 200);
        }
      }

      if (semanticData.agency) {
        updateData.agency = semanticData.agency.substring(0, 200);
      }

      if (semanticData.bid_due_date) {
        try {
          const parsedDate = new Date(semanticData.bid_due_date);
          if (!isNaN(parsedDate.getTime())) {
            updateData.bid_due_at = parsedDate.toISOString();
          }
        } catch (e) {
          console.log("Could not parse bid due date:", semanticData.bid_due_date);
        }
      }

      if (semanticData.scope_summary) {
        updateData.scope_text = semanticData.scope_summary;
      }

      // Job walk fields
      if (semanticData.job_walk) {
        updateData.job_walk_exists = semanticData.job_walk.exists || false;
        updateData.job_walk_mandatory = semanticData.job_walk.mandatory ?? null;
        updateData.job_walk_details = semanticData.job_walk.details || null;
      }

      // Eligibility fields
      if (semanticData.eligibility) {
        updateData.eligibility_restricted = semanticData.eligibility.restricted || false;
        updateData.eligibility_notes = semanticData.eligibility.notes || null;
      }

      // Document fields
      if (semanticData.documents) {
        updateData.documents_visible = semanticData.documents.visible ?? null;
        updateData.documents_accessible = semanticData.documents.accessible ?? null;
      }
    }

    // Update project
    const { error: updateError } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", project_id);

    if (updateError) {
      console.error("Failed to update project:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to update project" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully updated project ${project_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        portal_type: portalType,
        extracted: semanticData ? true : false,
        fields_updated: Object.keys(updateData)
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Crawl error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
