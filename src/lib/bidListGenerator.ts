import { supabase } from "@/integrations/supabase/client";

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
 */
export async function generateBidList(
  projectId: string,
  gcId: string
): Promise<BidListResult> {
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
  
  // Fetch from both pools in parallel
  const [privateSubs, networkSubs] = await Promise.all([
    getMatchingGCSubcontractors(projectId, gcId, tradeIds),
    getMatchingNetworkSubcontractors(projectId, tradeIds),
  ]);

  // Build set of license numbers from private pool for deduplication
  const privateLicenses = new Set<string>();
  for (const sub of privateSubs) {
    if (sub.license_number) {
      privateLicenses.add(sub.license_number.toLowerCase());
    }
  }

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
 */
async function getMatchingNetworkSubcontractors(
  projectId: string,
  tradeIds: string[]
): Promise<NetworkSubWithTrades[]> {
  if (tradeIds.length === 0) {
    // No trades selected, return empty - require trade selection
    return [];
  }

  // Get network subs with matching trades
  const { data: matchingMappings } = await supabase
    .from('sub_trade_mappings')
    .select('sub_id')
    .in('trade_type_id', tradeIds);

  if (!matchingMappings || matchingMappings.length === 0) {
    return [];
  }

  const matchingSubIds = [...new Set(matchingMappings.map(m => m.sub_id))];

  // Fetch subs with CLEAR license status only
  const { data: networkSubs } = await supabase
    .from('subcontractors')
    .select('*')
    .in('id', matchingSubIds)
    .eq('license_status', 'CLEAR')
    .order('company_name');

  if (!networkSubs) return [];

  // Get full trade mappings for these subs
  const { data: tradeMappings } = await supabase
    .from('sub_trade_mappings')
    .select(`
      sub_id,
      trade_type_id,
      trade_types (code, name)
    `)
    .in('sub_id', networkSubs.map(s => s.id));

  return networkSubs.map(sub => ({
    id: sub.id,
    company_name: sub.company_name,
    license_number: sub.license_number,
    phone: sub.phone,
    city: sub.city,
    county: sub.county,
    trades: tradeMappings
      ?.filter(m => m.sub_id === sub.id)
      .map(m => ({
        code: (m.trade_types as any)?.code || '',
        name: (m.trade_types as any)?.name || '',
      })) || [],
  }));
}
