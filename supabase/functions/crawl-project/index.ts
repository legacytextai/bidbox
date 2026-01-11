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

// California city to county mapping (common cities)
const CA_CITY_TO_COUNTY: Record<string, string> = {
  "irvine": "Orange",
  "anaheim": "Orange",
  "santa ana": "Orange",
  "huntington beach": "Orange",
  "costa mesa": "Orange",
  "fullerton": "Orange",
  "orange": "Orange",
  "garden grove": "Orange",
  "newport beach": "Orange",
  "mission viejo": "Orange",
  "laguna niguel": "Orange",
  "lake forest": "Orange",
  "tustin": "Orange",
  "buena park": "Orange",
  "yorba linda": "Orange",
  "san clemente": "Orange",
  "laguna beach": "Orange",
  "los angeles": "Los Angeles",
  "long beach": "Los Angeles",
  "pasadena": "Los Angeles",
  "glendale": "Los Angeles",
  "burbank": "Los Angeles",
  "santa monica": "Los Angeles",
  "torrance": "Los Angeles",
  "pomona": "Los Angeles",
  "downey": "Los Angeles",
  "west covina": "Los Angeles",
  "el monte": "Los Angeles",
  "compton": "Los Angeles",
  "inglewood": "Los Angeles",
  "alhambra": "Los Angeles",
  "san diego": "San Diego",
  "chula vista": "San Diego",
  "oceanside": "San Diego",
  "escondido": "San Diego",
  "carlsbad": "San Diego",
  "el cajon": "San Diego",
  "san marcos": "San Diego",
  "encinitas": "San Diego",
  "san francisco": "San Francisco",
  "oakland": "Alameda",
  "berkeley": "Alameda",
  "fremont": "Alameda",
  "hayward": "Alameda",
  "san leandro": "Alameda",
  "san jose": "Santa Clara",
  "sunnyvale": "Santa Clara",
  "santa clara": "Santa Clara",
  "mountain view": "Santa Clara",
  "milpitas": "Santa Clara",
  "palo alto": "Santa Clara",
  "cupertino": "Santa Clara",
  "fresno": "Fresno",
  "clovis": "Fresno",
  "sacramento": "Sacramento",
  "elk grove": "Sacramento",
  "rancho cordova": "Sacramento",
  "folsom": "Sacramento",
  "riverside": "Riverside",
  "moreno valley": "Riverside",
  "corona": "Riverside",
  "temecula": "Riverside",
  "murrieta": "Riverside",
  "san bernardino": "San Bernardino",
  "fontana": "San Bernardino",
  "rancho cucamonga": "San Bernardino",
  "ontario": "San Bernardino",
  "victorville": "San Bernardino",
  "bakersfield": "Kern",
  "stockton": "San Joaquin",
  "modesto": "Stanislaus",
  "ventura": "Ventura",
  "oxnard": "Ventura",
  "thousand oaks": "Ventura",
  "simi valley": "Ventura",
  "santa barbara": "Santa Barbara",
  "santa cruz": "Santa Cruz",
  "monterey": "Monterey",
  "salinas": "Monterey",
  "redding": "Shasta",
  "chico": "Butte",
};

function inferCountyFromAgency(agency: string): string | null {
  const normalized = agency.toLowerCase();
  
  // Pattern: "City of X" or "X City"
  const cityOfMatch = normalized.match(/city of\s+([a-z\s]+?)(?:\s*,|\s*-|$)/);
  const cityMatch = normalized.match(/([a-z\s]+)\s+city(?:\s|$)/);
  
  const cityName = cityOfMatch?.[1]?.trim() || cityMatch?.[1]?.trim();
  
  if (cityName && CA_CITY_TO_COUNTY[cityName]) {
    return CA_CITY_TO_COUNTY[cityName];
  }
  
  // Direct county match - check if "County" is in the agency name
  const countyMatch = normalized.match(/([a-z\s]+)\s+county/);
  if (countyMatch) {
    const countyName = countyMatch[1].trim();
    // Capitalize first letter of each word
    return countyName.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  
  return null;
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

CRITICAL RULES FOR DATE/TIME EXTRACTION:
- For bid_due_date: Extract the EXACT date AND time shown near "Bid Due", "Bid Opening", "Closing Date", "Due Date"
- Look for patterns like "2:00 PM PST", "10:00 AM", "14:00", "2:00pm"
- NEVER default to midnight (00:00), 2:00 AM, or any arbitrary time
- If date is found but time is NOT explicitly stated, include ONLY the date portion (YYYY-MM-DD) - NO TIME COMPONENT
- Use 24-hour format when extracting: 2:00 PM = 14:00, 10:00 AM = 10:00
- Times are ONLY valid if explicitly written on the page

RULES FOR JOB WALK EXTRACTION:
- Search for "Job Walk", "Site Visit", "Pre-Bid Meeting", "Mandatory Walk"
- Extract the EXACT date and time if stated
- Extract the meeting location/address if provided
- Only mark mandatory as true if words like "mandatory", "required", "must attend", "failure to attend will disqualify" appear

GENERAL RULES:
- Only mark values as true if EXPLICITLY stated in the text
- If something is ambiguous or not mentioned, return null
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
                      description: "Bid due date. Extract EXACT time from near 'Bid Due', 'Bid Opening', or 'Closing Date'. Format: YYYY-MM-DDTHH:mm:ss if time is EXPLICITLY stated (e.g., 2:00 PM = 14:00:00). Use YYYY-MM-DD only if NO time is stated. NEVER guess or default times."
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
                        datetime: { type: "string", description: "Job walk date and time in ISO 8601 format (YYYY-MM-DDTHH:mm:ss) if found. Extract EXACT time shown." },
                        location: { type: "string", description: "Meeting location/address if specified" },
                        details: { type: "string", description: "Full raw text about job walk requirements including date, time, location" }
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
          .select("name, county")
          .eq("id", project_id)
          .single();
        
        if (currentProject?.name?.startsWith("Project from ")) {
          updateData.name = semanticData.project_title.substring(0, 200);
        }
        
        // Infer county from agency if not already set
        if (semanticData.agency && !currentProject?.county) {
          const inferredCounty = inferCountyFromAgency(semanticData.agency);
          if (inferredCounty) {
            updateData.county = inferredCounty;
            console.log(`Inferred county: ${inferredCounty} from agency: ${semanticData.agency}`);
          }
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
        
        // Extract job_walk_at from the datetime field
        if (semanticData.job_walk.datetime) {
          try {
            const parsedJobWalk = new Date(semanticData.job_walk.datetime);
            if (!isNaN(parsedJobWalk.getTime())) {
              updateData.job_walk_at = parsedJobWalk.toISOString();
              console.log(`Extracted job walk date: ${updateData.job_walk_at}`);
            }
          } catch (e) {
            console.log("Could not parse job walk date:", semanticData.job_walk.datetime);
          }
        }
        
        // Build comprehensive job_walk_details if we have location
        if (semanticData.job_walk.location && !updateData.job_walk_details) {
          updateData.job_walk_details = `Location: ${semanticData.job_walk.location}`;
        } else if (semanticData.job_walk.location && updateData.job_walk_details) {
          // Append location if not already in details
          if (!updateData.job_walk_details.toLowerCase().includes(semanticData.job_walk.location.toLowerCase())) {
            updateData.job_walk_details += ` | Location: ${semanticData.job_walk.location}`;
          }
        }
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
