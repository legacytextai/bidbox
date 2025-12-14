import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple in-memory rate limiting (resets on function cold start)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per IP

function isRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(clientIp);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  
  record.count++;
  return false;
}

interface CSLBClassification {
  code: string;
  name: string;
  trade_type_id: string | null;
}

interface CSLBLookupResult {
  success: boolean;
  company_name?: string;
  license_number?: string;
  license_status?: string;
  expiration_date?: string;
  city?: string;
  state_code?: string;
  classifications?: CSLBClassification[];
  error?: string;
  cached?: boolean;
  manual_entry_required?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Rate limiting check
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 
                     req.headers.get('cf-connecting-ip') || 
                     'unknown';
    
    if (isRateLimited(clientIp)) {
      console.log(`[lookup-cslb] Rate limited: ${clientIp}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { license_number } = await req.json();

    if (!license_number || typeof license_number !== 'string') {
      return new Response(
        JSON.stringify({ success: false, error: 'License number is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean the license number (remove spaces, dashes)
    const cleanLicense = license_number.replace(/[\s-]/g, '').toUpperCase();

    console.log(`[lookup-cslb] Looking up license: ${cleanLicense}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check cache first
    const { data: cached, error: cacheError } = await supabase
      .from('cslb_cache')
      .select('*')
      .eq('license_number', cleanLicense)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (cached && !cacheError) {
      console.log(`[lookup-cslb] Cache hit for ${cleanLicense}`);
      return new Response(
        JSON.stringify({
          success: true,
          company_name: cached.company_name,
          license_number: cached.license_number,
          license_status: cached.license_status,
          expiration_date: cached.expiration_date,
          city: cached.city,
          state_code: cached.state_code,
          classifications: cached.classifications,
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[lookup-cslb] Cache miss for ${cleanLicense}`);

    // NOTE: CSLB website uses JavaScript rendering which requires a browser or advanced scraping.
    // For MVP, we return a "manual entry required" response.
    // Future enhancement: Integrate Firecrawl or a headless browser service.
    
    // Validate the license number format (California licenses are typically 6-7 digits)
    // Return 200 with skip_enrichment for invalid formats (bulk import needs this to be non-blocking)
    if (!/^\d{5,7}$/.test(cleanLicense)) {
      console.log(`[lookup-cslb] Invalid format, skipping enrichment: ${cleanLicense}`);
      return new Response(
        JSON.stringify({ 
          success: false, 
          skip_enrichment: true,
          manual_entry_required: true,
          reason: 'Invalid license format. California contractor licenses are 5-7 digits.'
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Return a helpful response indicating manual entry is needed
    // We can still provide a link for the user to verify manually
    console.log(`[lookup-cslb] CSLB scraping not available, suggesting manual entry for ${cleanLicense}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: `CSLB auto-lookup is temporarily unavailable. Please verify license #${cleanLicense} at cslb.ca.gov and enter details manually.`,
        manual_entry_required: true,
        verification_url: `https://www.cslb.ca.gov/onlineservices/checklicenseII/LicenseDetail.aspx?LicNum=${cleanLicense}`,
        license_number: cleanLicense,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[lookup-cslb] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: 'Internal server error',
        manual_entry_required: true 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
