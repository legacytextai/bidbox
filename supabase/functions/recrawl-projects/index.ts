import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface Project {
  id: string;
  source_url: string;
  name: string;
  bid_due_at: string | null;
  job_walk_at: string | null;
  agency: string | null;
  last_crawled_at: string | null;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Query all One Link projects that are LIVE and need re-crawl
    // Re-crawl if last_crawled_at is more than 20 hours ago or null
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();
    
    const { data: projects, error: fetchError } = await supabase
      .from("projects")
      .select("id, source_url, name, bid_due_at, job_walk_at, agency, last_crawled_at")
      .eq("status", "LIVE")
      .not("source_url", "is", null)
      .or(`last_crawled_at.is.null,last_crawled_at.lt.${twentyHoursAgo}`)
      .limit(50); // Process max 50 per run to avoid timeout

    if (fetchError) {
      console.error("Error fetching projects:", fetchError);
      throw fetchError;
    }

    if (!projects || projects.length === 0) {
      console.log("No projects need re-crawling");
      return new Response(
        JSON.stringify({ processed: 0, changed: 0, errors: 0, message: "No projects need re-crawling" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${projects.length} projects to re-crawl`);

    let processed = 0;
    let changed = 0;
    let errors = 0;

    // Process each project with rate limiting
    for (const project of projects as Project[]) {
      try {
        console.log(`Re-crawling project: ${project.id} - ${project.name}`);
        
        // Store current values for change detection
        const previousValues = {
          bid_due_at: project.bid_due_at,
          job_walk_at: project.job_walk_at,
          agency: project.agency,
          name: project.name,
        };

        // Call the crawl-project function
        const crawlResponse = await fetch(
          `${supabaseUrl}/functions/v1/crawl-project`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              project_id: project.id,
              source_url: project.source_url,
              is_recrawl: true,
              previous_values: previousValues,
            }),
          }
        );

        if (!crawlResponse.ok) {
          const errorText = await crawlResponse.text();
          console.error(`Crawl failed for ${project.id}: ${errorText}`);
          errors++;
        } else {
          const result = await crawlResponse.json();
          processed++;
          if (result.hasChanges) {
            changed++;
            console.log(`Changes detected for ${project.id}:`, result.changes);
          }
        }

        // Rate limiting: wait 2 seconds between crawls to respect Firecrawl limits
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        console.error(`Error processing project ${project.id}:`, err);
        errors++;
      }
    }

    const summary = {
      processed,
      changed,
      errors,
      total: projects.length,
      message: `Re-crawl complete: ${processed} processed, ${changed} with changes, ${errors} errors`,
    };

    console.log("Re-crawl summary:", summary);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Re-crawl error:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
