import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CALEPROCURE_SOURCE_ID = "75d7fa42-2302-4fce-ba0f-ba33ef6e9a82";

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
  naics_codes:       string[];
  min_project_value: number | null;
  max_project_value: number | null;
}

interface Candidate {
  id:                  string;
  source_id:           string | null;
  portal_type:         string | null;
  raw_title:           string | null;
  agency:              string | null;
  bid_due_at:          string | null;
  scope_text:          string | null;
  // OML normalized columns (read these; crawl_data kept for overflow/fallback only)
  estimated_value:     number | null;
  county:              string | null;
  required_licenses:   string[] | null;
  required_naics:      string[] | null;
  crawl_data:          Record<string, unknown> | null;
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

function normalizeTitle(title: string | null): string {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9/&+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(title: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(title));
}

const PUBLIC_WORKS_TITLE_PATTERNS: RegExp[] = [
  /\bbridge\b/,
  /\broadway\b/,
  /\broad\b/,
  /\bstreet\b/,
  /\bsidewalk\b/,
  /\blandscaping\b/,
  /\bconcrete\b/,
  /\basphalt\b/,
  /\bdemolition\b/,
  /\bpavement\b/,
  /\bpaving\b/,
  /\bdrainage\b/,
  /\blighting\b/,
  /\btraffic\b/,
  /\bsignal\b/,
  /\bsewer\b/,
  /\bstorm drain\b/,
  /\bwastewater\b/,
  /\bpotable water\b/,
  /\bwater well(s)?\b/,
  /\bwell(s)?\b/,
  /\butilities\b/,
  /\butility\b/,
  /\belectrical\b/,
  /\bplumbing\b/,
  /\bev supply equipment\b/,
  /\bev charging\b/,
  /\bcharging infrastructure\b/,
  /\bpumping plant\b/,
  /\bsite improvement(s)?\b/,
  /\bpark(s)?\b/,
  /\bfacilit(y|ies)\b/,
  /\bbuilding(s)?\b/,
  /\broof\b/,
  /\bhvac\b/,
  /\bpipeline\b/,
  /\bdrilling\b/,
  /\bsite characterization\b/,
  /\bsurvey(ing)?\b/,
  /\ba&e\b/,
  /\barchitectural\b/,
  /\bengineering\b/,
  /\bon-call engineering\b/,
  /\benvironmental\b/,
  /\bceqa\b/,
  /\bconstruction\b/,
  /\bcontractor(s)?\b/,
  /\bgeneral contractor(s)?\b/,
  /\bjoc\b/,
  /\bjob order contract\b/,
  /\bconstruction management\b/,
  /\bimprovement(s)?\b/,
  /\brepair\b/,
  /\bmaintenance\b/,
  /\brehabilitation\b/,
  /\brehab\b/,
  /\breplacement\b/,
  /\brenovation\b/,
  /\bmodernization\b/,
  /\broad rocking\b/,
];

const NON_PUBLIC_WORKS_TITLE_PATTERNS: Array<{ reason: string; patterns: RegExp[] }> = [
  {
    reason: "Incomplete Cal eProcure placeholder title",
    patterns: [
      /\bevent title\b/,
    ],
  },
  {
    reason: "Non-public-works software / IT procurement",
    patterns: [
      /\bcannabis\b.*\b(integration|system|software|platform)\b/,
      /\b(integration|system|software|platform)\b.*\bcannabis\b/,
      /\bsoftware\b/,
      /\bcloud services?\b/,
      /\bcloud\b.*\b(subscription|service|platform|hosting)\b/,
      /\bsaas\b/,
      /\bit services?\b/,
      /\binformation technology\b/,
      /\bmanaged cybersecurity\b/,
      /\bcybersecurity\b/,
      /\bcalnet\b/,
      /\btechnical access portal\b/,
      /\bportal\b.*\b(m&o|maintenance|operations?)\b/,
      /\b(m&o|maintenance|operations?)\b.*\bportal\b/,
      /\bsaphire\b/,
      /\bdata system\b/,
      /\bdata logger equipment\b/,
      /\bdata\b.*\b(services?|subscription|platform|system)\b/,
      /\bcall processing equipment\b/,
      /\b9-?1-?1 call processing\b/,
    ],
  },
  {
    reason: "Non-public-works funding program",
    patterns: [
      /\bbroadband funding\b/,
      /\bfunding program\b/,
      /\bgrant program\b/,
    ],
  },
  {
    reason: "Municipal operations outside construction scope",
    patterns: [
      /\bjanitorial\b/,
      /\bcustodial\b/,
      /\blodging\b/,
      /\bhotel\b/,
      /\bcourier\b/,
      /\bshipping\b/,
      /\bdelivery services?\b/,
      /\bfreight shipping\b/,
      /\bcustom envelopes?\b/,
      /\bprint and deliver\b/,
      /\bprinting\b/,
      /\bmailing\b/,
      /\bvideographer\b/,
      /\bvideo production\b/,
      /\bfocus group\b/,
      /\bresearch services?\b/,
      /\bguard services?\b/,
      /\bsecurity services?\b/,
      /\btowing services?\b/,
      /\bconsulting services?\b/,
      /\bconsultant\b/,
      /\bmedical consultant\b/,
      /\bmedical consulting\b/,
      /\bphysician consulting\b/,
      /\bhealth program\b/,
      /\bhealth care provider\b/,
      /\bprior authorization\b/,
      /\bpharmaceutical consulting\b/,
      /\bpharmaceutical\b/,
      /\basl interpreting\b/,
      /\binterpreting services?\b/,
      /\binterpreter\b/,
      /\btranslation\b/,
      /\bfood\b/,
      /\bagriculture\b/,
      /\blab supplies\b/,
      /\blaboratory supplies\b/,
      /\boffice moving\b/,
      /\btitle\/escrow\b/,
      /\btitle and escrow\b/,
      /\bgeneral supplies\b/,
      /\bprotective clothing\b/,
      /\boperational supplies\b/,
      /\bsupplies rental\b/,
      /\bclothing rental\b/,
    ],
  },
];

function isCalEprocureCandidate(candidate: Candidate): boolean {
  return candidate.portal_type === "caleprocure" || candidate.source_id === CALEPROCURE_SOURCE_ID;
}

function classifyCalEprocurePublicWorks(title: string | null): { red: boolean; reason: string | null } {
  const normalized = normalizeTitle(title);
  if (!normalized) return { red: false, reason: null };

  if (/\bevent title\b/.test(normalized)) {
    return { red: true, reason: "Incomplete Cal eProcure placeholder title" };
  }

  const nonPublicWorks = NON_PUBLIC_WORKS_TITLE_PATTERNS.find(({ patterns }) => includesAny(normalized, patterns));
  if (!nonPublicWorks) return { red: false, reason: null };

  // Explicit construction/public-works scope wins over broad terms like
  // "system", "portal", or "services" so EV charging, utilities, wells,
  // roadway, A&E, and environmental work stay visible.
  if (includesAny(normalized, PUBLIC_WORKS_TITLE_PATTERNS)) {
    return { red: false, reason: null };
  }

  return { red: true, reason: nonPublicWorks.reason };
}

function qualifyCandidate(
  candidate: Candidate,
  profile: QualificationProfile,
): QualificationResult {
  // Resolve county: typed column first, agency lookup as fallback
  const county: string | null =
    candidate.county ??
    AGENCY_COUNTY[candidate.agency ?? ""] ??
    null;

  // Resolve value: typed column first (only if positive), raw_title parse as fallback
  const value: number | null =
    (typeof candidate.estimated_value === "number" && candidate.estimated_value > 0)
      ? candidate.estimated_value
      : parseValueFromTitle(candidate.raw_title);

  // ── Red rules (first match wins, return immediately) ─────────────────────

  if (isCalEprocureCandidate(candidate)) {
    const domainClassification = classifyCalEprocurePublicWorks(candidate.raw_title);
    if (domainClassification.red) {
      return {
        id: candidate.id,
        auto_status: "red",
        auto_status_reason: domainClassification.reason ?? "Non-public-works procurement",
        qualification_score: 0,
      };
    }
  }

  // Bid due date is already in the past
  if (candidate.bid_due_at) {
    const due = new Date(candidate.bid_due_at);
    if (!isNaN(due.getTime()) && due.getTime() < Date.now()) {
      return {
        id: candidate.id,
        auto_status: "red",
        auto_status_reason: "Bid closed",
        qualification_score: 0,
      };
    }
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

  // Combined capability check — fires only when requirement fields are populated.
  // OR logic: matching on EITHER licenses or naics is sufficient to pass.
  // Dormant until crawl-project phase populates required_licenses / required_naics.
  const requiredLicenses = candidate.required_licenses ?? [];
  const requiredNaics    = candidate.required_naics    ?? [];
  const hasCapabilityData = requiredLicenses.length > 0 || requiredNaics.length > 0;

  if (hasCapabilityData) {
    const licenseOverlap = requiredLicenses.some(
      (l) => profile.licenses_held.some((h) => h.toLowerCase() === l.toLowerCase()),
    );
    const naicsOverlap = requiredNaics.some((n) => profile.naics_codes.includes(n));

    if (!licenseOverlap && !naicsOverlap) {
      const required = [...requiredLicenses, ...requiredNaics].join(", ");
      return {
        id: candidate.id,
        auto_status: "red",
        auto_status_reason: `No matching capability (requires ${required})`,
        qualification_score: 10,
      };
    }
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

  try {
    // Parse request body — all fields optional
    let candidateId: string | null = null;
    let profileId: string | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        candidateId = body?.candidate_id ?? null;
        profileId   = body?.profile_id   ?? null;
      } catch {
        // No body or invalid JSON — use defaults
      }
    }

    // profile_id not in body — resolve from bearer token
    if (!profileId) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return jsonResponse(401, { success: false, error: "Missing authorization header" });
      }
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse(401, { success: false, error: "Invalid token" });
      }
      profileId = user.id;
    }

    // Load the qualification profile for the resolved user
    const { data: profile, error: profileError } = await supabase
      .from("gc_qualification_profiles")
      .select(
        "target_counties, licenses_held, naics_codes, min_project_value, max_project_value",
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
      .select("id, source_id, portal_type, raw_title, agency, bid_due_at, scope_text, estimated_value, county, required_licenses, required_naics, crawl_data")
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
