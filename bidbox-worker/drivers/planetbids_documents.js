const { chromium } = require('playwright');

const DOCUMENT_BUCKET = 'opportunity-documents';
const API_HOST = 'api-external.prod.planetbids.com';

function extractBidId(url) {
  const m = String(url ?? '').match(/\/bo-detail\/(\d+)/);
  return m ? m[1] : null;
}

function sanitizeFileName(name) {
  const cleaned = String(name ?? 'document')
    .replace(/[\/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'document';
}

function extensionToContentType(fileName) {
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dwg')) return 'image/vnd.dwg';
  return 'application/octet-stream';
}

function inferFileType(fileName) {
  const m = String(fileName ?? '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : null;
}

function normalizeManifestItem(item) {
  const a = item?.attributes ?? item ?? {};
  const filename = String(a.filename ?? a.fileName ?? a.file_name ?? a.fileTitle ?? a.file_title ?? 'document');
  const serverFullPath = String(a.serverFullPath ?? a.server_full_path ?? '');
  const serverFilename = String(a.serverFilename ?? a.server_filename ?? '');
  const fileSize = typeof a.fileSize === 'number'
    ? a.fileSize
    : typeof a.file_size === 'number'
    ? a.file_size
    : null;

  const sourceUrl = serverFullPath && serverFilename
    ? `https://${serverFullPath}${encodeURIComponent(serverFilename)}`
    : null;

  return {
    file_name: sanitizeFileName(filename),
    file_type: inferFileType(filename),
    file_size: fileSize,
    source_url: sourceUrl,
    manifest_data: a,
  };
}

async function createBrowserbasePage(log) {
  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID ?? '';

  if (!bbApiKey) throw new Error('BROWSERBASE_API_KEY not configured');

  log('Creating Browserbase session for document acquisition');
  const sessionRes = await fetch('https://www.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-bb-api-key': bbApiKey,
    },
    body: JSON.stringify({ projectId: bbProjectId }),
  });

  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    throw new Error(`Browserbase session failed: ${sessionRes.status} — ${errText.substring(0, 200)}`);
  }

  const { id: sessionId } = await sessionRes.json();
  log(`Browserbase session created: ${sessionId}`);

  const wsUrl = `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`;
  const browser = await chromium.connectOverCDP(wsUrl);
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  return { browser, page };
}

async function loginToPlanetBids(page, log) {
  const email = process.env.PLANETBIDS_EMAIL;
  const password = process.env.PLANETBIDS_PASSWORD;

  if (!email || !password) {
    throw new Error('PLANETBIDS_EMAIL and PLANETBIDS_PASSWORD must be configured');
  }

  const login = page.locator('text=LOG IN').first();
  if (!(await login.isVisible({ timeout: 8000 }).catch(() => false))) {
    log('PlanetBids LOG IN control not visible; continuing with existing session');
    return;
  }

  log('Logging in to PlanetBids');
  await login.click();
  await page.waitForTimeout(1500);
  await page.locator('input[type=email], input[name=email]').first().fill(email);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('button[type=submit]').first().click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  log('PlanetBids login submitted');
}

async function fetchManifest(bidId, bearerToken, log) {
  if (!bearerToken) throw new Error('No PlanetBids bearer token captured');

  const manifestRes = await fetch(
    `https://${API_HOST}/papi/bid-downloadable-files?bid_id=${bidId}`,
    {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Referer: 'https://vendors.planetbids.com/',
        Origin: 'https://vendors.planetbids.com',
      },
    }
  );

  if (!manifestRes.ok) {
    const body = await manifestRes.text();
    throw new Error(`Manifest HTTP ${manifestRes.status}: ${body.substring(0, 200)}`);
  }

  const json = await manifestRes.json();
  const docs = (json.data ?? [])
    .map(normalizeManifestItem)
    .filter((doc) => doc.source_url)
    .map((doc) => ({ ...doc, bearer_token: bearerToken }));
  log(`Manifest returned ${docs.length} downloadable document(s)`);
  return docs;
}

async function getAuthenticatedManifest(candidate, log) {
  const bidId = candidate.crawl_data?.bid_id ?? extractBidId(candidate.source_url);
  if (!bidId) throw new Error('PlanetBids bid_id not found on candidate');

  let browser = null;
  let bearerToken = null;

  try {
    const created = await createBrowserbasePage(log);
    browser = created.browser;
    const page = created.page;

    page.on('request', (req) => {
      if (req.url().includes(API_HOST)) {
        const auth = req.headers()['authorization'] ?? '';
        if (auth.startsWith('Bearer ')) bearerToken = auth.slice(7);
      }
    });

    log(`Loading PlanetBids detail: ${candidate.source_url}`);
    await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    await loginToPlanetBids(page, log);

    log(`Reloading PlanetBids detail after login: ${candidate.source_url}`);
    await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const docsTab = page.locator('text=Documents').first();
    if (await docsTab.isVisible({ timeout: 8000 }).catch(() => false)) {
      log('Opening PlanetBids Documents tab');
      await docsTab.click();
      await page.waitForResponse((res) => res.url().includes('bid-downloadable-files'), { timeout: 20000 }).catch(() => null);
      await page.waitForTimeout(1500);
    } else {
      log('Documents tab not visible; attempting manifest with captured token');
    }

    if (!bearerToken) {
      throw new Error('No PlanetBids bearer token captured after login');
    }

    return fetchManifest(bidId, bearerToken, log);
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

async function upsertDocumentRecord(supabase, taskId, candidateId, doc) {
  const existing = doc.source_url
    ? await supabase
      .from('opportunity_documents')
      .select('id, acquisition_status, storage_path')
      .eq('opportunity_candidate_id', candidateId)
      .eq('source_url', doc.source_url)
      .maybeSingle()
    : { data: null, error: null };

  if (existing.error) throw new Error(`Document lookup failed: ${existing.error.message}`);
  if (existing.data?.acquisition_status === 'acquired' && existing.data.storage_path) {
    return { record: existing.data, skipped: true };
  }

  const payload = {
    opportunity_candidate_id: candidateId,
    agent_task_id: taskId,
    file_name: doc.file_name,
    file_type: doc.file_type,
    source_url: doc.source_url,
    file_size: doc.file_size,
    acquisition_status: 'queued',
    acquisition_error: null,
    manifest_data: doc.manifest_data,
  };

  if (existing.data) {
    const { data, error } = await supabase
      .from('opportunity_documents')
      .update(payload)
      .eq('id', existing.data.id)
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

async function downloadAndStoreDocument(supabase, taskId, candidateId, doc, log) {
  const { record, skipped } = await upsertDocumentRecord(supabase, taskId, candidateId, doc);
  if (skipped) {
    log(`Skipping already acquired document: ${doc.file_name}`);
    return { status: 'skipped', id: record.id };
  }

  await supabase
    .from('opportunity_documents')
    .update({ acquisition_status: 'acquiring', acquisition_error: null })
    .eq('id', record.id);

  const storagePath = `opportunity-candidates/${candidateId}/${record.id}/${doc.file_name}`;

  try {
    log(`Downloading document: ${doc.file_name}`);
    const res = await fetch(doc.source_url, {
      headers: {
        Authorization: `Bearer ${doc.bearer_token}`,
        Referer: 'https://vendors.planetbids.com/',
        Origin: 'https://vendors.planetbids.com',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Download HTTP ${res.status}: ${body.substring(0, 200)}`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, bytes, {
        contentType: extensionToContentType(doc.file_name),
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

    await supabase
      .from('opportunity_documents')
      .update({
        acquisition_status: 'acquired',
        acquisition_error: null,
        storage_bucket: DOCUMENT_BUCKET,
        storage_path: storagePath,
        file_size: bytes.byteLength,
      })
      .eq('id', record.id);

    log(`Stored document: ${doc.file_name} (${bytes.byteLength} bytes)`);
    return { status: 'acquired', id: record.id, size: bytes.byteLength };
  } catch (e) {
    await supabase
      .from('opportunity_documents')
      .update({
        acquisition_status: 'failed',
        acquisition_error: e.message,
      })
      .eq('id', record.id);
    throw e;
  }
}

async function acquirePlanetBidsDocuments({ supabase, task, candidate, log }) {
  const manifestDocs = await getAuthenticatedManifest(candidate, log);
  let acquired = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const doc of manifestDocs) {
    try {
      const result = await downloadAndStoreDocument(supabase, task.id, candidate.id, doc, log);
      if (result.status === 'acquired') acquired++;
      if (result.status === 'skipped') skipped++;
    } catch (e) {
      failed++;
      errors.push(`${doc.file_name}: ${e.message}`);
      log(`Document failed: ${doc.file_name} — ${e.message}`);
    }
  }

  return {
    found: manifestDocs.length,
    acquired,
    skipped,
    failed,
    errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
  };
}

module.exports = {
  acquirePlanetBidsDocuments,
  DOCUMENT_BUCKET,
};
