// OpenGov Phase 3 — document acquisition.
//
// OpenGov project documents are pre-signed S3 URLs embedded in the project
// detail payload (`attachments[].url` and `addendums[].attachments[].url`).
// Those signed URLs EXPIRE, and Phase 2 deliberately stripped them from the
// candidate manifest. So Phase 3 re-fetches a fresh `GET /api/v1/project/:id`
// at acquisition time (through the authenticated Browserbase session that
// clears Cloudflare) to obtain currently-valid URLs, then downloads the bytes
// in Node and uploads them into the existing private `opportunity-documents`
// bucket, creating/updating `opportunity_documents` rows so the existing
// document-processing pipeline (F3) can consume them.
//
// This reuses the SAME acquisition architecture as caltrans_documents.js /
// planetbids_documents.js — bucket, storage-path convention, opportunity_documents
// schema, and archive extraction — it does not invent a second pipeline.
//
// Idempotency: the per-document `source_url` used as the dedup key is a STABLE
// synthesized identifier (`opengov://project/{id}/attachment/{sharedId}`), never
// the expiring signed S3 URL. The transient signed URL is recorded only inside
// manifest_data for traceability. Rerunning acquisition creates no duplicate
// rows or storage objects.

const {
  extractSupportedArchiveEntries,
  isArchiveFile,
} = require('./archive_extraction');
const { openBrowser, openGovLogin, API_BASE } = require('./opengov');

const DOCUMENT_BUCKET = 'opportunity-documents';

// ── Env-driven safety limits (guardrails; not a broad auto-acquisition switch) ──
function parseNumberEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function maxDocumentsPerCandidate() {
  return parseNumberEnv('OPENGOV_MAX_DOCUMENTS_PER_CANDIDATE', 60);
}
function maxSingleDocumentBytes() {
  return parseNumberEnv('OPENGOV_MAX_SINGLE_DOCUMENT_BYTES', 100 * 1024 * 1024); // 100 MB
}
function maxDocumentBytesPerCandidate() {
  return parseNumberEnv('OPENGOV_MAX_DOCUMENT_BYTES_PER_CANDIDATE', 750 * 1024 * 1024); // 750 MB
}
function downloadTimeoutMs() {
  return parseNumberEnv('OPENGOV_DOCUMENT_DOWNLOAD_TIMEOUT_MS', 120000);
}
function acquisitionConcurrency() {
  return Math.max(1, Math.min(parseNumberEnv('OPENGOV_DOCUMENT_ACQUISITION_CONCURRENCY', 3), 8));
}
function allowedExtensions() {
  const raw = process.env.OPENGOV_ALLOWED_DOCUMENT_EXTENSIONS;
  const defaults = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'rtf', 'ppt', 'pptx', 'zip', 'dwg'];
  if (!raw) return new Set(defaults);
  const parsed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
  return new Set(parsed.length ? parsed : defaults);
}

// ── File helpers (mirrors caltrans_documents.js) ──
function sanitizeFileName(name) {
  const cleaned = String(name ?? 'document')
    .replace(/[\/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'document';
}

function inferFileType(fileName) {
  const m = String(fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}

function extensionToContentType(fileName) {
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.rtf')) return 'application/rtf';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dwg')) return 'image/vnd.dwg';
  return 'application/octet-stream';
}

// Ensure the stored filename carries a usable extension (OpenGov `filename`
// usually already includes one; fall back to the `fileExtension` field).
function ensureExtension(fileName, fileExtension) {
  const name = sanitizeFileName(fileName);
  if (/\.[a-z0-9]{1,6}$/i.test(name)) return name;
  const ext = String(fileExtension ?? '').trim().toLowerCase().replace(/^\./, '');
  return ext ? `${name}.${ext}` : name;
}

function documentFamilyFor(fileName, kind) {
  const value = String(fileName ?? '').toLowerCase();
  if (kind === 'addendum' || /addend/.test(value)) return 'addenda';
  if (/plan|drawing|sheet/.test(value)) return 'plans';
  if (/spec|special\s*provision|technical/.test(value)) return 'specifications';
  if (/bid\s*form|proposal\s*form|schedule/.test(value)) return 'bid_forms';
  return 'source_documents';
}

function documentClassFor(fileName, kind) {
  const value = String(fileName ?? '').toLowerCase();
  if (kind === 'addendum' || /addend/.test(value)) return 'addendum';
  if (/plan|drawing|sheet/.test(value)) return 'plans';
  if (/special\s*provision/.test(value)) return 'special_provisions';
  if (/spec/.test(value)) return 'specifications';
  if (/notice|invitation|nib/.test(value)) return 'notice_to_bidders';
  if (/bid\s*form|proposal\s*form|schedule/.test(value)) return 'bid_forms';
  return 'source_document';
}

function stableSourceUrl(projectId, doc) {
  const key = doc.shared_id ?? doc.attachment_id;
  return `opengov://project/${projectId}/attachment/${key}`;
}

// ── Archive parent status helpers (mirrors caltrans_documents.js) ──
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

// ── Fresh manifest fetch (re-fetch detail for currently-valid signed URLs) ──
// Runs inside the authenticated page context (Cloudflare + session cookie).
// Returns document descriptors for top-level attachments PLUS released-addendum
// attachments. `url` is the transient signed S3 URL (valid now, expires later).
async function fetchFreshManifest(page, projectId, log) {
  const raw = await page.evaluate(async ({ apiBase, projectId }) => {
    const res = await fetch(`${apiBase}/project/${projectId}`, { credentials: 'include' });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const json = await res.json();
    const p = json.project || json;
    const docs = [];
    let order = 0;

    const pushAttachment = (a, kind, addendumNumber) => {
      if (!a || !a.url) return;
      order += 1;
      docs.push({
        attachment_id: a.id ?? null,
        shared_id: a.sharedId ?? null,
        appendix_id: a.appendixId ?? null,
        raw_name: a.name || a.filename || null,
        raw_filename: a.filename || a.name || null,
        file_extension: a.fileExtension || null,
        attachment_type: a.type || null,
        url: a.url,
        kind,
        addendum_number: addendumNumber ?? null,
        document_source_order: order,
      });
    };

    for (const a of Array.isArray(p.attachments) ? p.attachments : []) {
      pushAttachment(a, 'project', null);
    }
    for (const ad of Array.isArray(p.addendums) ? p.addendums : []) {
      // Only released addenda carry acquirable documents.
      if (ad && ad.status && String(ad.status).toLowerCase() !== 'released') continue;
      for (const a of Array.isArray(ad.attachments) ? ad.attachments : []) {
        pushAttachment(a, 'addendum', ad.number ?? null);
      }
    }

    return {
      ok: true,
      status: res.status,
      project_title: p.title || null,
      documents: docs,
    };
  }, { apiBase: API_BASE, projectId });

  if (!raw || !raw.ok) {
    throw new Error(`OpenGov detail re-fetch failed for project ${projectId} (HTTP ${raw?.status ?? 'unknown'})`);
  }

  const documents = (raw.documents ?? []).map((d) => {
    const fileName = ensureExtension(d.raw_filename || d.raw_name || `document-${d.attachment_id ?? d.shared_id}`, d.file_extension);
    return {
      ...d,
      file_name: fileName,
      file_type: inferFileType(fileName),
      effective_extension: (inferFileType(fileName) || String(d.file_extension ?? '').toLowerCase().replace(/^\./, '') || ''),
    };
  });

  log(`OpenGov manifest for project ${projectId}: ${documents.length} attachment(s) (${documents.filter((d) => d.kind === 'project').length} base, ${documents.filter((d) => d.kind === 'addendum').length} addendum)`);
  return documents;
}

// ── Download bytes from a pre-signed S3 URL (self-authorizing; Node fetch) ──
async function downloadDocumentBytes(url, { timeoutMs, maxBytes, log, fileName }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) {
      const err = new Error(`Download failed (HTTP ${res.status}) for ${fileName}`);
      if (res.status === 403 || res.status === 401 || res.status === 410) {
        err.code = 'OPENGOV_URL_EXPIRED';
      }
      throw err;
    }
    const declaredLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      const err = new Error(`Document exceeds single-file size limit (${declaredLength} > ${maxBytes} bytes): ${fileName}`);
      err.code = 'OPENGOV_DOC_TOO_LARGE';
      throw err;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) throw new Error(`Download returned an empty file: ${fileName}`);
    if (buf.byteLength > maxBytes) {
      const err = new Error(`Document exceeds single-file size limit (${buf.byteLength} > ${maxBytes} bytes): ${fileName}`);
      err.code = 'OPENGOV_DOC_TOO_LARGE';
      throw err;
    }
    return buf;
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Download timed out after ${timeoutMs}ms: ${fileName}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── opportunity_documents upsert (idempotent on candidate + stable source_url) ──
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

// ── Store an extracted archive entry as a child opportunity_documents row ──
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
      source_url: `${parentDoc.source_url || `archive://${parentDoc.id}`}#archive-entry=${encodeURIComponent(entry.entry_path)}`,
      document_source_order: (parentDoc.document_source_order ?? 0) * 1000 + index,
      document_family: documentFamilyFor(fileName, parentDoc.kind),
      document_class: documentClassFor(fileName, parentDoc.kind),
      manifest_data: {
        ...(parentDoc.manifest_data ?? {}),
        source: 'archive_extraction',
        archive_parent_document_id: parentDoc.id,
        archive_parent_file_name: parentDoc.file_name,
        archive_entry_path: entry.entry_path,
        archive_entry_compressed_size: entry.compressed_size,
        archive_entry_uncompressed_size: entry.uncompressed_size,
        acquisition_method: 'opengov_phase3_archive_extraction',
      },
    };

    try {
      const upserted = await upsertDocumentRecord(supabase, taskId, candidateId, childDoc);
      record = upserted.record;
      if (upserted.skipped) {
        log(`Skipping already acquired archive entry: ${entry.entry_path}`);
        stored.push({ status: 'skipped', id: record.id, filename: fileName, uploadedPath: record.storage_path });
        continue;
      }

      await supabase
        .from('opportunity_documents')
        .update({ acquisition_status: 'acquiring', acquisition_error: null })
        .eq('id', record.id);

      const storagePath = `opportunity-candidates/${candidateId}/${parentDoc.id}/extracted/${record.id}/${fileName}`;
      const mimeType = extensionToContentType(fileName);
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, entry.bytes, { contentType: mimeType, upsert: true });
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

      log(`Uploaded extracted archive document: ${entry.entry_path} (${entry.file_size} bytes)`);
      stored.push({ status: 'acquired', id: record.id, filename: fileName, bytes: entry.file_size, uploadedPath: storagePath });
    } catch (e) {
      if (record?.id) {
        await supabase
          .from('opportunity_documents')
          .update({ acquisition_status: 'failed', acquisition_error: e.message })
          .eq('id', record.id);
      }
      log(`Extracted archive document failed: ${entry.entry_path}: ${e.message}`);
      stored.push({ status: 'failed', filename: fileName, error: e.message });
    }
  }
  return stored;
}

// ── Acquire one OpenGov document: upsert → download → upload → archive ──
async function storeOpenGovDocument({ supabase, taskId, candidateId, doc, getUrl, log }) {
  const { record, skipped } = await upsertDocumentRecord(supabase, taskId, candidateId, doc);
  if (skipped) {
    log(`Skipping already acquired OpenGov document: ${doc.file_name}`);
    return { status: 'skipped', id: record.id, filename: doc.file_name, uploadedPath: record.storage_path };
  }

  await supabase
    .from('opportunity_documents')
    .update({ acquisition_status: 'acquiring', acquisition_error: null })
    .eq('id', record.id);

  try {
    // getUrl returns a currently-valid signed URL, re-fetching detail on expiry.
    let bytes;
    try {
      bytes = await downloadDocumentBytes(await getUrl(doc, false), {
        timeoutMs: downloadTimeoutMs(),
        maxBytes: maxSingleDocumentBytes(),
        log,
        fileName: doc.file_name,
      });
    } catch (e) {
      if (e.code === 'OPENGOV_URL_EXPIRED') {
        log(`Signed URL expired for ${doc.file_name}; re-fetching fresh detail and retrying once`);
        bytes = await downloadDocumentBytes(await getUrl(doc, true), {
          timeoutMs: downloadTimeoutMs(),
          maxBytes: maxSingleDocumentBytes(),
          log,
          fileName: doc.file_name,
        });
      } else {
        throw e;
      }
    }

    const finalFileName = doc.file_name;
    const storagePath = `opportunity-candidates/${candidateId}/${record.id}/${finalFileName}`;
    const mimeType = extensionToContentType(finalFileName);

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    let archiveExtraction = null;
    let extractedDocuments = [];
    if (isArchiveFile(finalFileName)) {
      log(`Extracting archive contents: ${finalFileName}`);
      archiveExtraction = await extractSupportedArchiveEntries(bytes, log);
      log(`Archive extraction summary for ${finalFileName}: entries=${archiveExtraction.stats.total_entries} extracted=${archiveExtraction.stats.extracted} skipped=${archiveExtraction.stats.skipped} failed=${archiveExtraction.stats.failed}`);
      extractedDocuments = await storeExtractedArchiveDocuments({
        supabase,
        taskId,
        candidateId,
        parentDoc: { ...doc, id: record.id, file_name: finalFileName },
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
        file_name: finalFileName,
        file_size: bytes.byteLength,
        file_type: inferFileType(finalFileName),
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

    log(`Uploaded OpenGov document: ${finalFileName} (${bytes.byteLength} bytes)`);
    return {
      status: 'acquired',
      id: record.id,
      filename: finalFileName,
      mimeType,
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

// Resolve the OpenGov project id for a candidate.
function resolveProjectId(candidate) {
  const fromCrawl = candidate?.crawl_data?.opengov_project_id;
  if (fromCrawl != null && String(fromCrawl).trim() !== '') return String(fromCrawl).trim();
  const m = String(candidate?.source_url ?? '').match(/\/projects\/(\d+)/);
  return m ? m[1] : null;
}

// ── Orchestrator ──
async function acquireOpenGovDocuments({ supabase, task, candidate, log }) {
  if (!process.env.OPENGOV_EMAIL || !process.env.OPENGOV_PASSWORD) {
    throw new Error('Missing OpenGov credentials: OPENGOV_EMAIL and OPENGOV_PASSWORD must be configured');
  }

  const projectId = resolveProjectId(candidate);
  if (!projectId) throw new Error('OpenGov candidate is missing a usable project id (crawl_data.opengov_project_id / source_url)');

  const allowed = allowedExtensions();
  const maxDocs = maxDocumentsPerCandidate();
  const maxTotalBytes = maxDocumentBytesPerCandidate();

  let session = null;
  const acquiredDocuments = [];
  let acquired = 0;
  let skipped = 0;
  let failed = 0;
  let downloaded = 0;
  let uploaded = 0;
  let existing = 0;
  let totalBytesUploaded = 0;
  let budgetExhausted = false;
  const errors = [];
  const failedSample = [];
  const storagePathsSample = [];
  const documentIdsSample = [];

  // Manifest map keyed by stable identifier → fresh signed URL. Rebuilt when a
  // URL is discovered to have expired mid-acquisition.
  let urlByKey = new Map();
  const keyFor = (doc) => String(doc.shared_id ?? doc.attachment_id);

  try {
    log(`Opening OpenGov session for document acquisition (project ${projectId})`);
    session = await openBrowser(log);
    await openGovLogin(session.page, log);

    let manifest = await fetchFreshManifest(session.page, projectId, log);
    const rebuildUrlMap = (docs) => {
      urlByKey = new Map(docs.map((d) => [keyFor(d), d.url]));
    };
    rebuildUrlMap(manifest);

    const documentsDiscovered = manifest.length;

    // Supported-file filtering.
    const supported = [];
    let unsupportedCount = 0;
    for (const d of manifest) {
      const ext = d.effective_extension;
      if (ext && allowed.has(ext)) {
        supported.push(d);
      } else {
        unsupportedCount++;
        log(`Skipping unsupported OpenGov file: ${d.file_name} (ext=${ext || 'none'})`);
      }
    }

    // Count / manifest cap.
    let manifestDocs = supported;
    if (manifestDocs.length > maxDocs) {
      log(`OpenGov manifest (${manifestDocs.length}) exceeds OPENGOV_MAX_DOCUMENTS_PER_CANDIDATE (${maxDocs}); capping`);
      manifestDocs = manifestDocs.slice(0, maxDocs);
    }

    // Attach persistence-shaped fields to each doc.
    const preparedDocs = manifestDocs.map((d) => ({
      ...d,
      source_url: stableSourceUrl(projectId, d),
      document_family: documentFamilyFor(d.file_name, d.kind),
      document_class: documentClassFor(d.file_name, d.kind),
      manifest_data: {
        source: 'opengov_procurement',
        opengov_project_id: projectId,
        attachment_id: d.attachment_id,
        shared_id: d.shared_id,
        appendix_id: d.appendix_id,
        attachment_type: d.attachment_type,
        attachment_kind: d.kind,
        addendum_number: d.addendum_number,
        file_extension: d.file_extension,
        detail_api: `${API_BASE}/project/${projectId}`,
        acquisition_method: 'opengov_phase3_presigned_download',
        // NOTE: the signed URL is intentionally NOT persisted — it expires.
      },
    }));

    // getUrl resolves a currently-valid signed URL for a doc, re-fetching the
    // detail payload once on expiry to refresh all URLs.
    const getUrl = async (doc, forceRefresh) => {
      if (forceRefresh) {
        manifest = await fetchFreshManifest(session.page, projectId, log);
        rebuildUrlMap(manifest);
      }
      const url = urlByKey.get(keyFor(doc));
      if (!url) throw new Error(`No signed URL available for ${doc.file_name} after detail refresh`);
      return url;
    };

    // Bounded-concurrency worker pool with per-document failure isolation and a
    // best-effort total-byte budget guardrail.
    let cursor = 0;
    const worker = async () => {
      while (cursor < preparedDocs.length) {
        const doc = preparedDocs[cursor++];
        if (budgetExhausted) {
          skipped++;
          acquiredDocuments.push({ status: 'skipped', filename: doc.file_name, reason: 'total_byte_budget_exceeded' });
          continue;
        }
        try {
          const stored = await storeOpenGovDocument({
            supabase,
            taskId: task.id,
            candidateId: candidate.id,
            doc,
            getUrl,
            log,
          });
          acquiredDocuments.push(stored);
          if (stored.status === 'acquired') {
            acquired++;
            downloaded++;
            uploaded++;
            totalBytesUploaded += stored.bytes ?? 0;
            if (stored.id) documentIdsSample.push(stored.id);
            if (stored.uploadedPath) storagePathsSample.push(stored.uploadedPath);
            if (totalBytesUploaded >= maxTotalBytes) {
              budgetExhausted = true;
              log(`OpenGov total-byte budget reached (${totalBytesUploaded} >= ${maxTotalBytes}); remaining documents will be skipped`);
            }
          } else if (stored.status === 'skipped') {
            skipped++;
            existing++;
            if (stored.id) documentIdsSample.push(stored.id);
          }
          // Roll up archive children into the counters.
          if (stored.archiveExtraction?.extractedDocuments?.length) {
            for (const child of stored.archiveExtraction.extractedDocuments) {
              acquiredDocuments.push(child);
              if (child.status === 'acquired') {
                acquired++;
                uploaded++;
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
          log(`OpenGov document failed: ${message}`);
        }
      }
    };

    const attempted = preparedDocs.length;
    const pool = Array.from({ length: Math.min(acquisitionConcurrency(), Math.max(1, preparedDocs.length)) }, () => worker());
    await Promise.all(pool);

    const found = attempted;
    log(`OpenGov acquisition complete: discovered=${documentsDiscovered} unsupported=${unsupportedCount} attempted=${attempted} acquired=${acquired} skipped=${skipped} failed=${failed} bytes=${totalBytesUploaded}`);

    return {
      // Fields consumed by runProjectAnalysisAcquisition / runDocumentPrefetchTask.
      found,
      acquired,
      skipped,
      failed,
      acquiredDocuments,
      stats: { acquired, skipped, failed },
      warningSummary: failed > 0 && (acquired + skipped) > 0
        ? `Some source documents could not be acquired. BidBox successfully acquired ${acquired + skipped} of ${found} available documents.`
        : null,
      errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
      errors,
      // ── Phase 3 acquisition telemetry ──
      opengov_project_id: projectId,
      documents_discovered: documentsDiscovered,
      documents_attempted: attempted,
      documents_downloaded: downloaded,
      documents_uploaded: uploaded,
      documents_existing: existing,
      documents_skipped: skipped,
      documents_failed: failed,
      unsupported_file_count: unsupportedCount,
      total_bytes_uploaded: totalBytesUploaded,
      budget_exhausted: budgetExhausted,
      failed_documents_sample: failedSample.slice(0, 10),
      storage_paths_sample: storagePathsSample.slice(0, 10),
      opportunity_document_ids_sample: documentIdsSample.slice(0, 10),
    };
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }
}

module.exports = {
  acquireOpenGovDocuments,
  DOCUMENT_BUCKET,
  // Exported for fixture/unit tests.
  stableSourceUrl,
  ensureExtension,
  documentFamilyFor,
  documentClassFor,
  sanitizeFileName,
  inferFileType,
  extensionToContentType,
};
