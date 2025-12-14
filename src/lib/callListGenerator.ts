import { supabase } from "@/integrations/supabase/client";
import { GCSubcontractor } from "./subcontractorMatching";

export interface CallListEntry {
  company_name: string;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  trades: string;
  license_number: string | null;
  city: string | null;
  notes: string | null;
}

interface NetworkSubcontractor {
  id: string;
  company_name: string;
  license_number: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  notes: string | null;
  trades: {
    trade_type_id: string;
    code: string;
    name: string;
  }[];
}

/**
 * Normalize company name for deduplication
 */
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+(inc|llc|corp|co|ltd|company|construction|contractors?|builders?|enterprises?)\s*$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get subcontractors from Network Pool matching project trades
 */
async function getMatchingNetworkSubcontractors(
  projectId: string
): Promise<NetworkSubcontractor[]> {
  // Get project's required trade_type_ids
  const { data: projectTrades, error: tradesError } = await supabase
    .from('project_trades')
    .select('trade_type_id')
    .eq('project_id', projectId);

  if (tradesError || !projectTrades) {
    console.error('Error fetching project trades:', tradesError);
    return [];
  }

  const tradeIds = projectTrades.map(pt => pt.trade_type_id);
  
  if (tradeIds.length === 0) {
    // No trades selected, return all network subs
    const { data: allSubs } = await supabase
      .from('subcontractors')
      .select('*')
      .order('company_name');
    
    if (!allSubs) return [];
    
    // Get trade mappings
    const subIds = allSubs.map(s => s.id);
    const { data: tradeMappings } = await supabase
      .from('sub_trade_mappings')
      .select(`
        sub_id,
        trade_type_id,
        trade_types (id, code, name)
      `)
      .in('sub_id', subIds);
    
    return allSubs.map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.sub_id === sub.id)
        .map(m => ({
          trade_type_id: m.trade_type_id,
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
        })) || [],
    }));
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

  const { data: networkSubs } = await supabase
    .from('subcontractors')
    .select('*')
    .in('id', matchingSubIds)
    .order('company_name');

  if (!networkSubs) return [];

  // Get full trade mappings for these subs
  const { data: tradeMappings } = await supabase
    .from('sub_trade_mappings')
    .select(`
      sub_id,
      trade_type_id,
      trade_types (id, code, name)
    `)
    .in('sub_id', matchingSubIds);

  return networkSubs.map(sub => ({
    ...sub,
    trades: tradeMappings
      ?.filter(m => m.sub_id === sub.id)
      .map(m => ({
        trade_type_id: m.trade_type_id,
        code: (m.trade_types as any)?.code || '',
        name: (m.trade_types as any)?.name || '',
      })) || [],
  }));
}

/**
 * Get subcontractors from GC Private Pool matching project trades
 */
async function getMatchingGCSubcontractors(
  projectId: string,
  gcId: string
): Promise<GCSubcontractor[]> {
  // Get project's required trade_type_ids
  const { data: projectTrades, error: tradesError } = await supabase
    .from('project_trades')
    .select('trade_type_id')
    .eq('project_id', projectId);

  if (tradesError) {
    console.error('Error fetching project trades:', tradesError);
    return [];
  }

  const tradeIds = projectTrades?.map(pt => pt.trade_type_id) || [];
  
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
      trade_types (id, code, name, category)
    `)
    .in('gc_sub_id', subIds);

  // If no trades selected, return all with their trades attached
  if (tradeIds.length === 0) {
    return gcSubs.map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.gc_sub_id === sub.id)
        .map(m => ({
          trade_type_id: m.trade_type_id,
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
          category: (m.trade_types as any)?.category || null,
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
          trade_type_id: m.trade_type_id,
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
          category: (m.trade_types as any)?.category || null,
        })) || [],
    }));
}

/**
 * Generate call list by merging GC Private Pool + Network Pool
 * Deduplicates by license number (preferred) or normalized company name
 */
export async function generateCallList(
  projectId: string,
  gcId: string
): Promise<CallListEntry[]> {
  // Fetch from both pools in parallel
  const [gcSubs, networkSubs] = await Promise.all([
    getMatchingGCSubcontractors(projectId, gcId),
    getMatchingNetworkSubcontractors(projectId),
  ]);

  // Track seen entries for deduplication
  const seenLicenses = new Set<string>();
  const seenNormalizedNames = new Set<string>();
  const entries: CallListEntry[] = [];

  // Helper to add entry with dedup check
  const addEntry = (
    sub: { 
      company_name: string; 
      license_number: string | null;
      contact_name: string | null;
      phone: string | null;
      email: string | null;
      city: string | null;
      notes: string | null;
      trades: { code: string; name: string }[];
    },
    source: 'gc' | 'network'
  ) => {
    // Check license number first (preferred dedup key)
    if (sub.license_number) {
      if (seenLicenses.has(sub.license_number)) {
        return; // Skip duplicate
      }
      seenLicenses.add(sub.license_number);
    } else {
      // Fall back to normalized company name
      const normalized = normalizeCompanyName(sub.company_name);
      if (seenNormalizedNames.has(normalized)) {
        return; // Skip duplicate
      }
      seenNormalizedNames.add(normalized);
    }

    // Format trades as readable string
    const tradesStr = sub.trades.length > 0
      ? sub.trades.map(t => `${t.code} - ${t.name}`).join(', ')
      : '';

    entries.push({
      company_name: sub.company_name,
      contact_name: sub.contact_name,
      phone: sub.phone,
      email: sub.email,
      trades: tradesStr,
      license_number: sub.license_number,
      city: sub.city,
      notes: sub.notes,
    });
  };

  // Add GC's private pool first (priority)
  for (const sub of gcSubs) {
    addEntry(sub, 'gc');
  }

  // Add network pool (will be deduped against GC pool)
  for (const sub of networkSubs) {
    addEntry({
      ...sub,
      trades: sub.trades.map(t => ({ code: t.code, name: t.name })),
    }, 'network');
  }

  // Sort alphabetically by company name
  entries.sort((a, b) => a.company_name.localeCompare(b.company_name));

  return entries;
}
