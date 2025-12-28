import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// HARDCODED CANONICAL URL - DO NOT CHANGE
// ============================================
const CSLB_MASTER_CSV_URL = 'https://cslb.ca.gov/OnlineServices/DataPortal/DownLoadFile.ashx?fName=MasterLicenseData&type=C';

// Processing configuration
const BATCH_SIZE = 500;
const MAX_ROWS_PER_INVOCATION = 50000;

// Safety cap for initial testing - set to 0 for full ingestion
const SAFETY_CAP = 5000;

interface IngestionStats {
  rows_parsed: number;
  rows_active: number;
  rows_inserted: number;
  mappings_created: number;
  mappings_deleted: number;
  skipped_inactive: number;
  errors: number;
  error_details: string[];
  unknown_codes: string[];
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
    const idx = headers.get(name.toLowerCase());
    return idx !== undefined && idx < fields.length ? fields[idx] : '';
  };
  
  const licenseNumber = get('licenseno') || get('license_nbr') || get('licnbr');
  const licenseStatus = get('licensestatus') || get('license_status') || get('status');
  
  if (!licenseNumber) return null;
  
  // Only process ACTIVE licenses
  if (licenseStatus.toUpperCase() !== 'ACTIVE') return null;
  
  const classificationsRaw = get('classifications') || get('classification') || get('class');
  
  return {
    license_number: licenseNumber.trim(),
    company_name: (get('businessname') || get('business_name') || get('name') || 'Unknown').trim(),
    city: get('city') || null,
    county: get('county') || null,
    phone: normalizePhone(get('businessphone') || get('phone') || get('busphone')),
    license_status: licenseStatus.toUpperCase(),
    last_cslb_update: get('lastupdate') || get('last_update') || null,
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
  
  stats.mappings_deleted += subIds.length;
  
  // Prepare all new mappings
  const mappingsToInsert: { sub_id: string; trade_type_id: string }[] = [];
  
  for (const contractor of contractors) {
    const subId = licenseToIdMap.get(contractor.license_number);
    if (!subId) continue;
    
    for (const code of contractor.classifications) {
      const tradeTypeId = tradeTypeCache.get(code);
      if (tradeTypeId) {
        mappingsToInsert.push({ sub_id: subId, trade_type_id: tradeTypeId });
      } else if (!stats.unknown_codes.includes(code)) {
        stats.unknown_codes.push(code);
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
async function loadTradeTypeCache(supabase: any): Promise<Map<string, string>> {
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
  offset: number = 0
): Promise<IngestionStats> {
  const stats: IngestionStats = {
    rows_parsed: 0,
    rows_active: 0,
    rows_inserted: 0,
    mappings_created: 0,
    mappings_deleted: 0,
    skipped_inactive: 0,
    errors: 0,
    error_details: [],
    unknown_codes: [],
    start_time: Date.now(),
    offset_used: offset,
    is_complete: false,
  };
  
  const effectiveLimit = SAFETY_CAP > 0 ? Math.min(SAFETY_CAP, MAX_ROWS_PER_INVOCATION) : MAX_ROWS_PER_INVOCATION;
  
  console.log(`[cslb-ingest-master] ========================================`);
  console.log(`[cslb-ingest-master] CSLB Master License Ingestion Starting`);
  console.log(`[cslb-ingest-master] ========================================`);
  console.log(`[cslb-ingest-master] URL: ${CSLB_MASTER_CSV_URL}`);
  console.log(`[cslb-ingest-master] Offset: ${offset}`);
  console.log(`[cslb-ingest-master] Safety Cap: ${SAFETY_CAP > 0 ? SAFETY_CAP : 'DISABLED (full ingestion)'}`);
  console.log(`[cslb-ingest-master] Effective Limit: ${effectiveLimit} rows`);
  
  // Load trade types for classification mapping
  const tradeTypeCache = await loadTradeTypeCache(supabase);
  
  // Fetch CSV directly from hardcoded URL
  console.log(`[cslb-ingest-master] Fetching CSV...`);
  
  const response = await fetch(CSLB_MASTER_CSV_URL, {
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
  
  const contentType = response.headers.get('content-type');
  const contentLength = response.headers.get('content-length');
  console.log(`[cslb-ingest-master] Response received`);
  console.log(`[cslb-ingest-master] Content-Type: ${contentType}`);
  console.log(`[cslb-ingest-master] Content-Length: ${contentLength ? `${(parseInt(contentLength) / 1024 / 1024).toFixed(2)} MB` : 'unknown'}`);
  
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
        if (buffer.trim() && headers) {
          const fields = parseCSVLine(buffer);
          const contractor = mapRowToContractor(fields, headers);
          if (contractor) {
            stats.rows_active++;
            currentBatch.push(contractor);
          } else {
            stats.skipped_inactive++;
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
        if (processedInThisRun >= effectiveLimit) {
          stats.next_offset = lineNumber;
          console.log(`[cslb-ingest-master] Reached limit (${effectiveLimit}), next_offset: ${lineNumber}`);
          break;
        }
        
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        
        const fields = parseCSVLine(trimmedLine);
        
        // First line is headers
        if (!headers) {
          headers = new Map();
          fields.forEach((field, idx) => {
            // Store lowercase for case-insensitive matching
            headers!.set(field.trim().toLowerCase(), idx);
          });
          console.log(`[cslb-ingest-master] CSV Headers found: ${fields.length}`);
          console.log(`[cslb-ingest-master] Headers: ${fields.slice(0, 10).join(', ')}...`);
          continue;
        }
        
        stats.rows_parsed++;
        processedInThisRun++;
        
        const contractor = mapRowToContractor(fields, headers);
        if (contractor) {
          stats.rows_active++;
          currentBatch.push(contractor);
        } else {
          stats.skipped_inactive++;
        }
        
        // Process batch when full
        if (currentBatch.length >= BATCH_SIZE) {
          console.log(`[cslb-ingest-master] Processing batch of ${currentBatch.length} contractors (total active: ${stats.rows_active})...`);
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
  
  console.log(`[cslb-ingest-master] ========================================`);
  console.log(`[cslb-ingest-master] INGESTION COMPLETE`);
  console.log(`[cslb-ingest-master] ========================================`);
  console.log(`[cslb-ingest-master] Duration: ${duration}s`);
  console.log(`[cslb-ingest-master] Rows parsed: ${stats.rows_parsed}`);
  console.log(`[cslb-ingest-master] Skipped (inactive): ${stats.skipped_inactive}`);
  console.log(`[cslb-ingest-master] Active contractors: ${stats.rows_active}`);
  console.log(`[cslb-ingest-master] Upserted: ${stats.rows_inserted}`);
  console.log(`[cslb-ingest-master] Mappings created: ${stats.mappings_created}`);
  console.log(`[cslb-ingest-master] Unknown codes: ${stats.unknown_codes.length}`);
  if (stats.unknown_codes.length > 0) {
    console.log(`[cslb-ingest-master] Unknown codes (first 20): ${stats.unknown_codes.slice(0, 20).join(', ')}`);
  }
  console.log(`[cslb-ingest-master] Errors: ${stats.errors}`);
  console.log(`[cslb-ingest-master] Is complete: ${stats.is_complete}`);
  if (stats.next_offset) {
    console.log(`[cslb-ingest-master] Next offset for continuation: ${stats.next_offset}`);
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
    
    // Parse request body for optional offset
    let offset = 0;
    
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        offset = body.offset || 0;
      } catch {
        // No body or invalid JSON, use defaults
      }
    }
    
    console.log(`[cslb-ingest-master] Starting CSLB Master License ingestion...`);
    
    // Run ingestion with hardcoded URL
    const stats = await processCSVIngestion(supabase, offset);
    
    return new Response(
      JSON.stringify({
        success: stats.errors === 0 || stats.rows_inserted > 0,
        message: stats.is_complete 
          ? SAFETY_CAP > 0 
            ? `Ingestion complete (safety cap: ${SAFETY_CAP} rows)`
            : 'Full ingestion complete'
          : `Partial ingestion complete. Continue with offset: ${stats.next_offset}`,
        stats: {
          duration_seconds: stats.end_time ? ((stats.end_time - stats.start_time) / 1000).toFixed(2) : null,
          rows_parsed: stats.rows_parsed,
          skipped_inactive: stats.skipped_inactive,
          active_contractors: stats.rows_active,
          upserted: stats.rows_inserted,
          mappings_created: stats.mappings_created,
          unknown_codes_count: stats.unknown_codes.length,
          errors: stats.errors,
          is_complete: stats.is_complete,
          offset_used: stats.offset_used,
          next_offset: stats.next_offset || null,
        },
        unknown_codes: stats.unknown_codes.slice(0, 50),
        error_details: stats.error_details.slice(0, 10),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
    
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[cslb-ingest-master] Fatal error: ${errorMsg}`);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMsg,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});