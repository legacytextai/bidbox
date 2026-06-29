function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[$,]/g, '').trim();
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function normalizeBidItem(item, defaults = {}, index = 0) {
  const description = cleanText(item.description ?? item.item_description ?? item.name);
  if (!description) return null;

  const rawText = cleanText(item.raw_text ?? item.rawText ?? [
    item.item_number,
    item.item_code,
    description,
    item.quantity_raw ?? item.quantity,
    item.unit_of_measure ?? item.unit,
  ].filter(Boolean).join(' '));

  return {
    opportunity_candidate_id: defaults.candidateId,
    opportunity_document_id: item.opportunity_document_id ?? item.document_id ?? defaults.documentId ?? null,
    source_portal: item.source_portal ?? defaults.sourcePortal ?? null,
    source_opportunity_id: item.source_opportunity_id ?? defaults.sourceOpportunityId ?? null,
    section_name: cleanText(item.section_name ?? item.section ?? defaults.sectionName) || null,
    section_number: cleanText(item.section_number ?? defaults.sectionNumber) || null,
    item_number: cleanText(item.item_number ?? item.item_no ?? item.number) || null,
    item_code: cleanText(item.item_code ?? item.code) || null,
    description,
    unit_of_measure: cleanText(item.unit_of_measure ?? item.unit) || null,
    quantity: parseNumber(item.quantity ?? item.qty),
    quantity_raw: cleanText(item.quantity_raw ?? item.quantity ?? item.qty) || null,
    reference: cleanText(item.reference ?? item.ref) || null,
    unit_price: parseNumber(item.unit_price),
    unit_price_raw: cleanText(item.unit_price_raw ?? item.unit_price) || null,
    raw_text: rawText || null,
    extraction_method: item.extraction_method ?? defaults.extractionMethod ?? 'portal_tab',
    extraction_status: item.extraction_status ?? defaults.extractionStatus ?? 'extracted',
    source_url: item.source_url ?? defaults.sourceUrl ?? null,
    source_order: Number.isFinite(Number(item.source_order)) ? Number(item.source_order) : index + 1,
    metadata: item.metadata ?? {},
    extracted_at: defaults.extractedAt ?? new Date().toISOString(),
  };
}

async function replaceBidItemsForCandidate({
  supabase,
  candidateId,
  items,
  methods,
  defaults = {},
  log = () => {},
}) {
  const methodList = Array.isArray(methods) && methods.length > 0
    ? methods
    : [defaults.extractionMethod ?? 'portal_tab'];

  const { error: deleteError } = await supabase
    .from('opportunity_bid_items')
    .delete()
    .eq('opportunity_candidate_id', candidateId)
    .in('extraction_method', methodList);
  if (deleteError) throw new Error(`Bid item cleanup failed: ${deleteError.message}`);

  const rows = (items ?? [])
    .map((item, index) => normalizeBidItem(item, { ...defaults, candidateId }, index))
    .filter(Boolean);

  if (rows.length === 0) {
    log(`Bid items: no ${methodList.join('/')} rows to store`);
    return { inserted: 0, deleted_methods: methodList };
  }

  const { error: insertError } = await supabase
    .from('opportunity_bid_items')
    .insert(rows);
  if (insertError) throw new Error(`Bid item insert failed: ${insertError.message}`);

  log(`Bid items stored: ${rows.length} (${methodList.join('/')})`);
  return { inserted: rows.length, deleted_methods: methodList };
}

async function replacePortalBidItemsForCandidate(options) {
  return replaceBidItemsForCandidate({
    ...options,
    methods: ['portal_tab', 'document_table', 'document_ai', 'manual', 'import'],
    defaults: {
      ...(options.defaults ?? {}),
      extractionMethod: 'portal_tab',
    },
  });
}

module.exports = {
  cleanText,
  normalizeBidItem,
  replaceBidItemsForCandidate,
  replacePortalBidItemsForCandidate,
};
