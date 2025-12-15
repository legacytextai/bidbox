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
  trade_type_ids?: string[];
  error?: string;
  cached?: boolean;
  manual_entry_required?: boolean;
  skip_enrichment?: boolean;
  reason?: string;
}

/**
 * Normalize CSLB classification code to match trade_types format
 * "C10" → "C-10", "C-10" → "C-10", "A" → "A", "B" → "B"
 */
function normalizeCSLBCode(rawCode: string): string {
  const cleaned = rawCode.trim().toUpperCase();
  // Match pattern like "C10", "C-10", "A", "B", "C61/D21"
  const match = cleaned.match(/^([ABC])(-?)(\d+)?/);
  if (match) {
    const letter = match[1];
    const number = match[3];
    return number ? `${letter}-${number}` : letter;
  }
  return cleaned;
}

/**
 * Parse license status text to a normalized value
 */
function parseStatus(statusText: string): string {
  const lower = statusText.toLowerCase();
  if (lower.includes('current') && lower.includes('active')) return 'active';
  if (lower.includes('expired')) return 'expired';
  if (lower.includes('inactive')) return 'inactive';
  if (lower.includes('suspended')) return 'suspended';
  if (lower.includes('revoked')) return 'revoked';
  return 'unknown';
}

/**
 * Parse date from CSLB format (MM/DD/YYYY) to ISO format (YYYY-MM-DD)
 */
function parseDate(dateText: string): string | null {
  const match = dateText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extract text content from HTML by finding content between specific patterns
 * Handles nested tags and different closing elements (td, span, div)
 */
function extractById(html: string, id: string): string | null {
  // Look for element with the given id - capture everything up to closing tag
  const patterns = [
    new RegExp(`id="${id}"[^>]*>([\\s\\S]*?)<\\/(?:td|span|div)>`, 'i'),
    new RegExp(`id='${id}'[^>]*>([\\s\\S]*?)<\\/(?:td|span|div)>`, 'i'),
  ];
  
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      // Strip HTML tags and return plain text
      return match[1].replace(/<[^>]+>/g, '').trim();
    }
  }
  return null;
}

/**
 * Extract classifications from the CSLB page
 * Classifications appear in a table with links like "C10 - ELECTRICAL"
 */
function extractClassifications(html: string): { code: string; name: string }[] {
  const classifications: { code: string; name: string }[] = [];
  
  // Look for the classification table section
  // Classifications appear as links in format: "C10 - ELECTRICAL" or "C-10 - ELECTRICAL"
  const classRegex = /<a[^>]*>([ABC]-?\d*)\s*-\s*([^<]+)<\/a>/gi;
  let match;
  
  while ((match = classRegex.exec(html)) !== null) {
    const rawCode = match[1].trim();
    const name = match[2].trim();
    const code = normalizeCSLBCode(rawCode);
    
    // Avoid duplicates
    if (!classifications.find(c => c.code === code)) {
      classifications.push({ code, name });
    }
  }
  
  // Also try to find classifications in plain text format (backup)
  if (classifications.length === 0) {
    const plainRegex = /([ABC]-?\d+)\s*-\s*([A-Z][A-Z\s&\/]+)/g;
    while ((match = plainRegex.exec(html)) !== null) {
      const rawCode = match[1].trim();
      const name = match[2].trim();
      const code = normalizeCSLBCode(rawCode);
      
      if (!classifications.find(c => c.code === code)) {
        classifications.push({ code, name });
      }
    }
  }
  
  return classifications;
}

/**
 * Extract company name and city from business info section
 */
function extractBusinessInfo(html: string): { companyName: string | null; city: string | null } {
  let companyName: string | null = null;
  let city: string | null = null;
  
  // Try to find the business name section - CSLB uses <td> elements
  // Pattern matches: id="MainContent_BusInfo"...>CONTENT</td>
  const busInfoMatch = html.match(/id="MainContent_BusInfo"[^>]*>([\s\S]*?)<\/td>/i);
  if (busInfoMatch) {
    const content = busInfoMatch[1];
    // First line is usually company name, before <br>
    const lines = content.split(/<br\s*\/?>/i);
    if (lines[0]) {
      companyName = lines[0].replace(/<[^>]+>/g, '').trim();
    }
    // City is usually in the address line (City, ST ZIP format)
    for (const line of lines) {
      const cityMatch = line.match(/([A-Z][A-Za-z\s]+),\s*CA\s+\d{5}/i);
      if (cityMatch) {
        city = cityMatch[1].trim();
        break;
      }
    }
  }
  
  // Fallback: look for business name in other locations
  if (!companyName) {
    const nameMatch = html.match(/Business Name[:\s]*<\/td>\s*<td[^>]*>([^<]+)/i);
    if (nameMatch) {
      companyName = nameMatch[1].trim();
    }
  }
  
  return { companyName, city };
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
        JSON.stringify({ success: false, error: 'License number is required', skip_enrichment: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean the license number (remove spaces, dashes)
    const cleanLicense = license_number.replace(/[\s-]/g, '').toUpperCase();

    // Validate format - California licenses are typically 5-7 digits
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
      
      // Extract trade_type_ids from cached classifications
      const tradeTypeIds = (cached.classifications as CSLBClassification[] || [])
        .filter(c => c.trade_type_id)
        .map(c => c.trade_type_id as string);
      
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
          trade_type_ids: tradeTypeIds,
          cached: true,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[lookup-cslb] Cache miss for ${cleanLicense}, fetching from CSLB...`);

    // Fetch from CSLB website using Firecrawl (CSLB blocks direct server-side fetch)
    const cslbUrl = `https://www.cslb.ca.gov/onlineservices/checklicenseII/LicenseDetail.aspx?LicNum=${cleanLicense}`;
    
    let html: string;
    try {
      const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');
      if (!firecrawlApiKey) {
        console.error(`[lookup-cslb] FIRECRAWL_API_KEY not configured`);
        return new Response(
          JSON.stringify({
            success: false,
            skip_enrichment: true,
            manual_entry_required: true,
            reason: 'CSLB lookup service not configured',
            verification_url: cslbUrl,
            license_number: cleanLicense,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log(`[lookup-cslb] Fetching CSLB page via Firecrawl: ${cslbUrl}`);
      
      const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: cslbUrl,
          formats: ['html'],
          waitFor: 2000,
        }),
      });

      if (!firecrawlResponse.ok) {
        const errorText = await firecrawlResponse.text();
        console.error(`[lookup-cslb] Firecrawl error: ${firecrawlResponse.status} - ${errorText}`);
        return new Response(
          JSON.stringify({
            success: false,
            skip_enrichment: true,
            manual_entry_required: true,
            reason: 'Failed to fetch CSLB page',
            verification_url: cslbUrl,
            license_number: cleanLicense,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const firecrawlData = await firecrawlResponse.json();
      
      // Firecrawl returns data nested in data.html
      html = firecrawlData.data?.html || firecrawlData.html || '';
      
      if (!html) {
        console.error(`[lookup-cslb] Firecrawl returned no HTML content`);
        return new Response(
          JSON.stringify({
            success: false,
            skip_enrichment: true,
            manual_entry_required: true,
            reason: 'Could not retrieve CSLB page content',
            verification_url: cslbUrl,
            license_number: cleanLicense,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      console.log(`[lookup-cslb] Received ${html.length} bytes of HTML from Firecrawl`);
    } catch (fetchError) {
      console.error(`[lookup-cslb] Firecrawl fetch error:`, fetchError);
      return new Response(
        JSON.stringify({
          success: false,
          skip_enrichment: true,
          manual_entry_required: true,
          reason: 'Failed to connect to CSLB lookup service',
          verification_url: cslbUrl,
          license_number: cleanLicense,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if license was not found
    if (html.includes('was not found') || html.includes('No record found') || html.includes('License Number Not Found')) {
      console.log(`[lookup-cslb] License not found: ${cleanLicense}`);
      return new Response(
        JSON.stringify({
          success: false,
          skip_enrichment: true,
          manual_entry_required: true,
          reason: 'License number not found in CSLB database',
          verification_url: cslbUrl,
          license_number: cleanLicense,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[lookup-cslb] Parsing CSLB page for ${cleanLicense}...`);
    console.log(`[lookup-cslb] HTML preview (first 500 chars): ${html.substring(0, 500).replace(/\n/g, ' ')}`);
    console.log(`[lookup-cslb] HTML contains BusInfo: ${html.includes('MainContent_BusInfo')}, Status: ${html.includes('MainContent_Status')}, ClassTable: ${html.includes('MainContent_ClassCellTable')}`);

    // Extract data from HTML
    const { companyName, city } = extractBusinessInfo(html);
    const statusText = extractById(html, 'MainContent_Status') || '';
    const expirationText = extractById(html, 'MainContent_ExpDt') || '';
    const rawClassifications = extractClassifications(html);
    
    const licenseStatus = parseStatus(statusText);
    const expirationDate = parseDate(expirationText);

    console.log(`[lookup-cslb] Extracted: company=${companyName}, status=${licenseStatus}, exp=${expirationDate}, classifications=${rawClassifications.length}`);

    // Map classification codes to trade_type_ids
    const classificationCodes = rawClassifications.map(c => c.code);
    let classifications: CSLBClassification[] = [];
    let tradeTypeIds: string[] = [];

    if (classificationCodes.length > 0) {
      const { data: tradeTypes, error: tradeError } = await supabase
        .from('trade_types')
        .select('id, code, name')
        .eq('state_code', 'CA')
        .in('code', classificationCodes);

      if (tradeError) {
        console.error(`[lookup-cslb] Error fetching trade types:`, tradeError);
      }

      // Build classifications with trade_type_ids
      classifications = rawClassifications.map(raw => {
        const tradeType = tradeTypes?.find(t => t.code === raw.code);
        return {
          code: raw.code,
          name: raw.name,
          trade_type_id: tradeType?.id || null,
        };
      });

      tradeTypeIds = classifications
        .filter(c => c.trade_type_id)
        .map(c => c.trade_type_id as string);

      console.log(`[lookup-cslb] Mapped ${tradeTypeIds.length} trade_type_ids from ${classifications.length} classifications`);
    }

    // Validate we got at least some useful data
    if (!companyName && classifications.length === 0) {
      console.log(`[lookup-cslb] Could not parse useful data from CSLB page for ${cleanLicense}`);
      return new Response(
        JSON.stringify({
          success: false,
          skip_enrichment: true,
          manual_entry_required: true,
          reason: 'Could not parse license details from CSLB page',
          verification_url: cslbUrl,
          license_number: cleanLicense,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Cache the result
    const cacheData = {
      license_number: cleanLicense,
      company_name: companyName,
      license_status: licenseStatus,
      expiration_date: expirationDate,
      city: city,
      state_code: 'CA',
      classifications: classifications,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    };

    const { error: insertError } = await supabase
      .from('cslb_cache')
      .upsert(cacheData, { onConflict: 'license_number' });

    if (insertError) {
      console.error(`[lookup-cslb] Cache insert error:`, insertError);
      // Continue anyway, caching is not critical
    } else {
      console.log(`[lookup-cslb] Cached result for ${cleanLicense}`);
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        company_name: companyName,
        license_number: cleanLicense,
        license_status: licenseStatus,
        expiration_date: expirationDate,
        city: city,
        state_code: 'CA',
        classifications: classifications,
        trade_type_ids: tradeTypeIds,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[lookup-cslb] Error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        skip_enrichment: true,
        manual_entry_required: true,
        reason: 'Internal server error'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
