import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Processing configuration
const BATCH_SIZE = 1000; // Rows per batch for DB operations
const MAX_ROWS_PER_INVOCATION = 50000; // Chunked execution limit

// CSLB Portal page - CSV URL must be discovered via browser network tab
// The actual download URL is dynamic and session-based
const CSLB_PORTAL_URL = 'https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList';

interface IngestionStats {
  rows_parsed: number;
  rows_active: number;
  rows_inserted: number;
  rows_updated: number;
  mappings_created: number;
  mappings_deleted: number;
  errors: number;
  error_details: string[];
  start_time: number;
  end_time?: number;
  offset_used: number;
  next_offset?: number;
  is_complete: boolean;
}

interface CSLBContractor {
  license_number: string;
  company_name: string;
  city: string | null;
  county: string | null;
  phone: string | null;
  license_status: string;
  last_cslb_update: string | null;
  classifications: string[];
}

// Normalize phone number to standard format
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone.trim() || null;
}

// Parse CSV line handling quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

// Parse classifications from semicolon-delimited string
function parseClassifications(classificationsStr: string): string[] {
  if (!classificationsStr) return [];
  
  return classificationsStr
    .split(';')
    .map(c => c.trim())
    .filter(c => c.length > 0)
    .map(c => {
      // Normalize D-codes: "C-61/D-64" → "D-64"
      if (c.includes('/')) {
        const parts = c.split('/');
        const dCode = parts.find(p => p.startsWith('D-'));
        if (dCode) return dCode;
      }
      return c;
    });
}

// Map a CSV row to contractor data
function mapRowToContractor(fields: string[], headers: Map<string, number>): CSLBContractor | null {
  const get = (name: string): string => {
    const idx = headers.get(name);
    return idx !== undefined && idx < fields.length ? fields[idx] : '';
  };
  
  const licenseNumber = get('LicenseNo') || get('LICENSE_NBR') || get('LICNBR');
  const licenseStatus = get('LicenseStatus') || get('LICENSE_STATUS') || get('STATUS');
  
  if (!licenseNumber) return null;
  
  // Only process ACTIVE licenses
  if (licenseStatus.toUpperCase() !== 'ACTIVE') return null;
  
  const classificationsRaw = get('Classifications') || get('CLASSIFICATION') || get('CLASS');
  
  return {
    license_number: licenseNumber.trim(),
    company_name: (get('BusinessName') || get('BUSINESS_NAME') || get('NAME') || 'Unknown').trim(),
    city: get('City') || get('CITY') || null,
    county: get('County') || get('COUNTY') || null,
    phone: normalizePhone(get('BusinessPhone') || get('PHONE') || get('BUSPHONE')),
    license_status: licenseStatus.toUpperCase(),
    last_cslb_update: get('LastUpdate') || get('LAST_UPDATE') || null,
    classifications: parseClassifications(classificationsRaw),
  };
}

// Batch upsert contractors into subcontractors table
async function batchUpsertContractors(
  supabase: any,
  contractors: CSLBContractor[],
  stats: IngestionStats
): Promise<Map<string, string>> {
  const licenseToIdMap = new Map<string, string>();
  
  if (contractors.length === 0) return licenseToIdMap;
  
  // Prepare upsert data
  const upsertData = contractors.map(c => ({
    license_number: c.license_number,
    company_name: c.company_name,
    city: c.city,
    county: c.county,
    phone: c.phone,
    license_status: c.license_status,
    state_code: 'CA',
    is_verified: true,
    last_cslb_update: c.last_cslb_update ? new Date(c.last_cslb_update).toISOString() : null,
    updated_at: new Date().toISOString(),
  }));
  
  // Perform batch upsert
  const { data, error } = await supabase
    .from('subcontractors')
    .upsert(upsertData, { 
      onConflict: 'license_number',
      ignoreDuplicates: false 
    })
    .select('id, license_number');
  
  if (error) {
    console.error('[cslb-ingest-master] Batch upsert error:', error.message);
    stats.errors++;
    stats.error_details.push(`Batch upsert: ${error.message}`);
    return licenseToIdMap;
  }
  
  // Build license → id map for classification mapping
  if (data) {
    for (const row of data) {
      licenseToIdMap.set(row.license_number, row.id);
    }
    stats.rows_inserted += data.length;
  }
  
  return licenseToIdMap;
}

// Batch process classification mappings
async function batchProcessMappings(
  supabase: any,
  contractors: CSLBContractor[],
  licenseToIdMap: Map<string, string>,
  tradeTypeCache: Map<string, string>,
  stats: IngestionStats
): Promise<void> {
  // Collect all sub_ids that need mapping updates
  const subIds = contractors
    .map(c => licenseToIdMap.get(c.license_number))
    .filter((id): id is string => !!id);
  
  if (subIds.length === 0) return;
  
  // Batch delete existing mappings for all contractors in this batch
  const { error: deleteError } = await supabase
    .from('sub_trade_mappings')
    .delete()
    .in('sub_id', subIds);
  
  if (deleteError) {
    console.error('[cslb-ingest-master] Batch delete mappings error:', deleteError.message);
    stats.errors++;
    stats.error_details.push(`Batch delete mappings: ${deleteError.message}`);
    return;
  }
  
  stats.mappings_deleted += subIds.length; // Approximate
  
  // Prepare all new mappings
  const mappingsToInsert: { sub_id: string; trade_type_id: string }[] = [];
  
  for (const contractor of contractors) {
    const subId = licenseToIdMap.get(contractor.license_number);
    if (!subId) continue;
    
    for (const code of contractor.classifications) {
      const tradeTypeId = tradeTypeCache.get(code);
      if (tradeTypeId) {
        mappingsToInsert.push({ sub_id: subId, trade_type_id: tradeTypeId });
      }
    }
  }
  
  if (mappingsToInsert.length === 0) return;
  
  // Batch insert new mappings
  const { error: insertError } = await supabase
    .from('sub_trade_mappings')
    .insert(mappingsToInsert);
  
  if (insertError) {
    console.error('[cslb-ingest-master] Batch insert mappings error:', insertError.message);
    stats.errors++;
    stats.error_details.push(`Batch insert mappings: ${insertError.message}`);
    return;
  }
  
  stats.mappings_created += mappingsToInsert.length;
}

// Load trade types into cache for fast lookup
async function loadTradeTypeCache(
  supabase: any
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  
  const { data, error } = await supabase
    .from('trade_types')
    .select('id, code')
    .eq('is_active', true);
  
  if (error) {
    console.error('[cslb-ingest-master] Failed to load trade types:', error.message);
    return cache;
  }
  
  if (data) {
    for (const row of data) {
      cache.set(row.code, row.id);
    }
  }
  
  console.log(`[cslb-ingest-master] Loaded ${cache.size} trade types into cache`);
  return cache;
}

// Main ingestion function
async function processCSVIngestion(
  supabase: any,
  csvUrl: string,
  offset: number = 0
): Promise<IngestionStats> {
  const stats: IngestionStats = {
    rows_parsed: 0,
    rows_active: 0,
    rows_inserted: 0,
    rows_updated: 0,
    mappings_created: 0,
    mappings_deleted: 0,
    errors: 0,
    error_details: [],
    start_time: Date.now(),
    offset_used: offset,
    is_complete: false,
  };
  
  console.log(`[cslb-ingest-master] Starting ingestion from offset ${offset}`);
  
  // Load trade types for classification mapping
  const tradeTypeCache = await loadTradeTypeCache(supabase);
  
  // Fetch CSV directly
  console.log(`[cslb-ingest-master] Fetching CSV from ${csvUrl}`);
  
  const response = await fetch(csvUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/csv,application/csv,*/*',
    },
  });
  
  if (!response.ok) {
    const errorMsg = `Failed to fetch CSV: ${response.status} ${response.statusText}`;
    console.error(`[cslb-ingest-master] ${errorMsg}`);
    stats.errors++;
    stats.error_details.push(errorMsg);
    stats.end_time = Date.now();
    return stats;
  }
  
  console.log(`[cslb-ingest-master] CSV response received, processing...`);
  
  // Stream and parse CSV
  const reader = response.body?.getReader();
  if (!reader) {
    stats.errors++;
    stats.error_details.push('No response body reader available');
    stats.end_time = Date.now();
    return stats;
  }
  
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let headers: Map<string, number> | null = null;
  let currentBatch: CSLBContractor[] = [];
  let lineNumber = 0;
  let processedInThisRun = 0;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process remaining buffer
        if (buffer.trim()) {
          const fields = parseCSVLine(buffer);
          if (headers) {
            const contractor = mapRowToContractor(fields, headers);
            if (contractor) {
              stats.rows_active++;
              currentBatch.push(contractor);
            }
          }
          stats.rows_parsed++;
          lineNumber++;
        }
        break;
      }
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        lineNumber++;
        
        // Skip lines before offset
        if (lineNumber <= offset) continue;
        
        // Check if we've hit the per-invocation limit
        if (processedInThisRun >= MAX_ROWS_PER_INVOCATION) {
          stats.next_offset = lineNumber;
          console.log(`[cslb-ingest-master] Reached limit, next_offset: ${lineNumber}`);
          break;
        }
        
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        const fields = parseCSVLine(trimmedLine);
        
        // First line is headers
        if (!headers) {
          headers = new Map();
          fields.forEach((field, idx) => {
            headers!.set(field.trim(), idx);
          });
          console.log(`[cslb-ingest-master] Headers: ${Array.from(headers.keys()).join(', ')}`);
          continue;
        }
        
        stats.rows_parsed++;
        processedInThisRun++;
        
        const contractor = mapRowToContractor(fields, headers);
        if (contractor) {
          stats.rows_active++;
          currentBatch.push(contractor);
        }
        
        // Process batch when full
        if (currentBatch.length >= BATCH_SIZE) {
          console.log(`[cslb-ingest-master] Processing batch of ${currentBatch.length} contractors...`);
          const licenseToIdMap = await batchUpsertContractors(supabase, currentBatch, stats);
          await batchProcessMappings(supabase, currentBatch, licenseToIdMap, tradeTypeCache, stats);
          currentBatch = [];
        }
      }
      
      // Check if we hit the limit during line processing
      if (stats.next_offset) break;
    }
    
    // Process final batch
    if (currentBatch.length > 0) {
      console.log(`[cslb-ingest-master] Processing final batch of ${currentBatch.length} contractors...`);
      const licenseToIdMap = await batchUpsertContractors(supabase, currentBatch, stats);
      await batchProcessMappings(supabase, currentBatch, licenseToIdMap, tradeTypeCache, stats);
    }
    
    stats.is_complete = !stats.next_offset;
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[cslb-ingest-master] Processing error: ${errorMsg}`);
    stats.errors++;
    stats.error_details.push(`Processing: ${errorMsg}`);
  }
  
  stats.end_time = Date.now();
  const duration = ((stats.end_time - stats.start_time) / 1000).toFixed(2);
  
  console.log(`[cslb-ingest-master] Ingestion complete!`);
  console.log(`  - Duration: ${duration}s`);
  console.log(`  - Rows parsed: ${stats.rows_parsed}`);
  console.log(`  - Active contractors: ${stats.rows_active}`);
  console.log(`  - Inserted/Updated: ${stats.rows_inserted}`);
  console.log(`  - Mappings created: ${stats.mappings_created}`);
  console.log(`  - Errors: ${stats.errors}`);
  console.log(`  - Is complete: ${stats.is_complete}`);
  if (stats.next_offset) {
    console.log(`  - Next offset: ${stats.next_offset}`);
  }
  
  return stats;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Parse request body for offset and csv_url
    let offset = 0;
    let csvUrl: string | null = null;
    
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        offset = body.offset || 0;
        csvUrl = body.csv_url || null;
      } catch {
        // No body or invalid JSON, use defaults
      }
    }
    
    // CSV URL is required - must be captured from browser network tab
    if (!csvUrl) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'csv_url is required. The CSLB portal uses ASP.NET forms that require browser interaction. To get the URL: 1) Open browser dev tools (Network tab), 2) Go to ' + CSLB_PORTAL_URL + ', 3) Select "License Master" and CSV format, 4) Click download and copy the request URL from Network tab, 5) Pass that URL as csv_url parameter.',
          portal_url: CSLB_PORTAL_URL,
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400,
        }
      );
    }
    
    console.log(`[cslb-ingest-master] Starting CSLB Master License ingestion...`);
    console.log(`[cslb-ingest-master] CSV URL: ${csvUrl}`);
    console.log(`[cslb-ingest-master] Offset: ${offset}`);
    
    // Run ingestion
    const stats = await processCSVIngestion(supabase, csvUrl, offset);
    
    return new Response(
      JSON.stringify({
        success: stats.errors === 0 || stats.rows_inserted > 0,
        message: stats.is_complete 
          ? 'Ingestion complete' 
          : `Partial ingestion, continue from offset ${stats.next_offset}`,
        stats,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[cslb-ingest-master] Fatal error: ${errorMessage}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
