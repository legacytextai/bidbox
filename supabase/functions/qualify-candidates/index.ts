import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Exact match on source names written by scan-opportunities.
// When new sources are added, add their entries here.
const AGENCY_COUNTY: Record<string, string> = {
  "City of Irvine":           "Orange",
  "City of Huntington Beach": "Orange",
  "City of Riverside":        "Riverside",
  "City of San Diego":        "San Diego",
  "City of Carlsbad":         "San Diego",
  "City of Long Beach":       "Los Angeles",
  "Port of Long Beach":       "Los Angeles",
  "Port of Los Angeles":      "Los Angeles",
};

interface QualificationProfile {
  target_counties:   string[];
  licenses_held:     string[];
  min_project_value: number | null;
  max_project_value: number | null;
  bond_capacity:     number | null;
  agency_exclusions: string[];
  trade_categories:  string[];
}

interface Candidate {
  id:         string;
  raw_title:  string | null;
  agency:     string | null;
  bid_due_at: string | null;
  scope_text: string | null;
  crawl_data: Record<string, unknown> | null;
}

interface QualificationResult {
  id:                  string;
  auto_status:         "red" | "yellow" | "green";
  auto_status_reason:  string;
  qualification_score: number;
}

// Handles: $5M  $2.5M  $2,500,000  $150K  $1.2B  (case-insensitive suffix)
function parseValueFromTitle(title: string | null): number | null {
  if (!title) return null;
  const match = title.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BbMmKk])?/);
  if (!match) return null;
  const num = parseFloat(match[1].replace(/,/g, ""));
  if (isNaN(num)) return null;
  const multipliers: Record<string, number> = {
    b: 1_000_000_000, B: 1_000_000_000,
    m: 1_000_000,     M: 1_000_000,
    k: 1_000,         K: 1_000,
  };
  return match[2] ? num * (multipliers[match[2]] ?? 1) : num;
}

function formatDollar(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)         return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function qualifyCandidate(
  candidate: Candidate,
  profile: QualificationProfile,
): QualificationResult {
  // Resolve county: agency lookup first, crawl_data as fallback
  const county: string | null =
    (candidate.crawl_data?.county as string | null) ??
    AGENCY_COUNTY[candidate.agency ?? ""] ??
    null;

  // Resolve value: crawl_data first, raw_title parse as fallback
  const value: number | null =
    (candidate.crawl_data?.estimated_value as number | null) ??
    parseValueFromTitle(candidate.raw_title);

  // ── Red rules (first match wins, return immediately) ─────────────────────

  // Agency on exclusion list
  if (
    profile.agency_exclusions.length > 0 &&
    candidate.agency &&
    profile.agency_exclusions.some(
      (e) => e.toLowerCase() === candidate.agency!.toLowerCase(),
    )
  ) {
    return {
      id: candidate.id,
      auto_status: "red",
      auto_status_reason: `Agency on exclusion list (${candidate.agency})`,
      qualification_score: 5,
    };
  }

  // Location confirmed outside all target counties
  if (
    county &&
    profile.target_counties.length > 0 &&
    !profile.target_counties.some((c) => c.toLowerCase() === county.toLowerCase())
  ) {
    return {
      id: candidate.id,
      auto_status: "red",
      auto_status_reason: `Location outside target counties (${county})`,
      qualification_score: 10,
    };
  }

  // Value confirmed below minimum
  if (value !== null && profile.min_project_value !== null && value < profile.min_project_value) {
    return {
      id: candidate.id,
      auto_status: "red",
      auto_status_reason: `Project value (${formatDollar(value)}) below minimum (${formatDollar(profile.min_project_value)})`,
      qualification_score: 10,
    };
  }

  // Value confirmed above maximum
  if (value !== null && profile.max_project_value !== null && value > profile.max_project_value) {
    return {
      id: candidate.id,
      auto_status: "red",
      auto_status_reason: `Project value (${formatDollar(value)}) above maximum (${formatDollar(profile.max_project_value)})`,
      qualification_score: 10,
    };
  }

  // ── Yellow rules (collect all flags) ─────────────────────────────────────

  const yellowFlags: string[] = [];

  if (!county) {
    yellowFlags.push("County unknown");
  }

  if (value === null) {
    yellowFlags.push("Value not determinable");
  }

  if (candidate.bid_due_at) {
    const due = new Date(candidate.bid_due_at);
    const cutoff = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    if (due <= cutoff) {
      const daysLeft = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      yellowFlags.push(`Bid due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`);
    }
  }

  if (!candidate.scope_text || candidate.scope_text.trim().length < 50) {
    yellowFlags.push("Scope not yet available");
  }

  if (yellowFlags.length > 0) {
    return {
      id: candidate.id,
      auto_status: "yellow",
      auto_status_reason: yellowFlags.join("; "),
      qualification_score: Math.max(30, 50 - yellowFlags.length * 10),
    };
  }

  // ── Green ─────────────────────────────────────────────────────────────────

  const positives: string[] = [];
  let score = 70;

  if (county && profile.target_counties.some((c) => c.toLowerCase() === county.toLowerCase())) {
    positives.push(`County in target list (${county})`);
    score += 10;
  }

  if (
    value !== null &&
    profile.min_project_value !== null &&
    profile.max_project_value !== null &&
    value >= profile.min_project_value &&
    value <= profile.max_project_value
  ) {
    positives.push(`Value in range (${formatDollar(value)})`);
    score += 10;
  }

  return {
    id: candidate.id,
    auto_status: "green",
    auto_status_reason: positives.length > 0 ? positives.join("; ") : "No disqualifying flags",
    qualification_score: Math.min(100, score),
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl        = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase           = createClient(supabaseUrl, supabaseServiceKey);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse(401, { success: false, error: "Missing authorization header" });
  }

  // Identify the calling user via the bearer token (JWT already validated by gateway)
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse(401, { success: false, error: "Invalid token" });
  }
  const callerUid = user.id;

  try {
    // Parse request body — all fields optional
    let candidateId: string | null = null;
    let profileId: string = callerUid;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        candidateId = body?.candidate_id ?? null;
        profileId   = body?.profile_id   ?? callerUid;
      } catch {
        // No body or invalid JSON — use defaults
      }
    }

    // Load the qualification profile for the resolved user
    const { data: profile, error: profileError } = await supabase
      .from("gc_qualification_profiles")
      .select(
        "target_counties, licenses_held, min_project_value, max_project_value, bond_capacity, agency_exclusions, trade_categories",
      )
      .eq("profile_id", profileId)
      .maybeSingle();

    if (profileError) {
      console.error("Failed to load qualification profile:", profileError);
      return jsonResponse(500, { success: false, error: "Failed to load qualification profile" });
    }

    if (!profile) {
      return jsonResponse(200, {
        success: true,
        evaluated: 0,
        auto_green: 0,
        auto_yellow: 0,
        auto_red: 0,
        skipped: 0,
        errors: 0,
        message: "No qualification profile found — set up your bid profile first",
      });
    }

    // Load pending candidates (skip any that have been manually reviewed)
    let query = supabase
      .from("opportunity_candidates")
      .select("id, raw_title, agency, bid_due_at, scope_text, crawl_data")
      .eq("status", "pending");

    if (candidateId) {
      query = query.eq("id", candidateId);
    }

    const { data: candidates, error: candidatesError } = await query;

    if (candidatesError) {
      console.error("Failed to load candidates:", candidatesError);
      return jsonResponse(500, { success: false, error: "Failed to load candidates" });
    }

    if (!candidates || candidates.length === 0) {
      return jsonResponse(200, {
        success: true,
        evaluated: 0,
        auto_green: 0,
        auto_yellow: 0,
        auto_red: 0,
        skipped: 0,
        errors: 0,
        message: "No pending candidates to qualify",
      });
    }

    // Run rule engine and write results
    const now = new Date().toISOString();
    let autoGreen = 0, autoYellow = 0, autoRed = 0, errors = 0;

    for (const candidate of candidates as Candidate[]) {
      const result = qualifyCandidate(candidate, profile as QualificationProfile);

      const { error: updateError } = await supabase
        .from("opportunity_candidates")
        .update({
          auto_status:         result.auto_status,
          auto_status_reason:  result.auto_status_reason,
          qualification_score: result.qualification_score,
          qualified_at:        now,
        })
        .eq("id", result.id);

      if (updateError) {
        console.error(`Failed to update candidate ${result.id}:`, updateError);
        errors++;
        continue;
      }

      if (result.auto_status === "green")  autoGreen++;
      else if (result.auto_status === "yellow") autoYellow++;
      else if (result.auto_status === "red")    autoRed++;
    }

    console.log(
      `qualify-candidates: evaluated=${candidates.length} green=${autoGreen} yellow=${autoYellow} red=${autoRed} errors=${errors}`,
    );

    return jsonResponse(200, {
      success: true,
      evaluated:   candidates.length,
      auto_green:  autoGreen,
      auto_yellow: autoYellow,
      auto_red:    autoRed,
      skipped:     0,
      errors,
    });
  } catch (error) {
    console.error("qualify-candidates error:", error);
    return jsonResponse(500, {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
