import { supabase } from "@/integrations/supabase/client";

export interface GCSubcontractor {
  id: string;
  gc_id: string;
  company_name: string;
  license_number: string | null;
  license_status: string | null;
  license_expiration: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state_code: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trades: {
    trade_type_id: string;
    code: string;
    name: string;
    category: string | null;
  }[];
}

/**
 * Get all subcontractors from the GC's private pool that match the project's required trades
 */
export async function getMatchingSubcontractors(
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
  
  if (tradeIds.length === 0) {
    // No trades selected, return all GC's subs
    return await getAllGCSubcontractors(gcId);
  }

  // Query GC's private subs that have matching trades
  const { data: gcSubs, error: subsError } = await supabase
    .from('gc_subcontractors')
    .select('*')
    .eq('gc_id', gcId);

  if (subsError || !gcSubs) {
    console.error('Error fetching GC subcontractors:', subsError);
    return [];
  }

  // Get trade mappings for these subs
  const subIds = gcSubs.map(s => s.id);
  const { data: tradeMappings, error: mappingsError } = await supabase
    .from('gc_sub_trade_mappings')
    .select(`
      gc_sub_id,
      trade_type_id,
      trade_types (
        id,
        code,
        name,
        category
      )
    `)
    .in('gc_sub_id', subIds);

  if (mappingsError) {
    console.error('Error fetching trade mappings:', mappingsError);
    return [];
  }

  // Filter subs that have at least one matching trade
  const matchingSubIds = new Set(
    tradeMappings
      ?.filter(m => tradeIds.includes(m.trade_type_id))
      .map(m => m.gc_sub_id) || []
  );

  // Build the result with trades attached
  const result: GCSubcontractor[] = gcSubs
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

  return result;
}

/**
 * Get all subcontractors from the GC's private pool with their trades
 */
export async function getAllGCSubcontractors(gcId: string): Promise<GCSubcontractor[]> {
  const { data: gcSubs, error: subsError } = await supabase
    .from('gc_subcontractors')
    .select('*')
    .eq('gc_id', gcId)
    .order('company_name');

  if (subsError || !gcSubs) {
    console.error('Error fetching GC subcontractors:', subsError);
    return [];
  }

  if (gcSubs.length === 0) {
    return [];
  }

  // Get trade mappings for these subs
  const subIds = gcSubs.map(s => s.id);
  const { data: tradeMappings, error: mappingsError } = await supabase
    .from('gc_sub_trade_mappings')
    .select(`
      gc_sub_id,
      trade_type_id,
      trade_types (
        id,
        code,
        name,
        category
      )
    `)
    .in('gc_sub_id', subIds);

  if (mappingsError) {
    console.error('Error fetching trade mappings:', mappingsError);
  }

  // Build the result with trades attached
  const result: GCSubcontractor[] = gcSubs.map(sub => ({
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

  return result;
}

/**
 * Lookup a CSLB license and return the data
 */
export async function lookupCSLBLicense(licenseNumber: string) {
  const { data, error } = await supabase.functions.invoke('lookup-cslb', {
    body: { license_number: licenseNumber },
  });

  if (error) {
    console.error('CSLB lookup error:', error);
    throw new Error('Failed to lookup license');
  }

  return data;
}

/**
 * Add a new subcontractor to the GC's private pool
 */
export async function addGCSubcontractor(
  gcId: string,
  subData: {
    company_name: string;
    license_number?: string;
    license_status?: string;
    license_expiration?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    city?: string;
    state_code?: string;
    notes?: string;
  },
  tradeTypeIds: string[]
) {
  // Insert the subcontractor
  const { data: newSub, error: subError } = await supabase
    .from('gc_subcontractors')
    .insert({
      gc_id: gcId,
      company_name: subData.company_name,
      license_number: subData.license_number || null,
      license_status: subData.license_status || null,
      license_expiration: subData.license_expiration || null,
      contact_name: subData.contact_name || null,
      email: subData.email || null,
      phone: subData.phone || null,
      city: subData.city || null,
      state_code: subData.state_code || 'CA',
      notes: subData.notes || null,
    })
    .select()
    .single();

  if (subError || !newSub) {
    console.error('Error adding subcontractor:', subError);
    throw new Error('Failed to add subcontractor');
  }

  // Insert trade mappings
  if (tradeTypeIds.length > 0) {
    const tradeMappings = tradeTypeIds.map(tradeTypeId => ({
      gc_sub_id: newSub.id,
      trade_type_id: tradeTypeId,
    }));

    const { error: mappingError } = await supabase
      .from('gc_sub_trade_mappings')
      .insert(tradeMappings);

    if (mappingError) {
      console.error('Error adding trade mappings:', mappingError);
      // Don't throw - the sub was created, just without trades
    }
  }

  return newSub;
}

/**
 * Update an existing subcontractor in the GC's private pool
 */
export async function updateGCSubcontractor(
  subId: string,
  subData: {
    company_name?: string;
    license_number?: string;
    license_status?: string;
    license_expiration?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    city?: string;
    state_code?: string;
    notes?: string;
  },
  tradeTypeIds?: string[]
) {
  // Update the subcontractor
  const { error: subError } = await supabase
    .from('gc_subcontractors')
    .update(subData)
    .eq('id', subId);

  if (subError) {
    console.error('Error updating subcontractor:', subError);
    throw new Error('Failed to update subcontractor');
  }

  // Update trade mappings if provided
  if (tradeTypeIds !== undefined) {
    // Delete existing mappings
    await supabase
      .from('gc_sub_trade_mappings')
      .delete()
      .eq('gc_sub_id', subId);

    // Insert new mappings
    if (tradeTypeIds.length > 0) {
      const tradeMappings = tradeTypeIds.map(tradeTypeId => ({
        gc_sub_id: subId,
        trade_type_id: tradeTypeId,
      }));

      const { error: mappingError } = await supabase
        .from('gc_sub_trade_mappings')
        .insert(tradeMappings);

      if (mappingError) {
        console.error('Error adding trade mappings:', mappingError);
      }
    }
  }
}

/**
 * Delete a subcontractor from the GC's private pool
 */
export async function deleteGCSubcontractor(subId: string) {
  // Trade mappings will be deleted by CASCADE
  const { error } = await supabase
    .from('gc_subcontractors')
    .delete()
    .eq('id', subId);

  if (error) {
    console.error('Error deleting subcontractor:', error);
    throw new Error('Failed to delete subcontractor');
  }
}
