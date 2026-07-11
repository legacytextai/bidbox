// Cal eProcure document acquisition.
//
// Cal eProcure does not expose stable direct document URLs in discovery
// metadata. The stable idempotency key is synthesized from the Event Package
// manifest (`caleprocure://event/{eventId}/attachment/{order}/{filename}`).
// The transient browser download flow is used only at acquisition time.

const {
  extractSupportedArchiveEntries,
  isArchiveFile,
} = require('./archive_extraction');
const {
  openBrowser,
  waitForDetail,
  extractDetailMetadata,
  buildCandidateFromDetail,
  openEventPackage,
  extractEventPackage,
  sanitizeFileName,
  inferFileType,
  extensionToContentType,
} = require('./caleprocure');
const { fetchBrowserbaseDownloadZipEntries } = require('../lib/browserbase');

const DOCUMENT_BUCKET = 'opportunity-documents';

function parseNumberEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function maxDocumentsPerCandidate() {
  return parseNumberEnv('CALEPROCURE_MAX_DOCUMENTS_PER_CANDIDATE', 40);
}

function maxSingleDocumentBytes() {
  return parseNumberEnv('CALEPROCURE_MAX_SINGLE_DOCUMENT_BYTES', 150 * 1024 * 1024);
}

function maxDocumentBytesPerCandidate() {
  return parseNumberEnv('CALEPROCURE_MAX_DOCUMENT_BYTES_PER_CANDIDATE', 900 * 1024 * 1024);
}

function allowedExtensions() {
  const raw = process.env.CALEPROCURE_ALLOWED_DOCUMENT_EXTENSIONS;
  const defaults = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'zip'];
  const parsed = raw
    ? raw.split(',').map((item) => item.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
    : defaults;
  return new Set(parsed.length ? parsed : defaults);
}

function cssAttr(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const CALEPROCURE_DOWNLOAD_CONTROL_SELECTOR = [
  '[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]',
  '[data-if-label*="Download"]',
  '[name*="Download"]',
  'button',
  'a',
  'input[type="button"]',
  'input[type="image"]',
  '[role="button"]',
  '[onclick]',
].join(',');

function archiveParentProcessingStatus(extraction) {
  if (!extraction) return null;
  if (extraction.stats.rejected) return 'partial';
  if (extraction.stats.failed > 0) return 'partial';
  if (extraction.stats.extracted === 0) return 'partial';
  return 'processed';
}

function archiveParentProcessingError(extraction) {
  if (!extraction) return null;
  if (extraction.stats.rejected) return `Archive skipped: ${extraction.stats.reason}`;
  if (extraction.stats.extracted === 0) return 'Archive contained no supported files for extraction';
  if (extraction.stats.failed > 0) return `${extraction.stats.failed} archive file(s) failed to extract`;
  return null;
}

async function upsertDocumentRecord(supabase, taskId, candidateId, doc) {
  const { data: existing, error: existingError } = await supabase
    .from('opportunity_documents')
    .select('id, acquisition_status, storage_path')
    .eq('opportunity_candidate_id', candidateId)
    .eq('source_url', doc.source_url)
    .maybeSingle();
  if (existingError) throw new Error(`Document lookup failed: ${existingError.message}`);
  if (existing?.acquisition_status === 'acquired' && existing.storage_path) {
    return { record: existing, skipped: true };
  }

  const payload = {
    opportunity_candidate_id: candidateId,
    agent_task_id: taskId,
    file_name: doc.file_name,
    file_type: doc.file_type,
    source_url: doc.source_url,
    file_size: doc.file_size ?? null,
    acquisition_status: 'queued',
    acquisition_error: null,
    manifest_data: doc.manifest_data,
    document_family: doc.document_family,
    document_class: doc.document_class,
    document_source_order: doc.document_source_order,
    is_addendum: doc.is_addendum ?? false,
    addendum_number: doc.addendum_number ?? null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('opportunity_documents')
      .update(payload)
      .eq('id', existing.id)
      .select('id, acquisition_status, storage_path')
      .single();
    if (error) throw new Error(`Document update failed: ${error.message}`);
    return { record: data, skipped: false };
  }

  const { data, error } = await supabase
    .from('opportunity_documents')
    .insert(payload)
    .select('id, acquisition_status, storage_path')
    .single();
  if (error) throw new Error(`Document insert failed: ${error.message}`);
  return { record: data, skipped: false };
}

async function storeExtractedArchiveDocuments({ supabase, taskId, candidateId, parentDoc, entries, log }) {
  const stored = [];
  let index = 0;
  for (const entry of entries) {
    index++;
    const fileName = sanitizeFileName(entry.file_name);
    let record = null;
    const childDoc = {
      file_name: fileName,
      file_type: inferFileType(fileName),
      file_size: entry.file_size,
      source_url: `${parentDoc.source_url}#archive-entry=${encodeURIComponent(entry.entry_path)}`,
      document_source_order: (parentDoc.document_source_order ?? 0) * 1000 + index,
      document_family: parentDoc.document_family,
      document_class: parentDoc.document_class,
      manifest_data: {
        ...(parentDoc.manifest_data ?? {}),
        source: 'archive_extraction',
        archive_parent_document_id: parentDoc.id,
        archive_parent_file_name: parentDoc.file_name,
        archive_entry_path: entry.entry_path,
        acquisition_method: 'caleprocure_event_package_archive_extraction',
      },
    };

    try {
      const upserted = await upsertDocumentRecord(supabase, taskId, candidateId, childDoc);
      record = upserted.record;
      if (upserted.skipped) {
        stored.push({ status: 'skipped', id: record.id, filename: fileName, uploadedPath: record.storage_path });
        continue;
      }

      await supabase
        .from('opportunity_documents')
        .update({ acquisition_status: 'acquiring', acquisition_error: null })
        .eq('id', record.id);

      const storagePath = `opportunity-candidates/${candidateId}/${parentDoc.id}/extracted/${record.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, entry.bytes, { contentType: extensionToContentType(fileName), upsert: true });
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

      await supabase
        .from('opportunity_documents')
        .update({
          acquisition_status: 'acquired',
          acquisition_error: null,
          storage_bucket: DOCUMENT_BUCKET,
          storage_path: storagePath,
          file_name: fileName,
          file_size: entry.file_size,
          file_type: inferFileType(fileName),
          manifest_data: childDoc.manifest_data,
        })
        .eq('id', record.id);

      stored.push({ status: 'acquired', id: record.id, filename: fileName, bytes: entry.file_size, uploadedPath: storagePath });
    } catch (e) {
      if (record?.id) {
        await supabase
          .from('opportunity_documents')
          .update({ acquisition_status: 'failed', acquisition_error: e.message })
          .eq('id', record.id);
      }
      log(`Cal eProcure archive entry failed: ${entry.entry_path}: ${e.message}`);
      stored.push({ status: 'failed', filename: fileName, error: e.message });
    }
  }
  return stored;
}

async function updateCandidateManifest({ supabase, candidate, detail, eventPackage, listingUrl }) {
  const parsed = buildCandidateFromDetail({
    listingUrl: candidate.crawl_data?.listing_url || listingUrl || candidate.source_url,
    row: {
      eventId: candidate.portal_bid_id ?? eventPackage.eventId,
      title: candidate.raw_title,
      department: candidate.agency,
    },
    target: {
      sourceUrl: candidate.source_url,
      eventId: eventPackage.eventId,
      businessUnit: candidate.crawl_data?.business_unit ?? null,
    },
    detail,
  });

  const mergedCrawlData = {
    ...(candidate.crawl_data ?? {}),
    ...parsed.crawl_data,
    event_package: {
      url: eventPackage.url,
      page_title: eventPackage.pageTitle,
      event_id: eventPackage.eventId,
      event_name: eventPackage.eventName,
      comments: eventPackage.comments,
      attachment_count: eventPackage.attachment_count,
      extracted_at: eventPackage.extracted_at,
    },
    event_package_comments: eventPackage.comments,
    documents: eventPackage.documents,
    document_acquisition_supported: true,
    document_acquisition_note: 'Cal eProcure Event Package documents are acquired only by explicit user action.',
  };

  const updatePayload = {
    crawl_data: mergedCrawlData,
  };
  if (parsed.estimated_value != null) {
    updatePayload.estimated_value = parsed.estimated_value;
    updatePayload.estimated_value_low = parsed.estimated_value_low;
    updatePayload.estimated_value_high = parsed.estimated_value_high;
  }
  if (parsed.county || candidate.county) {
    updatePayload.county = parsed.county || candidate.county;
  }

  await supabase
    .from('opportunity_candidates')
    .update(updatePayload)
    .eq('id', candidate.id);
}

async function clickDownloadControl(page, doc) {
  const candidates = [];
  if (doc.download_control_selector) {
    candidates.push(page.locator(doc.download_control_selector).first());
  }
  if (doc.download_control_id) {
    candidates.push(page.locator(`[id="${cssAttr(doc.download_control_id)}"]`).first());
  }
  if (doc.row_id) {
    candidates.push(page.locator(`[id="${cssAttr(doc.row_id)}"]`).locator(CALEPROCURE_DOWNLOAD_CONTROL_SELECTOR).first());
  }
  const rowByFile = page.locator('[id^="trAUC_ATTCH_HD_VW"]', { hasText: doc.file_name }).first();
  candidates.push(rowByFile.locator(CALEPROCURE_DOWNLOAD_CONTROL_SELECTOR).first());
  const rowByOrder = Number.isFinite(Number(doc.document_source_order))
    ? page.locator('[id^="trAUC_ATTCH_HD_VW"]').nth(Math.max(0, Number(doc.document_source_order) - 1))
    : null;
  if (rowByOrder) {
    candidates.push(rowByOrder.locator(CALEPROCURE_DOWNLOAD_CONTROL_SELECTOR).first());
  }

  for (const locator of candidates) {
    if (!(await locator.count().catch(() => 0))) continue;
    await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
    try {
      await locator.click({ timeout: 15000 });
      return;
    } catch (e) {
      const box = await locator.boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return;
      }
    }
  }
  throw new Error(`Download control not found for ${doc.file_name}`);
}

async function downloadViaBrowser(page, session, doc, seenBrowserbaseEntries, log) {
  await clickDownloadControl(page, doc);
  await page.waitForTimeout(700);

  const ready = page.getByRole('button', { name: /Download Attachment/i }).first();
  if (!(await ready.count().catch(() => 0))) {
    throw new Error(`Download confirmation button not found for ${doc.file_name}`);
  }

  const context = page.context();
  const pagesBefore = new Set(context.pages());
  const downloadPromise = page.waitForEvent('download', { timeout: 25000 })
    .then((download) => ({ download }))
    .catch(() => null);
  const popupPromise = page.waitForEvent('popup', { timeout: 25000 })
    .then((openedPage) => ({ openedPage }))
    .catch(() => null);
  const newPagePromise = context.waitForEvent('page', { timeout: 25000 })
    .then((openedPage) => (openedPage && !pagesBefore.has(openedPage) ? { openedPage } : null))
    .catch(() => null);
  await ready.click({ timeout: 15000 });
  const downloadResult = await Promise.race([
    downloadPromise,
    popupPromise,
    newPagePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 26000)),
  ]);
  const download = downloadResult?.download ?? null;
  const openedPage = downloadResult?.openedPage ?? null;

  if (session.transport === 'local_playwright' && download) {
    const stream = await download.createReadStream();
    if (!stream) throw new Error(`Local Playwright download stream unavailable for ${doc.file_name}`);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    await page.getByRole('button', { name: /^Close$/i }).first().click({ timeout: 3000 }).catch(() => {});
    return Buffer.concat(chunks);
  }

  if (openedPage) {
    try {
      await openedPage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      const url = openedPage.url();
      if (url && !/^about:blank/i.test(url) && !/^chrome-extension:/i.test(url)) {
        const res = await context.request.get(url, { timeout: 60000 });
        if (res.ok()) {
          const bytes = Buffer.from(await res.body());
          if (bytes.length > 0) {
            await openedPage.close().catch(() => {});
            await page.getByRole('button', { name: /^Close$/i }).first().click({ timeout: 3000 }).catch(() => {});
            return bytes;
          }
        }
        log(`Cal eProcure popup fetch failed for ${doc.file_name}: HTTP ${res.status()}`);
      }
    } catch (e) {
      log(`Cal eProcure popup capture failed for ${doc.file_name}: ${e.message}`);
    } finally {
      await openedPage.close().catch(() => {});
    }
  }

  if (!session.sessionId) {
    throw new Error(`No Browserbase session id available for downloaded file ${doc.file_name}`);
  }

  const expected = doc.file_name.toLowerCase();
  const entries = await fetchBrowserbaseDownloadZipEntries(session.sessionId, log);
  const fresh = entries.filter((entry) => !seenBrowserbaseEntries.has(entry.fileName));
  const matched = fresh.find((entry) => entry.fileName.toLowerCase() === expected)
    || fresh.find((entry) => entry.fileName.toLowerCase().includes(expected))
    || fresh[0];
  if (!matched?.bytes?.length) {
    throw new Error(`Browserbase did not sync a fresh download for ${doc.file_name}`);
  }
  for (const entry of entries) seenBrowserbaseEntries.add(entry.fileName);
  await page.getByRole('button', { name: /^Close$/i }).first().click({ timeout: 3000 }).catch(() => {});
  return matched.bytes;
}

async function storeCalEprocureDocument({ supabase, taskId, candidateId, doc, bytes, log }) {
  const { record, skipped } = await upsertDocumentRecord(supabase, taskId, candidateId, doc);
  if (skipped) {
    log(`Skipping already acquired Cal eProcure document: ${doc.file_name}`);
    return { status: 'skipped', id: record.id, filename: doc.file_name, uploadedPath: record.storage_path };
  }

  await supabase
    .from('opportunity_documents')
    .update({ acquisition_status: 'acquiring', acquisition_error: null })
    .eq('id', record.id);

  try {
    if (!bytes?.length) throw new Error(`Download returned an empty file: ${doc.file_name}`);
    if (bytes.byteLength > maxSingleDocumentBytes()) {
      throw new Error(`Document exceeds single-file size limit (${bytes.byteLength} bytes): ${doc.file_name}`);
    }

    const storagePath = `opportunity-candidates/${candidateId}/${record.id}/${doc.file_name}`;
    const mimeType = extensionToContentType(doc.file_name);
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    let archiveExtraction = null;
    let extractedDocuments = [];
    if (isArchiveFile(doc.file_name)) {
      log(`Extracting Cal eProcure archive contents: ${doc.file_name}`);
      archiveExtraction = await extractSupportedArchiveEntries(bytes, log);
      extractedDocuments = await storeExtractedArchiveDocuments({
        supabase,
        taskId,
        candidateId,
        parentDoc: { ...doc, id: record.id },
        entries: archiveExtraction.entries,
        log,
      });
    }

    const mergedManifestData = {
      ...(doc.manifest_data ?? {}),
      ...(archiveExtraction
        ? {
            archive_extraction: {
              status: archiveParentProcessingStatus(archiveExtraction),
              stats: archiveExtraction.stats,
              skipped: archiveExtraction.skipped.slice(0, 50),
              failures: archiveExtraction.failures.slice(0, 25),
              extracted_document_ids: extractedDocuments.map((item) => item.id).filter(Boolean),
            },
          }
        : {}),
    };

    await supabase
      .from('opportunity_documents')
      .update({
        acquisition_status: 'acquired',
        acquisition_error: null,
        storage_bucket: DOCUMENT_BUCKET,
        storage_path: storagePath,
        file_name: doc.file_name,
        file_size: bytes.byteLength,
        file_type: inferFileType(doc.file_name),
        manifest_data: mergedManifestData,
        ...(archiveExtraction
          ? {
              processing_status: archiveParentProcessingStatus(archiveExtraction),
              processing_error: archiveParentProcessingError(archiveExtraction),
              processing_completed_at: new Date().toISOString(),
              processing_metadata: { reason: 'archive_extracted_in_f2', stats: archiveExtraction.stats },
              detected_file_type: 'zip',
              detected_mime_type: mimeType,
              has_text: false,
              needs_ocr: false,
            }
          : {}),
      })
      .eq('id', record.id);

    return {
      status: 'acquired',
      id: record.id,
      filename: doc.file_name,
      bytes: bytes.byteLength,
      uploadedPath: storagePath,
      archiveExtraction: archiveExtraction ? { stats: archiveExtraction.stats, extractedDocuments } : null,
    };
  } catch (e) {
    await supabase
      .from('opportunity_documents')
      .update({ acquisition_status: 'failed', acquisition_error: e.message })
      .eq('id', record.id);
    throw e;
  }
}

async function acquireCalEprocureDocuments({ supabase, task, candidate, log }) {
  const requestedKey = task.payload?.requested_document_key || task.payload?.source_document_key || null;
  const allowed = allowedExtensions();
  const maxDocs = maxDocumentsPerCandidate();
  const maxTotalBytes = maxDocumentBytesPerCandidate();
  let session = null;
  const acquiredDocuments = [];
  const errors = [];
  const failedSample = [];
  const storagePathsSample = [];
  const documentIdsSample = [];
  let acquired = 0;
  let skipped = 0;
  let failed = 0;
  let unsupported = 0;
  let totalBytesUploaded = 0;

  try {
    log(`Opening Cal eProcure detail for document acquisition: ${candidate.source_url}`);
    session = await openBrowser(log);
    await session.page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForDetail(session.page);
    const detail = await extractDetailMetadata(session.page);
    await openEventPackage(session.page, log, { sourceUrl: candidate.source_url });
    const eventPackage = await extractEventPackage(session.page, candidate.portal_bid_id ?? candidate.crawl_data?.event_id ?? null);
    await updateCandidateManifest({ supabase, candidate, detail, eventPackage, listingUrl: candidate.crawl_data?.listing_url });

    let manifestDocs = eventPackage.documents
      .filter((doc) => !requestedKey || doc.source_key === requestedKey)
      .map((doc) => ({
        ...doc,
        source_url: doc.source_key,
        file_name: sanitizeFileName(doc.file_name),
        file_type: doc.file_type || inferFileType(doc.file_name),
        manifest_data: {
          source: 'caleprocure_event_package',
          event_id: eventPackage.eventId,
          event_name: eventPackage.eventName,
          event_package_url: eventPackage.url,
          event_package_comments: eventPackage.comments,
          source_key: doc.source_key,
          file_extension: doc.file_extension,
          download_control_id: doc.download_control_id,
          download_control_selector: doc.download_control_selector,
          download_control_index: doc.download_control_index,
          row_id: doc.row_id,
          acquisition_method: 'caleprocure_browser_event_package_download',
        },
      }));

    const documentsDiscovered = eventPackage.documents.length;
    if (requestedKey && manifestDocs.length === 0) {
      return {
        found: 0,
        acquired: 0,
        skipped: 0,
        failed: 1,
        errorSummary: `Requested Cal eProcure document was not found in the Event Package manifest: ${requestedKey}`,
        errors: [`requested_document_not_found:${requestedKey}`],
        documents_discovered: documentsDiscovered,
      };
    }

    manifestDocs = manifestDocs.filter((doc) => {
      const ext = String(doc.file_type ?? '').toLowerCase();
      if (ext && allowed.has(ext)) return true;
      unsupported++;
      log(`Skipping unsupported Cal eProcure file: ${doc.file_name} (ext=${ext || 'none'})`);
      return false;
    });

    if (manifestDocs.length > maxDocs) {
      log(`Cal eProcure manifest (${manifestDocs.length}) exceeds CALEPROCURE_MAX_DOCUMENTS_PER_CANDIDATE (${maxDocs}); capping`);
      manifestDocs = manifestDocs.slice(0, maxDocs);
    }

    const seenBrowserbaseEntries = new Set();
    const attempted = manifestDocs.length;
    for (const doc of manifestDocs) {
      try {
        if (totalBytesUploaded >= maxTotalBytes) {
          skipped++;
          acquiredDocuments.push({ status: 'skipped', filename: doc.file_name, reason: 'total_byte_budget_exceeded' });
          continue;
        }
        const existing = await supabase
          .from('opportunity_documents')
          .select('id, acquisition_status, storage_path')
          .eq('opportunity_candidate_id', candidate.id)
          .eq('source_url', doc.source_url)
          .maybeSingle();
        if (existing.error) throw new Error(`Document lookup failed: ${existing.error.message}`);
        if (existing.data?.acquisition_status === 'acquired' && existing.data.storage_path) {
          skipped++;
          documentIdsSample.push(existing.data.id);
          acquiredDocuments.push({ status: 'skipped', id: existing.data.id, filename: doc.file_name, uploadedPath: existing.data.storage_path });
          continue;
        }

        const bytes = await downloadViaBrowser(session.page, session, doc, seenBrowserbaseEntries, log);
        const stored = await storeCalEprocureDocument({ supabase, taskId: task.id, candidateId: candidate.id, doc, bytes, log });
        acquiredDocuments.push(stored);
        if (stored.status === 'acquired') {
          acquired++;
          totalBytesUploaded += stored.bytes ?? 0;
          if (stored.id) documentIdsSample.push(stored.id);
          if (stored.uploadedPath) storagePathsSample.push(stored.uploadedPath);
        } else if (stored.status === 'skipped') {
          skipped++;
          if (stored.id) documentIdsSample.push(stored.id);
        }
        if (stored.archiveExtraction?.extractedDocuments?.length) {
          for (const child of stored.archiveExtraction.extractedDocuments) {
            acquiredDocuments.push(child);
            if (child.status === 'acquired') {
              acquired++;
              totalBytesUploaded += child.bytes ?? 0;
              if (child.id) documentIdsSample.push(child.id);
              if (child.uploadedPath) storagePathsSample.push(child.uploadedPath);
            } else if (child.status === 'skipped') {
              skipped++;
            } else if (child.status === 'failed') {
              failed++;
              failedSample.push({ filename: child.filename, error: child.error });
            }
          }
        }
      } catch (e) {
        failed++;
        const message = `${doc.file_name}: ${e.message}`;
        errors.push(message);
        failedSample.push({ filename: doc.file_name, error: e.message });
        log(`Cal eProcure document failed: ${message}`);
      }
    }

    log(`Cal eProcure acquisition complete: discovered=${documentsDiscovered} attempted=${attempted} acquired=${acquired} skipped=${skipped} failed=${failed} unsupported=${unsupported} bytes=${totalBytesUploaded}`);
    const totalSkipped = skipped + unsupported;
    return {
      found: documentsDiscovered,
      acquired,
      skipped: totalSkipped,
      failed,
      acquiredDocuments,
      stats: { discovered: documentsDiscovered, attempted, acquired, skipped, unsupported, failed },
      warningSummary: failed > 0 && (acquired + skipped) > 0
        ? `Some source documents could not be acquired. BidBox successfully acquired ${acquired + skipped} of ${attempted} available documents.`
        : null,
      errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
      errors,
      documents_discovered: documentsDiscovered,
      documents_attempted: attempted,
      documents_uploaded: acquired,
      documents_existing: skipped,
      documents_skipped: totalSkipped,
      documents_failed: failed,
      unsupported_file_count: unsupported,
      documents_unsupported: unsupported,
      total_bytes_uploaded: totalBytesUploaded,
      failed_documents_sample: failedSample.slice(0, 10),
      storage_paths_sample: storagePathsSample.slice(0, 10),
      opportunity_document_ids_sample: documentIdsSample.slice(0, 10),
      event_package_attachment_count: documentsDiscovered,
    };
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }
}

module.exports = {
  acquireCalEprocureDocuments,
  DOCUMENT_BUCKET,
};
