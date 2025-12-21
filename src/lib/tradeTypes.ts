import { supabase } from "@/integrations/supabase/client";

export interface TradeType {
  id: string;
  state_code: string | null;
  code: string;
  name: string;
  category: string | null;
  source: string | null;
  is_default: boolean | null;
  parent_code: string | null;
  is_active: boolean | null;
  notes: string | null;
}

// Category color map for UI badges
export const CATEGORY_COLORS: Record<string, string> = {
  'General': 'bg-slate-100 text-slate-800 border-slate-200',
  'Electrical': 'bg-blue-100 text-blue-800 border-blue-200',
  'Mechanical': 'bg-orange-100 text-orange-800 border-orange-200',
  'Civil': 'bg-green-100 text-green-800 border-green-200',
  'Structural': 'bg-purple-100 text-purple-800 border-purple-200',
  'Finishes': 'bg-pink-100 text-pink-800 border-pink-200',
  'Fire/Life Safety': 'bg-red-100 text-red-800 border-red-200',
  'Site Work': 'bg-teal-100 text-teal-800 border-teal-200',
  'Metals': 'bg-zinc-100 text-zinc-800 border-zinc-200',
  'Demolition': 'bg-amber-100 text-amber-800 border-amber-200',
  'Exterior': 'bg-cyan-100 text-cyan-800 border-cyan-200',
  'Specialty': 'bg-violet-100 text-violet-800 border-violet-200',
  'default': 'bg-gray-100 text-gray-800 border-gray-200',
};

export function getCategoryColor(category: string | null): string {
  if (!category) return CATEGORY_COLORS['default'];
  return CATEGORY_COLORS[category] || CATEGORY_COLORS['default'];
}

/**
 * Fetch trade types from database
 * @param stateCode - Filter by state (e.g., 'CA'). If not provided, returns all.
 */
export async function fetchTradeTypes(stateCode?: string): Promise<TradeType[]> {
  let query = supabase
    .from('trade_types')
    .select('*')
    .eq('is_active', true)
    .order('category', { ascending: true })
    .order('code', { ascending: true });
  
  if (stateCode) {
    query = query.eq('state_code', stateCode);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('Error fetching trade types:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Group trade types by category for dropdown display
 * D-codes (with parent_code) are nested under their parent
 */
export function groupTradesByCategory(trades: TradeType[]): Record<string, TradeType[]> {
  // Separate parent trades and child D-codes
  const parentTrades = trades.filter(t => !t.parent_code);
  const childTrades = trades.filter(t => t.parent_code);
  
  const grouped = parentTrades.reduce((acc, trade) => {
    const category = trade.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(trade);
    
    // If this trade is C-61, add its D-code children right after
    if (trade.code === 'C-61') {
      const dCodes = childTrades.filter(c => c.parent_code === 'C-61');
      acc[category].push(...dCodes);
    }
    
    return acc;
  }, {} as Record<string, TradeType[]>);
  
  return grouped;
}

/**
 * Check if a trade is a D-code (child of C-61)
 */
export function isDCode(trade: TradeType): boolean {
  return trade.parent_code === 'C-61';
}

/**
 * Format trade for display: "[C-10] Electrical"
 */
export function formatTradeDisplay(trade: TradeType): string {
  return `[${trade.code}] ${trade.name}`;
}
