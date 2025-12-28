import { supabase } from "@/integrations/supabase/client";
import { getRegionForCounty, getCountiesInRegion, REGION_DISPLAY_NAMES, CARegion } from "@/lib/californiaRegions";

/**
 * Private Pool entry for My Subs sheet
 */
export interface PrivateSubEntry {
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  trades: string;
  notes: string | null;
}

/**
 * Network Pool entry for Network Subs sheet
 */
export interface NetworkSubEntry {
  business_name: string;
  license_number: string | null;
  phone: string | null;
  city: string | null;
  county: string | null;
  classifications: string;
}

/**
 * Result from bid list generation
 */
export interface BidListResult {
  privateSubs: PrivateSubEntry[];
  networkSubs: NetworkSubEntry[];
}

/**
 * Generate bid list with separate pools for two-sheet Excel export.
 * Deduplicates network subs by removing those with matching license numbers in private pool.
 * Applies regional filtering to network subs based on project county.
 */
export async function generateBidList(
  projectId: string,
  gcId: string,
  projectCounty: string
): Promise<BidListResult> {
  // Log region info
  const region = getRegionForCounty(projectCounty);
  const allowedCounties = getCountiesInRegion(projectCounty);
  console.log('[BidList][Region] Project county:', projectCounty);
  console.log('[BidList][Region] Derived region:', region ? REGION_DISPLAY_NAMES[region] : 'Unknown');
  console.log('[BidList][Region] Allowed counties:', allowedCounties);

  // Get project's required trade_type_ids
  const { data: projectTrades, error: tradesError } = await supabase
    .from('project_trades')
    .select('trade_type_id')
    .eq('project_id', projectId);

  if (tradesError) {
    console.error('Error fetching project trades:', tradesError);
    return { privateSubs: [], networkSubs: [] };
  }

  const tradeIds = projectTrades?.map(pt => pt.trade_type_id) || [];
  
  console.log('[BidList] Starting bid list generation for project:', projectId);
  
  // Fetch from both pools in parallel
  const [privateSubs, networkSubs] = await Promise.all([
    getMatchingGCSubcontractors(projectId, gcId, tradeIds),
    getMatchingNetworkSubcontractors(projectId, tradeIds, allowedCounties),
  ]);

  console.log('[BidList] Private subs fetched:', privateSubs.length);
  console.log('[BidList] Network subs fetched:', networkSubs.length);

  // Build set of license numbers from private pool for deduplication
  const privateLicenses = new Set<string>();
  for (const sub of privateSubs) {
    if (sub.license_number) {
      privateLicenses.add(sub.license_number.toLowerCase());
    }
  }
  console.log('[BidList] Private license numbers for dedup:', privateLicenses.size);

  // Format private subs
  const formattedPrivateSubs: PrivateSubEntry[] = privateSubs.map(sub => ({
    company_name: sub.company_name,
    contact_name: sub.contact_name,
    phone: sub.phone,
    email: sub.email,
    city: sub.city,
    trades: sub.trades.map(t => `${t.code} - ${t.name}`).join(', '),
    notes: sub.notes,
  }));

  // Format network subs, excluding those with matching licenses
  const networkSubsBeforeDedup = networkSubs.length;
  const formattedNetworkSubs: NetworkSubEntry[] = networkSubs
    .filter(sub => {
      if (!sub.license_number) return true;
      return !privateLicenses.has(sub.license_number.toLowerCase());
    })
    .map(sub => ({
      business_name: sub.company_name,
      license_number: sub.license_number,
      phone: sub.phone,
      city: sub.city,
      county: sub.county,
      classifications: sub.trades.map(t => `${t.code} - ${t.name}`).join(', '),
    }));

  const removedByDedup = networkSubsBeforeDedup - formattedNetworkSubs.length;
  console.log('[BidList] Network subs removed by deduplication:', removedByDedup);
  console.log('[BidList] Final counts - Private:', formattedPrivateSubs.length, 'Network:', formattedNetworkSubs.length);

  return {
    privateSubs: formattedPrivateSubs,
    networkSubs: formattedNetworkSubs,
  };
}

// ============ Helper Functions ============

interface GCSubWithTrades {
  id: string;
  company_name: string;
  license_number: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  notes: string | null;
  trades: { code: string; name: string }[];
}

interface NetworkSubWithTrades {
  id: string;
  company_name: string;
  license_number: string | null;
  phone: string | null;
  city: string | null;
  county: string | null;
  trades: { code: string; name: string }[];
}

/**
 * Get subcontractors from GC Private Pool matching project trades
 */
async function getMatchingGCSubcontractors(
  projectId: string,
  gcId: string,
  tradeIds: string[]
): Promise<GCSubWithTrades[]> {
  // Get all GC's subs
  const { data: gcSubs, error: subsError } = await supabase
    .from('gc_subcontractors')
    .select('*')
    .eq('gc_id', gcId)
    .order('company_name');

  if (subsError || !gcSubs) {
    console.error('Error fetching GC subcontractors:', subsError);
    return [];
  }

  if (gcSubs.length === 0) return [];

  // Get trade mappings for these subs
  const subIds = gcSubs.map(s => s.id);
  const { data: tradeMappings } = await supabase
    .from('gc_sub_trade_mappings')
    .select(`
      gc_sub_id,
      trade_type_id,
      trade_types (code, name)
    `)
    .in('gc_sub_id', subIds);

  // If no trades selected, return all with their trades attached
  if (tradeIds.length === 0) {
    return gcSubs.map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.gc_sub_id === sub.id)
        .map(m => ({
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
        })) || [],
    }));
  }

  // Filter subs that have at least one matching trade
  const matchingSubIds = new Set(
    tradeMappings
      ?.filter(m => tradeIds.includes(m.trade_type_id))
      .map(m => m.gc_sub_id) || []
  );

  return gcSubs
    .filter(sub => matchingSubIds.has(sub.id))
    .map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.gc_sub_id === sub.id)
        .map(m => ({
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
        })) || [],
    }));
}

/**
 * Get subcontractors from Network Pool matching project trades
 * Only includes subs with CLEAR license status
 * Filtered by allowed counties (regional filtering)
 */
async function getMatchingNetworkSubcontractors(
  projectId: string,
  tradeIds: string[],
  allowedCounties: string[]
): Promise<NetworkSubWithTrades[]> {
  console.log('[BidList][Network] Project ID:', projectId);
  console.log('[BidList][Network] Project trades:', tradeIds);
  console.log('[BidList][Network] Allowed counties for region filter:', allowedCounties.length);
  
  if (tradeIds.length === 0) {
    console.log('[BidList][Network] No trades selected, returning empty');
    return [];
  }

  // Query each trade separately to avoid 1000-row limit bias
  // This ensures all trades get representation, not just the first 1000 mappings
  console.log('[BidList][Network] Querying mappings per trade...');
  
  const allSubIds = new Set<string>();
  const tradeStats: { tradeId: string; mappingCount: number; newSubs: number }[] = [];
  
  for (const tradeId of tradeIds) {
    const { data: mappings, error, count } = await supabase
      .from('sub_trade_mappings')
      .select('sub_id', { count: 'exact' })
      .eq('trade_type_id', tradeId)
      .limit(50000); // High limit per-trade to get all mappings
    
    if (error) {
      console.error(`[BidList][Network] Error for trade ${tradeId}:`, error);
      continue;
    }
    
    const beforeCount = allSubIds.size;
    mappings?.forEach(m => allSubIds.add(m.sub_id));
    const newSubs = allSubIds.size - beforeCount;
    
    tradeStats.push({ tradeId, mappingCount: count || mappings?.length || 0, newSubs });
    console.log(`[BidList][Network] Trade ${tradeId}: ${count || mappings?.length || 0} mappings, +${newSubs} new subs (total: ${allSubIds.size})`);
  }
  
  // Log summary of per-trade coverage
  console.log('[BidList][Network] Per-trade summary:', JSON.stringify(tradeStats));
  console.log('[BidList][Network] Total unique sub IDs:', allSubIds.size);

  if (allSubIds.size === 0) {
    console.log('[BidList][Network] No matching subs found across all trades');
    return [];
  }

  const matchingSubIds = [...allSubIds];
  console.log('[BidList][Network] Unique sub IDs to fetch:', matchingSubIds.length);

  // Chunk the sub IDs to avoid query-too-large errors (Supabase limit)
  const CHUNK_SIZE = 500;
  const chunks: string[][] = [];
  for (let i = 0; i < matchingSubIds.length; i += CHUNK_SIZE) {
    chunks.push(matchingSubIds.slice(i, i + CHUNK_SIZE));
  }
  console.log('[BidList][Network] Fetching subs in', chunks.length, 'chunk(s)');

  // Fetch all subs in chunks with region filter applied
  let allSubs: any[] = [];
  for (const chunk of chunks) {
    let query = supabase
      .from('subcontractors')
      .select('*')
      .in('id', chunk);
    
    // Apply county filter if we have allowed counties
    if (allowedCounties.length > 0) {
      query = query.in('county', allowedCounties);
    }
    
    const { data: chunkSubs, error: chunkError } = await query;
    
    if (chunkError) {
      console.error('[BidList][Network] Error fetching subcontractors chunk:', chunkError);
      continue;
    }
    if (chunkSubs) {
      allSubs = allSubs.concat(chunkSubs);
    }
  }

  console.log('[BidList][Network] Subs before status filter:', allSubs.length);
  console.log('[BidList][Network] Subs after region filter:', allSubs.length);

  // Apply robust license status filter
  const networkSubs = allSubs.filter(sub => {
    const status = (sub.license_status || '').toString().trim().toUpperCase();
    return status === 'CLEAR';
  });

  console.log('[BidList][Network] Subs after status filter:', networkSubs.length);

  if (networkSubs.length === 0) {
    // Log sample of statuses to debug
    const sampleStatuses = allSubs.slice(0, 10).map(s => s.license_status);
    console.log('[BidList][Network] Sample license_status values:', sampleStatuses);
    return [];
  }

  // Sort by company name
  networkSubs.sort((a, b) => (a.company_name || '').localeCompare(b.company_name || ''));

  // Get full trade mappings for these subs (also chunked)
  const subIds = networkSubs.map(s => s.id);
  let allTradeMappings: any[] = [];
  
  for (let i = 0; i < subIds.length; i += CHUNK_SIZE) {
    const chunk = subIds.slice(i, i + CHUNK_SIZE);
    const { data: tradeMappings } = await supabase
      .from('sub_trade_mappings')
      .select(`
        sub_id,
        trade_type_id,
        trade_types (code, name)
      `)
      .in('sub_id', chunk);
    
    if (tradeMappings) {
      allTradeMappings = allTradeMappings.concat(tradeMappings);
    }
  }

  return networkSubs.map(sub => ({
    id: sub.id,
    company_name: sub.company_name,
    license_number: sub.license_number,
    phone: sub.phone,
    city: sub.city,
    county: sub.county,
    trades: allTradeMappings
      ?.filter(m => m.sub_id === sub.id)
      .map(m => ({
        code: (m.trade_types as any)?.code || '',
        name: (m.trade_types as any)?.name || '',
      })) || [],
  }));
}
