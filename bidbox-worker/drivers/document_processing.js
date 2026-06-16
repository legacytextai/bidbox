const PDF_CHUNK_CHAR_LIMIT = 3500;
const PDF_MIN_TEXT_CHARS = 50;

function cleanText(value) {
  return String(value ?? '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

function normalizeForClass(value) {
  return String(value ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferFileType(fileName, detectedMimeType) {
  const lower = String(fileName ?? '').toLowerCase();
  const ext = lower.match(/\.([a-z0-9]+)$/)?.[1] ?? null;
  if (ext) return ext;
  if (detectedMimeType === 'application/pdf') return 'pdf';
  return null;
}

function detectMimeType(fileName, bytes) {
  const lower = String(fileName ?? '').toLowerCase();
  if (bytes?.subarray?.(0, 4)?.toString?.() === '%PDF' || lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dwg')) return 'image/vnd.dwg';
  return 'application/octet-stream';
}

function extractAddendumNumber(text) {
  const m = String(text ?? '').match(/\baddend(?:um|a)\s*(?:no\.?|number|#)?\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
}

function classifyDocument(document, firstPageText = '') {
  const source = normalizeForClass([
    document.file_name,
    document.manifest_data?.title,
    document.manifest_data?.fileTitle,
    document.manifest_data?.filename,
    firstPageText.slice(0, 2000),
  ].filter(Boolean).join(' '));

  let documentClass = 'unknown';
  if (/\baddend(?:um|a)\b/.test(source)) documentClass = 'addendum';
  else if (/\b(plans?|drawings?|sheets?)\b/.test(source)) documentClass = 'plans';
  else if (/\b(project manual|specifications?|specs?)\b/.test(source)) documentClass = 'specifications';
  else if (/\bbid(?:ding)?\s*(proposal|form|schedule|sheet)|proposal form\b/.test(source)) documentClass = 'bid_form';
  else if (/\bnotice inviting bids?\b|\binvitation for bids?\b/.test(source)) documentClass = 'notice_inviting_bids';
  else if (/\binstructions? to bidders?\b/.test(source)) documentClass = 'instructions_to_bidders';
  else if (/\bagreement\b|\bcontract agreement\b/.test(source)) documentClass = 'agreement';
  else if (/\bgeneral conditions?\b/.test(source)) documentClass = 'general_conditions';
  else if (/\bspecial provisions?\b/.test(source)) documentClass = 'special_provisions';
  else if (/\binsurance\b/.test(source)) documentClass = 'insurance';
  else if (/\bbond\b/.test(source)) documentClass = 'bond';
  else if (/\bprevailing wage|labor compliance|dir registration\b/.test(source)) documentClass = 'prevailing_wage';
  else if (/\b(plan holders?|prospective bidders?|bidder list|vendors? list)\b/.test(source)) documentClass = 'bidder_list';
  else if (/\b(q\s*&\s*a|questions? and answers?|rfi)\b/.test(source)) documentClass = 'qa';
  else if (source) documentClass = 'supporting_document';

  const familyMap = {
    plans: 'plans',
    specifications: 'specifications',
    addendum: 'addenda',
    bid_form: 'bid_forms',
    notice_inviting_bids: 'contract_documents',
    instructions_to_bidders: 'contract_documents',
    agreement: 'contract_documents',
    general_conditions: 'contract_documents',
    special_provisions: 'contract_documents',
    insurance: 'insurance',
    bond: 'bonds',
    prevailing_wage: 'labor_compliance',
    bidder_list: 'bidder_communications',
    qa: 'bidder_communications',
    supporting_document: 'supporting_documents',
    unknown: 'unknown',
  };

  const precedenceMap = {
    addendum: 10,
    bid_form: 20,
    notice_inviting_bids: 30,
    instructions_to_bidders: 35,
    special_provisions: 40,
    agreement: 50,
    general_conditions: 55,
    specifications: 60,
    plans: 70,
    insurance: 80,
    bond: 85,
    prevailing_wage: 90,
    bidder_list: 95,
    qa: 95,
    supporting_document: 100,
    unknown: 110,
  };

  const addendumNumber = extractAddendumNumber(source);
  const isAddendum = documentClass === 'addendum';
  const inferredPrecedenceRank = isAddendum && addendumNumber
    ? Math.max(1, 13 - addendumNumber)
    : precedenceMap[documentClass] ?? 110;

  return {
    document_class: documentClass,
    document_family: familyMap[documentClass] ?? 'unknown',
    document_subclass: null,
    is_addendum: isAddendum,
    addendum_number: addendumNumber,
    document_sequence: addendumNumber,
    inferred_precedence_rank: inferredPrecedenceRank,
  };
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text ?? '').length / 4));
}

function buildCitationLabel(fileName, pageStart, pageEnd, firstPage) {
  const sheet = firstPage?.sheet_number ? `, Sheet ${firstPage.sheet_number}` : '';
  if (pageStart === pageEnd) return `${fileName}${sheet}, p. ${pageStart}`;
  return `${fileName}${sheet}, pp. ${pageStart}-${pageEnd}`;
}

function inferSheetMetadata(text) {
  const head = String(text ?? '').slice(0, 2000);
  const sheetNumber = head.match(/\b(?:sheet\s*)?([A-Z]{1,3}[- ]?\d+(?:\.\d+)?)\b/i)?.[1] ?? null;
  const titleLine = head
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length >= 8 && line.length <= 90 && /[A-Za-z]/.test(line)) ?? null;

  return {
    sheet_number: sheetNumber,
    sheet_title: titleLine,
  };
}

function textContentToString(textContent) {
  const parts = [];
  for (const item of textContent.items ?? []) {
    if (typeof item.str !== 'string') continue;
    parts.push(item.str);
    if (item.hasEOL) parts.push('\n');
    else parts.push(' ');
  }
  return cleanText(parts.join(''));
}

async function loadPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

async function extractPdfPages(bytes) {
  const pdfjs = await loadPdfjs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });

  const pdf = await loadingTask.promise;
  const labels = await pdf.getPageLabels().catch(() => null);
  const pages = [];

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent({ includeMarkedContent: false });
        const text = textContentToString(textContent);
        const sheet = inferSheetMetadata(text);
        pages.push({
          page_number: pageNumber,
          page_label: labels?.[pageNumber - 1] ?? null,
          text,
          char_count: text.length,
          extraction_method: 'pdfjs_text',
          text_confidence: text.length > 0 ? 1 : 0,
          ...sheet,
        });
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await pdf.cleanup().catch(() => {});
    await Promise.resolve(pdf.destroy()).catch(() => {});
  }

  return pages;
}

function createChunks(document, pages, classification) {
  const chunks = [];
  let currentText = '';
  let pageStart = null;
  let pageEnd = null;
  let firstPage = null;

  const flush = () => {
    const text = cleanText(currentText);
    if (!text) return;
    chunks.push({
      opportunity_document_id: document.id,
      opportunity_candidate_id: document.opportunity_candidate_id,
      page_start: pageStart,
      page_end: pageEnd,
      chunk_index: chunks.length + 1,
      text,
      char_count: text.length,
      token_estimate: estimateTokens(text),
      document_class: classification.document_class,
      document_family: classification.document_family,
      citation_label: buildCitationLabel(document.file_name, pageStart, pageEnd, firstPage),
    });
    currentText = '';
    pageStart = null;
    pageEnd = null;
    firstPage = null;
  };

  for (const page of pages) {
    const text = cleanText(page.text);
    if (!text) continue;

    if (text.length > PDF_CHUNK_CHAR_LIMIT) {
      flush();
      let offset = 0;
      while (offset < text.length) {
        const slice = cleanText(text.slice(offset, offset + PDF_CHUNK_CHAR_LIMIT));
        if (slice) {
          chunks.push({
            opportunity_document_id: document.id,
            opportunity_candidate_id: document.opportunity_candidate_id,
            page_start: page.page_number,
            page_end: page.page_number,
            chunk_index: chunks.length + 1,
            text: slice,
            char_count: slice.length,
            token_estimate: estimateTokens(slice),
            document_class: classification.document_class,
            document_family: classification.document_family,
            citation_label: buildCitationLabel(document.file_name, page.page_number, page.page_number, page),
          });
        }
        offset += PDF_CHUNK_CHAR_LIMIT;
      }
      continue;
    }

    if (currentText && currentText.length + text.length + 2 > PDF_CHUNK_CHAR_LIMIT) {
      flush();
    }

    if (!currentText) {
      pageStart = page.page_number;
      firstPage = page;
    }
    pageEnd = page.page_number;
    currentText += `${currentText ? '\n\n' : ''}${text}`;
  }

  flush();
  return chunks;
}

async function replaceDocumentEvidence(supabase, documentId, pages, chunks) {
  const { error: deleteChunkError } = await supabase
    .from('opportunity_document_chunks')
    .delete()
    .eq('opportunity_document_id', documentId);
  if (deleteChunkError) throw new Error(`Chunk cleanup failed: ${deleteChunkError.message}`);

  const { error: deletePageError } = await supabase
    .from('opportunity_document_pages')
    .delete()
    .eq('opportunity_document_id', documentId);
  if (deletePageError) throw new Error(`Page cleanup failed: ${deletePageError.message}`);

  if (pages.length > 0) {
    const { error: pageInsertError } = await supabase
      .from('opportunity_document_pages')
      .insert(pages);
    if (pageInsertError) throw new Error(`Page insert failed: ${pageInsertError.message}`);
  }

  if (chunks.length > 0) {
    const { error: chunkInsertError } = await supabase
      .from('opportunity_document_chunks')
      .insert(chunks);
    if (chunkInsertError) throw new Error(`Chunk insert failed: ${chunkInsertError.message}`);
  }
}

async function downloadStoredDocument(supabase, document) {
  if (!document.storage_bucket || !document.storage_path) {
    throw new Error('Document is missing storage location');
  }

  const { data, error } = await supabase.storage
    .from(document.storage_bucket)
    .download(document.storage_path);
  if (error) throw new Error(`Storage download failed: ${error.message}`);
  if (!data) throw new Error('Storage download returned no data');

  return Buffer.from(await data.arrayBuffer());
}

async function processDocument({ supabase, document, sourceOrder, retryFailed, log }) {
  const startedAt = new Date().toISOString();
  const skippedStatuses = retryFailed
    ? ['processing']
    : ['processing', 'processed'];
  if (skippedStatuses.includes(document.processing_status)) {
    log(`Skipping document already ${document.processing_status}: ${document.file_name}`);
    return { status: 'skipped' };
  }

  await supabase
    .from('opportunity_documents')
    .update({
      processing_status: 'processing',
      processing_started_at: startedAt,
      processing_completed_at: null,
      processing_error: null,
      document_source_order: document.document_source_order ?? sourceOrder,
    })
    .eq('id', document.id);

  try {
    const bytes = await downloadStoredDocument(supabase, document);
    const detectedMimeType = detectMimeType(document.file_name, bytes);
    const detectedFileType = inferFileType(document.file_name, detectedMimeType);

    if (detectedMimeType !== 'application/pdf') {
      const classification = classifyDocument(document);
      await replaceDocumentEvidence(supabase, document.id, [], []);
      await supabase
        .from('opportunity_documents')
        .update({
          ...classification,
          processing_status: 'unsupported',
          processing_completed_at: new Date().toISOString(),
          processing_error: 'Unsupported file type for F3 MVP',
          detected_file_type: detectedFileType,
          detected_mime_type: detectedMimeType,
          text_extraction_method: null,
          text_page_count: null,
          text_char_count: 0,
          has_text: false,
          needs_ocr: false,
          processing_metadata: { reason: 'unsupported_file_type' },
        })
        .eq('id', document.id);
      log(`Unsupported document type: ${document.file_name}`);
      return { status: 'unsupported' };
    }

    const extractedPages = await extractPdfPages(bytes);
    const textCharCount = extractedPages.reduce((sum, page) => sum + page.char_count, 0);
    const firstUsefulPage = extractedPages.find((page) => page.text)?.text ?? '';
    const classification = classifyDocument(document, firstUsefulPage);
    const hasText = textCharCount >= PDF_MIN_TEXT_CHARS;
    const needsOcr = !hasText && extractedPages.length > 0;

    const pageRows = extractedPages.map((page) => ({
      opportunity_document_id: document.id,
      opportunity_candidate_id: document.opportunity_candidate_id,
      page_number: page.page_number,
      page_label: page.page_label,
      sheet_number: page.sheet_number,
      sheet_title: page.sheet_title,
      text: page.text,
      char_count: page.char_count,
      extraction_method: page.extraction_method,
      text_confidence: page.text_confidence,
    }));

    const chunks = hasText ? createChunks(document, extractedPages, classification) : [];
    const finalStatus = hasText && chunks.length > 0 ? 'processed' : 'failed';
    const processingError = finalStatus === 'failed'
      ? (needsOcr ? 'No useful text extracted; OCR required' : 'No useful text extracted')
      : null;

    await replaceDocumentEvidence(supabase, document.id, pageRows, chunks);
    await supabase
      .from('opportunity_documents')
      .update({
        ...classification,
        processing_status: finalStatus,
        processing_completed_at: new Date().toISOString(),
        processing_error: processingError,
        detected_file_type: detectedFileType,
        detected_mime_type: detectedMimeType,
        text_extraction_method: 'pdfjs_text',
        text_page_count: extractedPages.length,
        text_char_count: textCharCount,
        has_text: hasText,
        needs_ocr: needsOcr,
        processing_metadata: {
          engine: 'pdfjs-dist',
          mode: 'text_native_pdf',
          pages_extracted: extractedPages.length,
          chunks_created: chunks.length,
        },
      })
      .eq('id', document.id);

    log(`Processed document: ${document.file_name} pages=${extractedPages.length} chunks=${chunks.length} chars=${textCharCount}`);
    return {
      status: finalStatus,
      pages: extractedPages.length,
      chunks: chunks.length,
      chars: textCharCount,
      needsOcr,
    };
  } catch (e) {
    await supabase
      .from('opportunity_documents')
      .update({
        processing_status: 'failed',
        processing_completed_at: new Date().toISOString(),
        processing_error: e.message,
        has_text: false,
      })
      .eq('id', document.id);
    throw e;
  }
}

async function queueDocumentProcessingForCandidate({ supabase, candidateId, documentIds = [] }) {
  const { data: existing, error: existingError } = await supabase
    .from('agent_tasks')
    .select('id, status')
    .eq('task_type', 'document_processing')
    .in('status', ['pending', 'running', 'retrying'])
    .contains('payload', { candidate_id: candidateId })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(`Document processing task lookup failed: ${existingError.message}`);
  if (existing) return { taskId: existing.id, duplicate: true };

  const now = new Date().toISOString();
  const { error: candidateError } = await supabase
    .from('opportunity_candidates')
    .update({
      document_processing_status: 'queued',
      document_processing_started_at: null,
      document_processing_completed_at: null,
      document_processing_error: null,
    })
    .eq('id', candidateId);
  if (candidateError) throw new Error(`Candidate processing queue update failed: ${candidateError.message}`);

  let docsUpdate = supabase
    .from('opportunity_documents')
    .update({ processing_status: 'queued', processing_error: null })
    .eq('opportunity_candidate_id', candidateId)
    .eq('acquisition_status', 'acquired');
  if (documentIds.length > 0) docsUpdate = docsUpdate.in('id', documentIds);
  const { error: docsError } = await docsUpdate;
  if (docsError) throw new Error(`Document processing queue update failed: ${docsError.message}`);

  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'document_processing',
      status: 'pending',
      priority: 5,
      payload: {
        candidate_id: candidateId,
        document_ids: documentIds,
        source: 'f3_document_processing',
        retry_failed: false,
        queued_at: now,
      },
    })
    .select('id')
    .single();
  if (taskError) throw new Error(`Document processing task insert failed: ${taskError.message}`);

  return { taskId: task.id, duplicate: false };
}

async function runDocumentProcessing(task, supabase, log) {
  const { candidate_id, document_ids = [], retry_failed = false } = task.payload ?? {};
  if (!candidate_id) throw new Error('document_processing task missing candidate_id');

  const startedAt = new Date().toISOString();
  const { data: candidate, error: candidateError } = await supabase
    .from('opportunity_candidates')
    .select('id, raw_title, agency, document_processing_status')
    .eq('id', candidate_id)
    .maybeSingle();
  if (candidateError) throw new Error(`Candidate lookup failed: ${candidateError.message}`);
  if (!candidate) throw new Error(`Candidate not found: ${candidate_id}`);

  await supabase
    .from('opportunity_candidates')
    .update({
      document_processing_status: 'processing',
      document_processing_started_at: startedAt,
      document_processing_completed_at: null,
      document_processing_error: null,
    })
    .eq('id', candidate.id);

  let query = supabase
    .from('opportunity_documents')
    .select('*')
    .eq('opportunity_candidate_id', candidate.id)
    .eq('acquisition_status', 'acquired')
    .order('document_source_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (document_ids.length > 0) query = query.in('id', document_ids);

  const { data: documents, error: documentsError } = await query;
  if (documentsError) throw new Error(`Document lookup failed: ${documentsError.message}`);
  if (!documents || documents.length === 0) throw new Error('No acquired documents found for processing');

  log(`[${candidate.agency ?? 'Unknown agency'}] Starting F3 document processing for ${documents.length} document(s)`);

  const counters = {
    documents_total: documents.length,
    documents_processed: 0,
    documents_partial: 0,
    documents_failed: 0,
    documents_unsupported: 0,
    documents_skipped: 0,
    pages_extracted: 0,
    chunks_created: 0,
    needs_ocr_count: 0,
  };
  const errors = [];

  for (let i = 0; i < documents.length; i++) {
    const document = documents[i];
    try {
      const result = await processDocument({
        supabase,
        document,
        sourceOrder: i + 1,
        retryFailed: retry_failed,
        log,
      });
      if (result.status === 'processed') counters.documents_processed++;
      else if (result.status === 'partial') counters.documents_partial++;
      else if (result.status === 'unsupported') counters.documents_unsupported++;
      else if (result.status === 'failed') counters.documents_failed++;
      else if (result.status === 'skipped') counters.documents_skipped++;
      counters.pages_extracted += result.pages ?? 0;
      counters.chunks_created += result.chunks ?? 0;
      if (result.needsOcr) counters.needs_ocr_count++;
    } catch (e) {
      counters.documents_failed++;
      errors.push(`${document.file_name}: ${e.message}`);
      log(`Document processing failed: ${document.file_name} — ${e.message}`);
    }
  }

  const usefulDocuments = counters.documents_processed + counters.documents_partial;
  const terminalProblems = counters.documents_failed + counters.documents_unsupported + counters.needs_ocr_count;
  const finalStatus = usefulDocuments > 0
    ? terminalProblems > 0 ? 'partial' : 'processed'
    : 'failed';
  const errorSummary = errors.length > 0
    ? errors.slice(0, 5).join(' | ')
    : finalStatus === 'failed'
    ? 'No useful text extracted from acquired documents'
    : null;

  await supabase
    .from('opportunity_candidates')
    .update({
      document_processing_status: finalStatus,
      document_processing_completed_at: new Date().toISOString(),
      document_processing_error: errorSummary,
    })
    .eq('id', candidate.id);

  return {
    candidate_id: candidate.id,
    ...counters,
    status: finalStatus,
    errorSummary,
  };
}

module.exports = {
  queueDocumentProcessingForCandidate,
  runDocumentProcessing,
};
