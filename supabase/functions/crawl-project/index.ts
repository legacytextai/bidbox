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
  { type: 'lacounty_dpw', patterns: [/dpw\.lacounty\.gov/i] },
  { type: 'lacmta', patterns: [/business\.metro\.net/i] },
  { type: 'caleprocure', patterns: [/caleprocure\.ca\.gov/i] },
  { type: 'opengov', patterns: [/procurement\.opengov\.com/i] },
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

// Convert local time string to UTC, accounting for source timezone
function convertLocalToUtc(localDateStr: string, timezone: string = 'PST'): string {
  // Map common abbreviations to UTC offsets (in hours)
  // Note: These are standard time offsets; daylight saving handled approximately
  const tzOffsets: Record<string, number> = {
    'PST': -8,
    'PDT': -7,
    'MST': -7,
    'MDT': -6,
    'CST': -6,
    'CDT': -5,
    'EST': -5,
    'EDT': -4,
    'PT': -8,  // Pacific Time (assume standard)
    'MT': -7,  // Mountain Time
    'CT': -6,  // Central Time
    'ET': -5,  // Eastern Time
  };
  
  const offsetHours = tzOffsets[timezone.toUpperCase()] ?? -8; // Default to PST
  
  // Parse the local datetime
  // Input format: "2026-01-29T10:00:00" or "2026-01-29"
  let date: Date;
  
  if (localDateStr.includes('T')) {
    // Has time component - parse as local time
    // The string "2026-01-29T10:00:00" represents 10:00 AM in the source timezone
    const [datePart, timePart] = localDateStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hour, minute, second] = (timePart || '00:00:00').split(':').map(n => parseInt(n) || 0);
    
    // Create date as UTC, then adjust for source timezone
    // If it's 10:00 AM PST (UTC-8), we need to add 8 hours to get UTC time
    date = new Date(Date.UTC(year, month - 1, day, hour - offsetHours, minute, second));
  } else {
    // Date only - set to noon in source timezone to avoid date boundary issues
    const [year, month, day] = localDateStr.split('-').map(Number);
    date = new Date(Date.UTC(year, month - 1, day, 12 - offsetHours, 0, 0));
  }
  
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${localDateStr}`);
  }
  
  return date.toISOString();
}

// Detect timezone from text (look for common patterns)
function detectTimezoneFromText(text: string): string {
  const tzPatterns = [
    { pattern: /\bPST\b/i, tz: 'PST' },
    { pattern: /\bPDT\b/i, tz: 'PDT' },
    { pattern: /\bPacific\s+(Standard\s+)?Time/i, tz: 'PST' },
    { pattern: /\bMST\b/i, tz: 'MST' },
    { pattern: /\bMDT\b/i, tz: 'MDT' },
    { pattern: /\bMountain\s+(Standard\s+)?Time/i, tz: 'MST' },
    { pattern: /\bCST\b/i, tz: 'CST' },
    { pattern: /\bCDT\b/i, tz: 'CDT' },
    { pattern: /\bCentral\s+(Standard\s+)?Time/i, tz: 'CST' },
    { pattern: /\bEST\b/i, tz: 'EST' },
    { pattern: /\bEDT\b/i, tz: 'EDT' },
    { pattern: /\bEastern\s+(Standard\s+)?Time/i, tz: 'EST' },
  ];
  
  for (const { pattern, tz } of tzPatterns) {
    if (pattern.test(text)) {
      return tz;
    }
  }
  
  // Default to PST for California public works
  return 'PST';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { project_id, source_url, is_recrawl, previous_values } = await req.json();

    if (!project_id || !source_url) {
      return new Response(
        JSON.stringify({ success: false, error: "project_id and source_url are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`${is_recrawl ? 'Re-crawling' : 'Crawling'} project ${project_id} from ${source_url}`);

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
- Use 24-hour format when extracting: 2:00 PM = 14:00:00, 10:00 AM = 10:00:00
- Times are ONLY valid if explicitly written on the page
- IMPORTANT: Extract times AS SHOWN in the source - do NOT convert to a different timezone. If page shows "10:00 AM PST", extract as 10:00:00

TIMEZONE EXTRACTION:
- Look for timezone indicators near dates: PST, PDT, EST, EDT, Pacific Time, etc.
- If timezone is explicitly stated (e.g., "10:00 AM PST"), include it in source_timezone field
- For California public works projects with no explicit timezone, set source_timezone to "PST"

RULES FOR JOB WALK EXTRACTION:
- Search for "Job Walk", "Site Visit", "Pre-Bid Meeting", "Mandatory Walk", "Pre-Bid Conference"
- Extract the EXACT date and time if stated
- Extract the meeting location/address if provided
- Only mark mandatory as true if words like "mandatory", "required", "must attend", "failure to attend will disqualify" appear

RULES FOR COST/BOND EXTRACTION:
- Look for "Estimated Bid Value", "Engineer's Estimate", "Estimated Cost", "Budget", "Project Value"
- Extract the numeric value and currency (e.g., "$7,500,000.00" → 7500000, "USD")
- Look for "Bid Bond", "Payment Bond", "Performance Bond", "Bid Security" percentages
- Common patterns: "Bid Bond: 10%", "Payment Bond (100%)", "Bid Security: 5%"
- Only extract if explicitly stated with a percentage or dollar amount
- If not found, return null

RULES FOR ADDENDA EXTRACTION:
- Search for "Addenda", "Addendum", "Amendment", "Revision"
- Count how many addenda are listed or referenced
- Look for patterns like "Addendum 1", "Addenda (3)", "2 addenda issued"
- Only count if explicitly mentioned, do not infer

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
                    source_timezone: {
                      type: "string",
                      description: "Timezone abbreviation found near dates (PST, PDT, EST, EDT, etc.). Default to 'PST' for California projects if not explicitly stated."
                    },
                    bid_due_date: {
                      type: "string",
                      description: "Bid due date. Extract EXACT time AS SHOWN near 'Bid Due', 'Bid Opening', or 'Closing Date'. Format: YYYY-MM-DDTHH:mm:ss if time is EXPLICITLY stated (e.g., 10:00 AM = 10:00:00, 2:00 PM = 14:00:00). Use YYYY-MM-DD only if NO time is stated. NEVER convert timezones, NEVER guess times."
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
                    engineers_estimate: {
                      type: "object",
                      properties: {
                        amount: { type: "number", description: "Estimated project value as a number (no commas, no currency symbol). e.g. 7500000 for $7,500,000" },
                        currency: { type: "string", description: "Currency code, typically USD" },
                        raw_text: { type: "string", description: "Original text exactly as shown on page, e.g. '$7,500,000.00'" }
                      },
                      description: "Engineer's Estimate or Estimated Bid Value if explicitly stated. Return null if not found."
                    },
                    bonds: {
                      type: "object",
                      properties: {
                        bid_bond_percent: { type: "number", description: "Bid bond percentage as number (e.g., 10 for 10%)" },
                        payment_bond_percent: { type: "number", description: "Payment bond percentage as number (e.g., 100 for 100%)" },
                        performance_bond_percent: { type: "number", description: "Performance bond percentage as number (e.g., 100 for 100%)" },
                        notes: { type: "string", description: "Additional bond requirements, conditions, or alternative amounts if stated" }
                      },
                      description: "Bond requirements if explicitly stated. Return null if not found."
                    },
                    addenda: {
                      type: "object",
                      properties: {
                        count: { type: "number", description: "Number of addenda detected. Use 0 if 'no addenda' or 'none' is stated." },
                        details: { type: "string", description: "List of addenda with dates/numbers if available, e.g. 'Addendum 1 (12/15/2025), Addendum 2 (12/20/2025)'" }
                      },
                      description: "Addenda/amendments detected on the page. Return null if not mentioned."
                    },
                    disqualification_language: {
                      type: "string",
                      description: "Any text about bid disqualification conditions"
                    }
                  },
                  required: ["project_title", "source_timezone", "job_walk", "eligibility", "documents"],
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

      // Determine source timezone from extraction or detect from markdown
      const sourceTimezone = semanticData.source_timezone || detectTimezoneFromText(markdown) || 'PST';
      console.log(`Using source timezone: ${sourceTimezone}`);

      if (semanticData.bid_due_date) {
        try {
          const utcDate = convertLocalToUtc(semanticData.bid_due_date, sourceTimezone);
          updateData.bid_due_at = utcDate;
          console.log("Bid due date conversion:", {
            extracted: semanticData.bid_due_date,
            timezone: sourceTimezone,
            stored_utc: utcDate
          });
        } catch (e) {
          console.log("Could not parse bid due date:", semanticData.bid_due_date, e);
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
        
        // Extract job_walk_at from the datetime field with timezone conversion
        if (semanticData.job_walk.datetime) {
          try {
            const sourceTimezone = semanticData.source_timezone || detectTimezoneFromText(markdown) || 'PST';
            const utcJobWalk = convertLocalToUtc(semanticData.job_walk.datetime, sourceTimezone);
            updateData.job_walk_at = utcJobWalk;
            console.log("Job walk date conversion:", {
              extracted: semanticData.job_walk.datetime,
              timezone: sourceTimezone,
              stored_utc: utcJobWalk
            });
          } catch (e) {
            console.log("Could not parse job walk date:", semanticData.job_walk.datetime, e);
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

    // Change detection for re-crawls
    let crawlChanges: Record<string, { old: any; new: any }> | null = null;
    let hasChanges = false;

    if (is_recrawl && previous_values) {
      const changes: Record<string, { old: any; new: any }> = {};
      
      // Check bid_due_at changes
      if (updateData.bid_due_at && previous_values.bid_due_at) {
        const oldDate = new Date(previous_values.bid_due_at).getTime();
        const newDate = new Date(updateData.bid_due_at).getTime();
        // Only flag if difference is more than 1 minute (to avoid timezone rounding issues)
        if (Math.abs(oldDate - newDate) > 60000) {
          changes.bid_due_at = { old: previous_values.bid_due_at, new: updateData.bid_due_at };
          hasChanges = true;
        }
      }
      
      // Check job_walk_at changes
      if (updateData.job_walk_at !== undefined && previous_values.job_walk_at !== updateData.job_walk_at) {
        if (updateData.job_walk_at && previous_values.job_walk_at) {
          const oldDate = new Date(previous_values.job_walk_at).getTime();
          const newDate = new Date(updateData.job_walk_at).getTime();
          if (Math.abs(oldDate - newDate) > 60000) {
            changes.job_walk_at = { old: previous_values.job_walk_at, new: updateData.job_walk_at };
            hasChanges = true;
          }
        } else if (updateData.job_walk_at || previous_values.job_walk_at) {
          changes.job_walk_at = { old: previous_values.job_walk_at, new: updateData.job_walk_at };
          hasChanges = true;
        }
      }
      
      // Check agency changes
      if (updateData.agency && previous_values.agency && 
          updateData.agency.toLowerCase() !== previous_values.agency.toLowerCase()) {
        changes.agency = { old: previous_values.agency, new: updateData.agency };
        hasChanges = true;
      }
      
      if (hasChanges) {
        crawlChanges = changes;
        updateData.crawl_changes = changes;
        console.log("Changes detected during re-crawl:", changes);
      } else {
        // Clear any previous changes if no new changes found
        updateData.crawl_changes = null;
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

    console.log(`Successfully ${is_recrawl ? 're-crawled' : 'crawled'} project ${project_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        portal_type: portalType,
        extracted: semanticData ? true : false,
        fields_updated: Object.keys(updateData),
        hasChanges,
        changes: crawlChanges
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
