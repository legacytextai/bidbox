import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    console.log(`[lookup-cslb] Cache miss, scraping CSLB for ${cleanLicense}`);

    // Scrape CSLB website
    const cslbResult = await scrapeCSLB(cleanLicense);

    if (!cslbResult.success) {
      return new Response(
        JSON.stringify(cslbResult),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map classification codes to trade_type_ids
    const classificationsWithIds: CSLBClassification[] = [];
    
    if (cslbResult.classifications) {
      for (const classification of cslbResult.classifications) {
        const { data: tradeType } = await supabase
          .from('trade_types')
          .select('id, name')
          .eq('code', classification.code)
          .eq('state_code', 'CA')
          .maybeSingle();

        classificationsWithIds.push({
          code: classification.code,
          name: tradeType?.name || classification.name,
          trade_type_id: tradeType?.id || null,
        });
      }
    }

    // Cache the result
    const cacheData = {
      license_number: cleanLicense,
      company_name: cslbResult.company_name,
      license_status: cslbResult.license_status,
      expiration_date: cslbResult.expiration_date,
      city: cslbResult.city,
      state_code: 'CA',
      classifications: classificationsWithIds,
      fetched_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    };

    const { error: upsertError } = await supabase
      .from('cslb_cache')
      .upsert(cacheData, { onConflict: 'license_number' });

    if (upsertError) {
      console.error('[lookup-cslb] Cache upsert error:', upsertError);
    }

    console.log(`[lookup-cslb] Successfully looked up ${cleanLicense}: ${cslbResult.company_name}`);

    return new Response(
      JSON.stringify({
        success: true,
        company_name: cslbResult.company_name,
        license_number: cleanLicense,
        license_status: cslbResult.license_status,
        expiration_date: cslbResult.expiration_date,
        city: cslbResult.city,
        state_code: 'CA',
        classifications: classificationsWithIds,
        cached: false,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[lookup-cslb] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function scrapeCSLB(licenseNumber: string): Promise<CSLBLookupResult> {
  try {
    // CSLB License Lookup URL
    const url = `https://www.cslb.ca.gov/onlineservices/checklicenseII/checklicense.aspx`;
    
    // First, get the page to extract form fields
    const pageResponse = await fetch(url);
    const pageHtml = await pageResponse.text();
    
    // Extract __VIEWSTATE and __EVENTVALIDATION
    const viewStateMatch = pageHtml.match(/id="__VIEWSTATE" value="([^"]+)"/);
    const eventValidationMatch = pageHtml.match(/id="__EVENTVALIDATION" value="([^"]+)"/);
    const viewStateGeneratorMatch = pageHtml.match(/id="__VIEWSTATEGENERATOR" value="([^"]+)"/);
    
    if (!viewStateMatch || !eventValidationMatch) {
      console.log('[lookup-cslb] Could not extract form fields, trying direct API');
      return await tryDirectLookup(licenseNumber);
    }

    // Submit the form
    const formData = new URLSearchParams();
    formData.append('__VIEWSTATE', viewStateMatch[1]);
    formData.append('__EVENTVALIDATION', eventValidationMatch[1]);
    if (viewStateGeneratorMatch) {
      formData.append('__VIEWSTATEGENERATOR', viewStateGeneratorMatch[1]);
    }
    formData.append('LicNum', licenseNumber);
    formData.append('Button1', 'Check License');

    const searchResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const resultHtml = await searchResponse.text();
    
    // Parse the results
    return parseCSLBResult(resultHtml, licenseNumber);

  } catch (error) {
    console.error('[lookup-cslb] Scrape error:', error);
    return await tryDirectLookup(licenseNumber);
  }
}

async function tryDirectLookup(licenseNumber: string): Promise<CSLBLookupResult> {
  try {
    // Try the direct license page
    const directUrl = `https://www.cslb.ca.gov/onlineservices/checklicenseII/LicenseDetail.aspx?LicNum=${licenseNumber}`;
    const response = await fetch(directUrl);
    const html = await response.text();
    
    return parseCSLBResult(html, licenseNumber);
  } catch (error) {
    console.error('[lookup-cslb] Direct lookup error:', error);
    return { success: false, error: 'Failed to lookup license. CSLB may be unavailable.' };
  }
}

function parseCSLBResult(html: string, licenseNumber: string): CSLBLookupResult {
  // Check for "no results" or error messages
  if (html.includes('No contractor was found') || html.includes('Invalid License Number')) {
    return { success: false, error: 'License not found' };
  }

  // Extract business name - look for common patterns
  let companyName = '';
  const businessNamePatterns = [
    /Business Name[:\s]*<[^>]*>([^<]+)/i,
    /class="businessName"[^>]*>([^<]+)/i,
    /<span[^>]*id="[^"]*BusinessName[^"]*"[^>]*>([^<]+)/i,
    /Business\s*(?:Name|Information)[^<]*<[^>]*>([^<]+)/i,
  ];
  
  for (const pattern of businessNamePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      companyName = match[1].trim();
      break;
    }
  }

  // Extract status
  let status = 'UNKNOWN';
  const statusPatterns = [
    /License Status[:\s]*<[^>]*>([^<]+)/i,
    /Status[:\s]*<[^>]*>([^<]+)/i,
    /<span[^>]*id="[^"]*Status[^"]*"[^>]*>([^<]+)/i,
  ];
  
  for (const pattern of statusPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      status = match[1].trim().toUpperCase();
      break;
    }
  }

  // Extract expiration date
  let expirationDate = '';
  const expPatterns = [
    /Expir(?:ation|es)[:\s]*<[^>]*>([^<]+)/i,
    /<span[^>]*id="[^"]*Expir[^"]*"[^>]*>([^<]+)/i,
  ];
  
  for (const pattern of expPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const dateStr = match[1].trim();
      // Try to parse and format the date
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        expirationDate = date.toISOString().split('T')[0];
      }
      break;
    }
  }

  // Extract city
  let city = '';
  const cityPatterns = [
    /City[:\s]*<[^>]*>([^<]+)/i,
    /<span[^>]*id="[^"]*City[^"]*"[^>]*>([^<]+)/i,
  ];
  
  for (const pattern of cityPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      city = match[1].trim();
      break;
    }
  }

  // Extract classifications
  const classifications: { code: string; name: string }[] = [];
  
  // Look for classification patterns like "C-10", "C-20", "A", "B"
  const classPatterns = [
    /Class(?:ification)?[:\s]*([A-Z]-?\d+(?:\s*-\s*[^<]+)?)/gi,
    /([A-Z]-\d+)\s*-\s*([^<,]+)/gi,
    /License Class[:\s]*<[^>]*>([^<]+)/gi,
  ];
  
  const foundCodes = new Set<string>();
  
  for (const pattern of classPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      const fullMatch = match[1] || match[0];
      // Extract just the code (e.g., "C-10" from "C-10 - Electrical")
      const codeMatch = fullMatch.match(/([A-Z]-?\d+)/);
      if (codeMatch && !foundCodes.has(codeMatch[1])) {
        foundCodes.add(codeMatch[1]);
        // Try to extract name after the code
        const nameMatch = fullMatch.match(/[A-Z]-?\d+\s*-\s*(.+)/);
        classifications.push({
          code: codeMatch[1],
          name: nameMatch ? nameMatch[1].trim() : codeMatch[1],
        });
      }
    }
  }

  // If we couldn't extract a company name, the lookup likely failed
  if (!companyName) {
    // Try one more pattern - sometimes the page has a different structure
    const tableMatch = html.match(/<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>License\s*Number/i);
    if (tableMatch && tableMatch[1]) {
      companyName = tableMatch[1].trim();
    }
  }

  if (!companyName) {
    return { 
      success: false, 
      error: 'Could not parse license information. The license may not exist or CSLB website structure may have changed.' 
    };
  }

  const classificationsWithNull: CSLBClassification[] = classifications.map(c => ({
    ...c,
    trade_type_id: null,
  }));

  return {
    success: true,
    company_name: companyName,
    license_number: licenseNumber,
    license_status: status,
    expiration_date: expirationDate || undefined,
    city: city || undefined,
    state_code: 'CA',
    classifications: classificationsWithNull.length > 0 ? classificationsWithNull : undefined,
  };
}
