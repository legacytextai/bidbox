import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// C-10 Electrical Contractor - Hardcoded for proof of concept
const CLASSIFICATION_CODE = 'C-10';
const C10_TRADE_TYPE_ID = '3018f1f2-13b8-4aa8-85d9-49ba85307162';

interface CSLBContractor {
  license_number: string;
  company_name: string;
  city: string | null;
  phone: string | null;
  license_status: string;
}

interface IngestionStats {
  total_rows_parsed: number;
  active_contractors: number;
  inserted: number;
  updated: number;
  mappings_created: number;
  errors: number;
  error_details: string[];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const stats: IngestionStats = {
    total_rows_parsed: 0,
    active_contractors: 0,
    inserted: 0,
    updated: 0,
    mappings_created: 0,
    errors: 0,
    error_details: [],
  };

  console.log(`[cslb-ingest-c10] Starting C-10 ingestion...`);
  console.log(`[cslb-ingest-c10] Trade Type ID: ${C10_TRADE_TYPE_ID}`);

  try {
    // Initialize Supabase client with service role key for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const firecrawlApiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!firecrawlApiKey) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Use Firecrawl to scrape the CSLB portal and get form fields
    console.log(`[cslb-ingest-c10] Fetching CSLB page for classification: ${CLASSIFICATION_CODE}`);
    
    // Use rawHtml format to get the unprocessed HTML with ASP.NET form fields
    const pageResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: 'https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification',
        formats: ['rawHtml'],
        waitFor: 3000,
      }),
    });

    if (!pageResponse.ok) {
      throw new Error(`Failed to fetch CSLB page: ${await pageResponse.text()}`);
    }

    const pageData = await pageResponse.json();
    const html = pageData.data?.rawHtml || pageData.rawHtml || pageData.data?.html || pageData.html || '';
    
    console.log(`[cslb-ingest-c10] Got CSLB page HTML (${html.length} chars)`);
    
    // Extract ASP.NET form fields - try multiple patterns
    const viewstateMatch = html.match(/id="__VIEWSTATE"\s+value="([^"]+)"/i) || 
                           html.match(/name="__VIEWSTATE"\s+value="([^"]+)"/i) ||
                           html.match(/__VIEWSTATE['"]\s*(value|content)=['"]([\w/+=]+)['"]/i);
    
    const viewstateGeneratorMatch = html.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/i) ||
                                     html.match(/name="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/i);
    
    const eventValidationMatch = html.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/i) ||
                                  html.match(/name="__EVENTVALIDATION"\s+value="([^"]+)"/i);
    
    if (!viewstateMatch) {
      // Log more of the HTML to understand its structure
      console.log(`[cslb-ingest-c10] Could not extract __VIEWSTATE from page`);
      console.log(`[cslb-ingest-c10] Looking for hidden inputs...`);
      
      // Try to find any hidden input fields
      const hiddenInputs = html.match(/<input[^>]*type=['"](hidden)['""][^>]*>/gi) || [];
      console.log(`[cslb-ingest-c10] Found ${hiddenInputs.length} hidden inputs`);
      if (hiddenInputs.length > 0) {
        console.log(`[cslb-ingest-c10] First hidden input: ${hiddenInputs[0]}`);
      }
      
      // Check if we got JavaScript-rendered content
      if (html.includes('aspNetHidden')) {
        console.log(`[cslb-ingest-c10] Page contains aspNetHidden div but fields may be empty`);
      }
      
      // Try direct HTTP request to CSLB without Firecrawl
      console.log(`[cslb-ingest-c10] Trying direct HTTP request to CSLB...`);
      
      const directPageResponse = await fetch('https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification', {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      });

      if (!directPageResponse.ok) {
        throw new Error(`Direct CSLB request failed: ${directPageResponse.status}`);
      }

      const directHtml = await directPageResponse.text();
      console.log(`[cslb-ingest-c10] Direct request got ${directHtml.length} chars`);
      
      // Extract form fields from direct response
      const directViewstate = directHtml.match(/id="__VIEWSTATE"\s+value="([^"]+)"/i);
      const directViewstateGen = directHtml.match(/id="__VIEWSTATEGENERATOR"\s+value="([^"]+)"/i);
      const directEventVal = directHtml.match(/id="__EVENTVALIDATION"\s+value="([^"]+)"/i);
      
      if (!directViewstate) {
        console.log(`[cslb-ingest-c10] Still no VIEWSTATE. Checking HTML structure...`);
        console.log(`[cslb-ingest-c10] Contains form: ${directHtml.includes('<form')}`);
        console.log(`[cslb-ingest-c10] Contains VIEWSTATE string: ${directHtml.includes('VIEWSTATE')}`);
        
        // Sample the area around aspNetHidden
        const aspNetIdx = directHtml.indexOf('aspNetHidden');
        if (aspNetIdx > -1) {
          console.log(`[cslb-ingest-c10] aspNetHidden context: ${directHtml.substring(aspNetIdx, aspNetIdx + 500)}`);
        }
        
        throw new Error('Could not extract ASP.NET form fields from CSLB page');
      }
      
      console.log(`[cslb-ingest-c10] Got form fields from direct request`);
      console.log(`[cslb-ingest-c10] VIEWSTATE length: ${directViewstate[1].length}`);
      
      // Build and submit the form POST
      const formData = new URLSearchParams();
      formData.append('__VIEWSTATE', directViewstate[1]);
      if (directViewstateGen) {
        formData.append('__VIEWSTATEGENERATOR', directViewstateGen[1]);
      }
      if (directEventVal) {
        formData.append('__EVENTVALIDATION', directEventVal[1]);
      }
      formData.append('ctl00$MainContent$lbClassification', 'C-10');
      formData.append('ctl00$MainContent$btnDownload', 'Download');

      console.log(`[cslb-ingest-c10] Submitting form POST to CSLB...`);
      
      const downloadResponse = await fetch('https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/vnd.ms-excel,text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Origin': 'https://www.cslb.ca.gov',
          'Referer': 'https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification',
        },
        body: formData.toString(),
      });

      console.log(`[cslb-ingest-c10] Form POST response status: ${downloadResponse.status}`);
      console.log(`[cslb-ingest-c10] Content-Type: ${downloadResponse.headers.get('content-type')}`);
      console.log(`[cslb-ingest-c10] Content-Disposition: ${downloadResponse.headers.get('content-disposition')}`);

      const contentType = downloadResponse.headers.get('content-type') || '';
      const contentDisposition = downloadResponse.headers.get('content-disposition') || '';
      
      if (contentType.includes('application/vnd.ms-excel') || 
          contentType.includes('application/octet-stream') ||
          contentType.includes('spreadsheet') ||
          contentDisposition.includes('.xls')) {
        // Got the Excel file!
        const xlsBuffer = await downloadResponse.arrayBuffer();
        console.log(`[cslb-ingest-c10] Received XLS file: ${xlsBuffer.byteLength} bytes`);
        
        // Parse and process the Excel file
        const contractors = parseExcelFile(new Uint8Array(xlsBuffer), stats);
        await upsertContractors(supabase, contractors, stats);
      } else {
        // Got HTML response instead of file
        const responseText = await downloadResponse.text();
        console.log(`[cslb-ingest-c10] Unexpected response type: ${contentType}`);
        console.log(`[cslb-ingest-c10] Response length: ${responseText.length}`);
        console.log(`[cslb-ingest-c10] Response preview: ${responseText.substring(0, 500)}`);
        
        throw new Error(`Expected Excel file but got ${contentType}`);
      }
    } else {
      // We got VIEWSTATE from Firecrawl, use it
      const viewstate = viewstateMatch[1] || viewstateMatch[2];
      console.log(`[cslb-ingest-c10] Extracted VIEWSTATE (${viewstate.length} chars)`);
      
      const formData = new URLSearchParams();
      formData.append('__VIEWSTATE', viewstate);
      if (viewstateGeneratorMatch) {
        formData.append('__VIEWSTATEGENERATOR', viewstateGeneratorMatch[1]);
      }
      if (eventValidationMatch) {
        formData.append('__EVENTVALIDATION', eventValidationMatch[1]);
      }
      formData.append('ctl00$MainContent$lbClassification', 'C-10');
      formData.append('ctl00$MainContent$btnDownload', 'Download');

      console.log(`[cslb-ingest-c10] Submitting form POST to CSLB...`);
      
      const downloadResponse = await fetch('https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/vnd.ms-excel,text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.5',
          'Origin': 'https://www.cslb.ca.gov',
          'Referer': 'https://www.cslb.ca.gov/onlineservices/dataportal/ListByClassification',
        },
        body: formData.toString(),
      });

      console.log(`[cslb-ingest-c10] Form POST response status: ${downloadResponse.status}`);
      console.log(`[cslb-ingest-c10] Content-Type: ${downloadResponse.headers.get('content-type')}`);

      const contentType = downloadResponse.headers.get('content-type') || '';
      const contentDisposition = downloadResponse.headers.get('content-disposition') || '';
      
      if (contentType.includes('application/vnd.ms-excel') || 
          contentType.includes('application/octet-stream') ||
          contentDisposition.includes('.xls')) {
        const xlsBuffer = await downloadResponse.arrayBuffer();
        console.log(`[cslb-ingest-c10] Received XLS file: ${xlsBuffer.byteLength} bytes`);
        
        const contractors = parseExcelFile(new Uint8Array(xlsBuffer), stats);
        await upsertContractors(supabase, contractors, stats);
      } else {
        const responseText = await downloadResponse.text();
        console.log(`[cslb-ingest-c10] Unexpected response type: ${contentType}`);
        console.log(`[cslb-ingest-c10] Response preview: ${responseText.substring(0, 500)}`);
        
        throw new Error(`Expected Excel file but got ${contentType}`);
      }
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[cslb-ingest-c10] Error: ${errorMessage}`);
    stats.errors++;
    stats.error_details.push(errorMessage);
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage,
      stats,
      duration_seconds: (Date.now() - startTime) / 1000,
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`[cslb-ingest-c10] Complete! Summary:`);
  console.log(`  - Total rows parsed: ${stats.total_rows_parsed}`);
  console.log(`  - Active contractors: ${stats.active_contractors}`);
  console.log(`  - New contractors inserted: ${stats.inserted}`);
  console.log(`  - Existing contractors updated: ${stats.updated}`);
  console.log(`  - Trade mappings created: ${stats.mappings_created}`);
  console.log(`  - Errors: ${stats.errors}`);
  console.log(`  - Duration: ${duration.toFixed(2)} seconds`);

  return new Response(JSON.stringify({
    success: true,
    classification: CLASSIFICATION_CODE,
    stats,
    duration_seconds: duration,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

function parseExcelFile(buffer: Uint8Array, stats: IngestionStats): CSLBContractor[] {
  console.log(`[cslb-ingest-c10] Parsing Excel file...`);
  
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Convert to JSON with header row
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  
  stats.total_rows_parsed = rows.length;
  console.log(`[cslb-ingest-c10] Parsed ${rows.length} rows from Excel`);
  
  if (rows.length > 0) {
    console.log(`[cslb-ingest-c10] Sample row keys: ${Object.keys(rows[0]).join(', ')}`);
    console.log(`[cslb-ingest-c10] Sample row: ${JSON.stringify(rows[0])}`);
  }
  
  const contractors: CSLBContractor[] = [];
  
  for (const row of rows) {
    // Try to find license number column (various possible names)
    const licenseNumber = String(
      row['License Number'] || 
      row['LICENSE NUMBER'] || 
      row['LicenseNumber'] || 
      row['license_number'] ||
      row['Lic #'] ||
      ''
    ).trim();
    
    // Try to find status column
    const status = String(
      row['License Status'] || 
      row['LICENSE STATUS'] || 
      row['Status'] || 
      row['STATUS'] ||
      ''
    ).trim().toUpperCase();
    
    // Only process ACTIVE licenses
    if (!licenseNumber || status !== 'ACTIVE') {
      continue;
    }
    
    // Extract other fields
    const companyName = String(
      row['Business Name'] || 
      row['BUSINESS NAME'] || 
      row['Company Name'] ||
      row['COMPANY NAME'] ||
      row['Name'] ||
      ''
    ).trim();
    
    const city = String(
      row['City'] || 
      row['CITY'] || 
      row['Business City'] ||
      ''
    ).trim() || null;
    
    const phone = normalizePhone(String(
      row['Phone'] || 
      row['PHONE'] || 
      row['Business Phone'] ||
      row['Phone Number'] ||
      ''
    ).trim());
    
    if (companyName) {
      contractors.push({
        license_number: licenseNumber,
        company_name: companyName,
        city,
        phone,
        license_status: 'ACTIVE',
      });
    }
  }
  
  stats.active_contractors = contractors.length;
  console.log(`[cslb-ingest-c10] Filtered to ${contractors.length} ACTIVE contractors`);
  
  return contractors;
}

function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone; // Return original if can't normalize
}

async function upsertContractors(
  supabase: any,
  contractors: CSLBContractor[],
  stats: IngestionStats
): Promise<void> {
  console.log(`[cslb-ingest-c10] Upserting ${contractors.length} contractors...`);
  
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(contractors.length / BATCH_SIZE);
  
  for (let i = 0; i < contractors.length; i += BATCH_SIZE) {
    const batch = contractors.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    
    console.log(`[cslb-ingest-c10] Processing batch ${batchNum}/${totalBatches} (${batch.length} contractors)...`);
    
    for (const contractor of batch) {
      try {
        // Check if contractor exists
        const { data: existing } = await supabase
          .from('subcontractors')
          .select('id')
          .eq('license_number', contractor.license_number)
          .single();
        
        let subcontractorId: string;
        
        if (existing) {
          // Update existing
          const { error: updateError } = await supabase
            .from('subcontractors')
            .update({
              company_name: contractor.company_name,
              city: contractor.city,
              phone: contractor.phone,
              license_status: contractor.license_status,
              state_code: 'CA',
              is_verified: true,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          
          if (updateError) {
            throw updateError;
          }
          
          subcontractorId = existing.id;
          stats.updated++;
        } else {
          // Insert new
          const { data: inserted, error: insertError } = await supabase
            .from('subcontractors')
            .insert({
              license_number: contractor.license_number,
              company_name: contractor.company_name,
              city: contractor.city,
              phone: contractor.phone,
              license_status: contractor.license_status,
              state_code: 'CA',
              is_verified: true,
            })
            .select('id')
            .single();
          
          if (insertError) {
            throw insertError;
          }
          
          subcontractorId = inserted.id;
          stats.inserted++;
        }
        
        // Ensure trade mapping exists for C-10
        const { data: existingMapping } = await supabase
          .from('sub_trade_mappings')
          .select('id')
          .eq('sub_id', subcontractorId)
          .eq('trade_type_id', C10_TRADE_TYPE_ID)
          .single();
        
        if (!existingMapping) {
          const { error: mappingError } = await supabase
            .from('sub_trade_mappings')
            .insert({
              sub_id: subcontractorId,
              trade_type_id: C10_TRADE_TYPE_ID,
            });
          
          if (mappingError) {
            console.error(`[cslb-ingest-c10] Mapping error for ${contractor.license_number}: ${mappingError.message}`);
          } else {
            stats.mappings_created++;
          }
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[cslb-ingest-c10] Error processing ${contractor.license_number}: ${errorMessage}`);
        stats.errors++;
        if (stats.error_details.length < 10) {
          stats.error_details.push(`${contractor.license_number}: ${errorMessage}`);
        }
      }
    }
  }
  
  console.log(`[cslb-ingest-c10] Upsert complete`);
}
