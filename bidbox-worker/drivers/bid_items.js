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

async function countBidItemsByMethod(supabase, candidateId, methods) {
  const { count, error } = await supabase
    .from('opportunity_bid_items')
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_candidate_id', candidateId)
    .in('extraction_method', methods);
  if (error) throw new Error(`Bid item count failed: ${error.message}`);
  return count ?? 0;
}

function parseDocumentBidItemLine(line) {
  const text = cleanText(line);
  if (!text || text.length < 12 || text.length > 260) return null;
  if (/^(item|no\.?|description|quantity|unit|total)\b/i.test(text)) return null;

  const caltransStyle = text.match(/^(\d{1,4})\s+([A-Z0-9-]{4,})\s+(.+?)\s+([A-Z]{1,8})\s+([\d,.]+)$/i);
  if (caltransStyle) {
    return {
      item_number: caltransStyle[1],
      item_code: caltransStyle[2],
      description: caltransStyle[3],
      unit_of_measure: caltransStyle[4],
      quantity_raw: caltransStyle[5],
      raw_text: text,
    };
  }

  const genericStyle = text.match(/^(\d{1,4}(?:[.-]\d+)?)\s+(.+?)\s+([\d,.]+)\s+([A-Z]{1,12}|LS|EA|LF|SF|CY|SY|TON|HR|DAY|ALLOW(?:ANCE)?)$/i);
  if (genericStyle) {
    return {
      item_number: genericStyle[1],
      description: genericStyle[2],
      quantity_raw: genericStyle[3],
      unit_of_measure: genericStyle[4],
      raw_text: text,
    };
  }

  return null;
}

function documentLooksLikeBidSchedule(document) {
  const haystack = cleanText([
    document?.file_name,
    document?.document_class,
    document?.document_family,
    document?.manifest_data?.category,
    document?.manifest_data?.title,
  ].filter(Boolean).join(' ')).toLowerCase();
  return /bid\s*(form|schedule|items?)|proposal|list\s+of\s+bid\s+items|item\s+list|forms?\s+for\s+bid/.test(haystack);
}

async function extractDocumentDerivedBidItemsForCandidate({ supabase, candidateId, sourcePortal = null, log = () => {} }) {
  const portalCount = await countBidItemsByMethod(supabase, candidateId, ['portal_tab']);
  if (portalCount > 0) {
    log(`Bid item fallback skipped: ${portalCount} portal-native bid item(s) already exist`);
    return { inserted: 0, skipped: true, reason: 'portal_native_exists' };
  }

  const { data: documents, error: docsError } = await supabase
    .from('opportunity_documents')
    .select('id, file_name, document_class, document_family, manifest_data, source_url, document_source_order')
    .eq('opportunity_candidate_id', candidateId)
    .eq('processing_status', 'processed')
    .order('document_source_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (docsError) throw new Error(`Bid item fallback document lookup failed: ${docsError.message}`);

  const candidateDocuments = (documents ?? []).filter(documentLooksLikeBidSchedule).slice(0, 6);
  if (candidateDocuments.length === 0) {
    await replaceBidItemsForCandidate({
      supabase,
      candidateId,
      items: [],
      methods: ['document_table'],
      defaults: { extractionMethod: 'document_table' },
      log,
    });
    return { inserted: 0, skipped: true, reason: 'no_candidate_documents' };
  }

  const documentIds = candidateDocuments.map((doc) => doc.id);
  const { data: pages, error: pagesError } = await supabase
    .from('opportunity_document_pages')
    .select('id, opportunity_document_id, page_number, page_label, text')
    .in('opportunity_document_id', documentIds)
    .order('page_number', { ascending: true });
  if (pagesError) throw new Error(`Bid item fallback page lookup failed: ${pagesError.message}`);

  const documentsById = new Map(candidateDocuments.map((doc) => [doc.id, doc]));
  const rows = [];
  const seen = new Set();
  for (const page of pages ?? []) {
    const doc = documentsById.get(page.opportunity_document_id);
    if (!doc || !page.text) continue;
    const pageLines = String(page.text)
      .split(/\n+/)
      .map((line) => cleanText(line))
      .filter(Boolean);
    const pageHasScheduleSignal = pageLines.some((line) => /bid\s*(schedule|items?)|proposal\s*form|list\s+of\s+bid\s+items/i.test(line));
    if (!pageHasScheduleSignal && !documentLooksLikeBidSchedule(doc)) continue;

    for (const line of pageLines) {
      const parsed = parseDocumentBidItemLine(line);
      if (!parsed) continue;
      const key = `${parsed.item_number ?? ''}|${parsed.item_code ?? ''}|${parsed.description}|${parsed.quantity_raw ?? ''}|${parsed.unit_of_measure ?? ''}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        ...parsed,
        opportunity_document_id: doc.id,
        source_portal: sourcePortal,
        section_name: 'Document Bid Schedule',
        extraction_method: 'document_table',
        extraction_status: 'needs_review',
        source_url: doc.source_url,
        source_order: rows.length + 1,
        metadata: {
          source: 'document_table_fallback',
          source_document_name: doc.file_name,
          page_number: page.page_number,
          page_label: page.page_label,
          conservative_fallback: true,
        },
      });
      if (rows.length >= 200) break;
    }
    if (rows.length >= 200) break;
  }

  const result = await replaceBidItemsForCandidate({
    supabase,
    candidateId,
    items: rows,
    methods: ['document_table'],
    defaults: {
      sourcePortal,
      extractionMethod: 'document_table',
      extractionStatus: 'needs_review',
    },
    log,
  });
  return { ...result, skipped: false, reason: rows.length === 0 ? 'no_conservative_rows_found' : null };
}

module.exports = {
  cleanText,
  normalizeBidItem,
  replaceBidItemsForCandidate,
  countBidItemsByMethod,
  extractDocumentDerivedBidItemsForCandidate,
};
