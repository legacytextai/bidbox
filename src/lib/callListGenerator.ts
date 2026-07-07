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

export interface CallListDiagnostics {
  selectedTradeCount: number;
  privateSubCount: number;
  networkSubCount: number;
  privateMappingCount: number;
  networkMappingCount: number;
  privateQueryFailed: boolean;
  networkQueryFailed: boolean;
  projectTradeQueryFailed: boolean;
  missingTradeMappings: boolean;
}

export interface CallListResult {
  entries: CallListEntry[];
  diagnostics: CallListDiagnostics;
}

const emptyDiagnostics = (): CallListDiagnostics => ({
  selectedTradeCount: 0,
  privateSubCount: 0,
  networkSubCount: 0,
  privateMappingCount: 0,
  networkMappingCount: 0,
  privateQueryFailed: false,
  networkQueryFailed: false,
  projectTradeQueryFailed: false,
  missingTradeMappings: false,
});

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
  projectId: string,
): Promise<{ subs: NetworkSubcontractor[]; diagnostics: Pick<CallListDiagnostics, "selectedTradeCount" | "networkSubCount" | "networkMappingCount" | "networkQueryFailed" | "projectTradeQueryFailed"> }> {
  const diagnostics = {
    selectedTradeCount: 0,
    networkSubCount: 0,
    networkMappingCount: 0,
    networkQueryFailed: false,
    projectTradeQueryFailed: false,
  };

  // Get project's required trade_type_ids
  const { data: projectTrades, error: tradesError } = await supabase
    .from('project_trades')
    .select('trade_type_id')
    .eq('project_id', projectId);

  if (tradesError || !projectTrades) {
    console.error('Error fetching project trades:', tradesError);
    diagnostics.projectTradeQueryFailed = true;
    return { subs: [], diagnostics };
  }

  const tradeIds = projectTrades.map(pt => pt.trade_type_id);
  diagnostics.selectedTradeCount = tradeIds.length;
  
  if (tradeIds.length === 0) {
    // No trades selected, return all network subs
    const { data: allSubs, error: allSubsError } = await supabase
      .from('subcontractors')
      .select('*')
      .order('company_name');
    
    if (allSubsError || !allSubs) {
      console.error('Error fetching network subcontractors:', allSubsError);
      diagnostics.networkQueryFailed = true;
      return { subs: [], diagnostics };
    }
    
    // Get trade mappings
    const subIds = allSubs.map(s => s.id);
    const { data: tradeMappings, error: tradeMappingsError } = await supabase
      .from('sub_trade_mappings')
      .select(`
        sub_id,
        trade_type_id,
        trade_types (id, code, name)
      `)
      .in('sub_id', subIds);

    if (tradeMappingsError) {
      console.error('Error fetching network trade mappings:', tradeMappingsError);
      diagnostics.networkQueryFailed = true;
    }
    diagnostics.networkSubCount = allSubs.length;
    diagnostics.networkMappingCount = tradeMappings?.length ?? 0;
    
    return { subs: allSubs.map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.sub_id === sub.id)
        .map(m => ({
          trade_type_id: m.trade_type_id,
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
        })) || [],
    })), diagnostics };
  }

  // Get network subs with matching trades
  const { data: matchingMappings, error: matchingMappingsError } = await supabase
    .from('sub_trade_mappings')
    .select('sub_id')
    .in('trade_type_id', tradeIds);

  if (matchingMappingsError) {
    console.error('Error fetching matching network trade mappings:', matchingMappingsError);
    diagnostics.networkQueryFailed = true;
    return { subs: [], diagnostics };
  }

  diagnostics.networkMappingCount = matchingMappings?.length ?? 0;
  if (!matchingMappings || matchingMappings.length === 0) {
    return { subs: [], diagnostics };
  }

  const matchingSubIds = [...new Set(matchingMappings.map(m => m.sub_id))];

  const { data: networkSubs, error: networkSubsError } = await supabase
    .from('subcontractors')
    .select('*')
    .in('id', matchingSubIds)
    .order('company_name');

  if (networkSubsError || !networkSubs) {
    console.error('Error fetching matching network subcontractors:', networkSubsError);
    diagnostics.networkQueryFailed = true;
    return { subs: [], diagnostics };
  }
  diagnostics.networkSubCount = networkSubs.length;

  // Get full trade mappings for these subs
  const { data: tradeMappings, error: tradeMappingsError } = await supabase
    .from('sub_trade_mappings')
    .select(`
      sub_id,
      trade_type_id,
      trade_types (id, code, name)
    `)
    .in('sub_id', matchingSubIds);

  if (tradeMappingsError) {
    console.error('Error fetching network subcontractor trade mappings:', tradeMappingsError);
    diagnostics.networkQueryFailed = true;
  }

  return { subs: networkSubs.map(sub => ({
    ...sub,
    trades: tradeMappings
      ?.filter(m => m.sub_id === sub.id)
      .map(m => ({
        trade_type_id: m.trade_type_id,
        code: (m.trade_types as any)?.code || '',
        name: (m.trade_types as any)?.name || '',
      })) || [],
  })), diagnostics };
}

/**
 * Get subcontractors from GC Private Pool matching project trades
 */
async function getMatchingGCSubcontractors(
  projectId: string,
  gcId: string
): Promise<{ subs: GCSubcontractor[]; diagnostics: Pick<CallListDiagnostics, "selectedTradeCount" | "privateSubCount" | "privateMappingCount" | "privateQueryFailed" | "projectTradeQueryFailed"> }> {
  const diagnostics = {
    selectedTradeCount: 0,
    privateSubCount: 0,
    privateMappingCount: 0,
    privateQueryFailed: false,
    projectTradeQueryFailed: false,
  };

  // Get project's required trade_type_ids
  const { data: projectTrades, error: tradesError } = await supabase
    .from('project_trades')
    .select('trade_type_id')
    .eq('project_id', projectId);

  if (tradesError) {
    console.error('Error fetching project trades:', tradesError);
    diagnostics.projectTradeQueryFailed = true;
    return { subs: [], diagnostics };
  }

  const tradeIds = projectTrades?.map(pt => pt.trade_type_id) || [];
  diagnostics.selectedTradeCount = tradeIds.length;
  
  // Get all GC's subs
  const { data: gcSubs, error: subsError } = await supabase
    .from('gc_subcontractors')
    .select('*')
    .eq('gc_id', gcId)
    .order('company_name');

  if (subsError || !gcSubs) {
    console.error('Error fetching GC subcontractors:', subsError);
    diagnostics.privateQueryFailed = true;
    return { subs: [], diagnostics };
  }
  diagnostics.privateSubCount = gcSubs.length;

  if (gcSubs.length === 0) return { subs: [], diagnostics };

  // Get trade mappings for these subs
  const subIds = gcSubs.map(s => s.id);
  const { data: tradeMappings, error: tradeMappingsError } = await supabase
    .from('gc_sub_trade_mappings')
    .select(`
      gc_sub_id,
      trade_type_id,
      trade_types (id, code, name, category)
    `)
    .in('gc_sub_id', subIds);

  if (tradeMappingsError) {
    console.error('Error fetching GC subcontractor trade mappings:', tradeMappingsError);
    diagnostics.privateQueryFailed = true;
  }
  diagnostics.privateMappingCount = tradeMappings?.length ?? 0;

  // If no trades selected, return all with their trades attached
  if (tradeIds.length === 0) {
    return { subs: gcSubs.map(sub => ({
      ...sub,
      trades: tradeMappings
        ?.filter(m => m.gc_sub_id === sub.id)
        .map(m => ({
          trade_type_id: m.trade_type_id,
          code: (m.trade_types as any)?.code || '',
          name: (m.trade_types as any)?.name || '',
          category: (m.trade_types as any)?.category || null,
        })) || [],
    })), diagnostics };
  }

  // Filter subs that have at least one matching trade
  const matchingSubIds = new Set(
    tradeMappings
      ?.filter(m => tradeIds.includes(m.trade_type_id))
      .map(m => m.gc_sub_id) || []
  );

  return { subs: gcSubs
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
    })), diagnostics };
}

/**
 * Generate call list by merging GC Private Pool + Network Pool
 * Deduplicates by license number (preferred) or normalized company name
 */
export async function generateCallList(
  projectId: string,
  gcId: string
): Promise<CallListResult> {
  // Fetch from both pools in parallel
  const [gcResult, networkResult] = await Promise.all([
    getMatchingGCSubcontractors(projectId, gcId),
    getMatchingNetworkSubcontractors(projectId),
  ]);
  const gcSubs = gcResult.subs;
  const networkSubs = networkResult.subs;
  const diagnostics: CallListDiagnostics = {
    ...emptyDiagnostics(),
    ...networkResult.diagnostics,
    ...gcResult.diagnostics,
    selectedTradeCount: Math.max(
      gcResult.diagnostics.selectedTradeCount,
      networkResult.diagnostics.selectedTradeCount,
    ),
  };
  diagnostics.missingTradeMappings =
    diagnostics.selectedTradeCount > 0 &&
    diagnostics.privateMappingCount === 0 &&
    diagnostics.networkMappingCount === 0 &&
    !diagnostics.privateQueryFailed &&
    !diagnostics.networkQueryFailed &&
    !diagnostics.projectTradeQueryFailed;

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

  return { entries, diagnostics };
}
