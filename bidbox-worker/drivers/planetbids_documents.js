const { chromium } = require('playwright');

const DOCUMENT_BUCKET = 'opportunity-documents';
const API_HOST = 'api-external.prod.planetbids.com';

class ManifestHttpError extends Error {
  constructor(status, body) {
    super(`Manifest HTTP ${status}: ${String(body ?? '').substring(0, 200)}`);
    this.name = 'ManifestHttpError';
    this.status = status;
  }
}

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

function sanitizedApiPath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.pathname;
  } catch {
    return String(rawUrl ?? '').split('?')[0].substring(0, 200);
  }
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
    throw new ManifestHttpError(manifestRes.status, body);
  }

  const json = await manifestRes.json();
  const docs = (json.data ?? [])
    .map(normalizeManifestItem)
    .filter((doc) => doc.source_url)
    .map((doc) => ({ ...doc, bearer_token: bearerToken }));
  log(`Manifest returned ${docs.length} downloadable document(s)`);
  return docs;
}

async function pageShowsProspectiveBidderRequirement(page) {
  const body = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  return /must\s+become\s+a\s+Prospective\s+Bidder/i.test(body) ||
    /Become\s+a\s+Prospective\s+Bidder/i.test(body) ||
    /Become\s+a\s+PB/i.test(body);
}

async function inspectRequiredProspectiveBidderFields(page) {
  return page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const controls = [...document.querySelectorAll('input, textarea, select')]
      .filter((el) => !el.disabled && visible(el));

    const details = controls.map((el) => {
      const id = el.getAttribute('id');
      const aria = el.getAttribute('aria-label');
      const placeholder = el.getAttribute('placeholder');
      const surrounding = clean(el.closest('label, mat-form-field, .mat-form-field, div')?.textContent ?? '');
      const label = id
        ? clean(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent ?? surrounding)
        : surrounding;
      const text = clean([label, aria, placeholder].filter(Boolean).join(' '));
      const required = el.required ||
        el.getAttribute('aria-required') === 'true' ||
        /\*/.test(text) ||
        /required/i.test(text);
      const value = el.tagName.toLowerCase() === 'select'
        ? clean(el.options?.[el.selectedIndex]?.textContent ?? el.value)
        : clean(el.value);
      return {
        required,
        empty: !value || /^select\b|^choose\b/i.test(value),
      };
    });

    return {
      required_count: details.filter((d) => d.required).length,
      empty_required_count: details.filter((d) => d.required && d.empty).length,
    };
  }).catch(() => ({
    required_count: null,
    empty_required_count: null,
  }));
}

async function collectProspectiveBidderFormDiagnostics(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const describeControl = (el) => {
      const tag = el.tagName.toLowerCase();
      const container = el.closest('mat-form-field, .mat-form-field, pb-dropdown, [role="combobox"], div');
      const label = clean(
        container?.querySelector('label, mat-label, .mat-form-field-label')?.textContent ??
        el.getAttribute('aria-label') ??
        el.getAttribute('placeholder') ??
        container?.textContent ??
        ''
      );
      const selected = tag === 'select'
        ? clean(el.options?.[el.selectedIndex]?.textContent ?? el.value)
        : clean(el.value ?? el.getAttribute('aria-valuetext') ?? el.textContent ?? '');
      const classes = clean(el.className);
      return {
        label: label.substring(0, 120),
        has_value: Boolean(selected),
        angular_invalid: /\bng-invalid\b/.test(classes) || el.getAttribute('aria-invalid') === 'true',
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      };
    };

    const controls = [...document.querySelectorAll('input, textarea, select, [role="combobox"], mat-select, button')]
      .filter(visible)
      .map(describeControl);
    const labels = [...document.querySelectorAll('label, mat-label, .mat-form-field-label')]
      .filter(visible)
      .map((el) => clean(el.textContent))
      .filter(Boolean)
      .slice(0, 50);
    const invalid_controls = controls.filter((control) => control.angular_invalid);
    const disabled_controls = controls.filter((control) => control.disabled);

    return {
      labels,
      controls,
      invalid_controls,
      disabled_controls,
    };
  }).catch((e) => ({
    error: e.message,
    labels: [],
    controls: [],
    invalid_controls: [],
    disabled_controls: [],
  }));
}

function summarizeFormDiagnostics(diagnostics) {
  return JSON.stringify({
    labels: diagnostics.labels?.slice(0, 20) ?? [],
    invalid_controls: diagnostics.invalid_controls?.slice(0, 10) ?? [],
    disabled_controls: diagnostics.disabled_controls?.slice(0, 10) ?? [],
  }).substring(0, 2000);
}

function isBlankDropdownValue(value, label) {
  const cleanValue = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!cleanValue) return true;
  return new RegExp(`^${label}\\s*\\*?$`, 'i').test(cleanValue) ||
    /^select\b|^choose\b/i.test(cleanValue);
}

function endpointLooksLikeProspectiveBidderWrite(rawUrl, method) {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false;

  const path = sanitizedApiPath(rawUrl);
  return /prospective-bidder|bid-prospective-bidders/i.test(path);
}

async function getAngularDropdownValue(page, labelText) {
  return page.evaluate((label) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const labelPattern = new RegExp(`${label}\\s*\\*?`, 'i');
    const fields = [...document.querySelectorAll('mat-form-field, .mat-form-field, pb-dropdown, div')]
      .filter((el) => {
        const text = clean(el.textContent);
        return visible(el) && labelPattern.test(text) && text.length < 300;
      })
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);

    for (const field of fields) {
      const select = field.querySelector('select');
      if (select) {
        return clean(select.options?.[select.selectedIndex]?.textContent ?? select.value);
      }

      const combobox = field.querySelector('[role="combobox"], mat-select');
      if (combobox) {
        const aria = clean(combobox.getAttribute('aria-valuetext') ?? combobox.getAttribute('aria-label') ?? '');
        const valueText = clean(
          combobox.querySelector('.mat-select-value-text, .mat-mdc-select-value-text, .mat-select-min-line')?.textContent ??
          combobox.textContent
        );
        const fieldText = clean(field.textContent).replace(labelPattern, '').trim();
        return valueText || aria || fieldText;
      }

      const fieldText = clean(field.textContent).replace(labelPattern, '').trim();
      if (fieldText) return fieldText;
    }

    return '';
  }, labelText).catch(() => '');
}

async function clickAngularDropdownControl(page, labelText) {
  const clicked = await page.evaluate((label) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const labelPattern = new RegExp(`${label}\\s*\\*?`, 'i');
    const fields = [...document.querySelectorAll('mat-form-field, .mat-form-field, pb-dropdown, div')]
      .filter((el) => {
        const text = clean(el.textContent);
        return visible(el) && labelPattern.test(text) && text.length < 300;
      })
      .sort((a, b) => clean(a.textContent).length - clean(b.textContent).length);

    for (const field of fields) {
      const control = field.querySelector('select, [role="combobox"], mat-select, input') ?? field;
      control.scrollIntoView({ block: 'center', inline: 'nearest' });
      control.click();
      return true;
    }

    return false;
  }, labelText).catch(() => false);

  if (!clicked) throw new Error(`${labelText} dropdown was not found`);
}

async function selectAngularDropdownOption(page, labelText, optionText, log) {
  await clickAngularDropdownControl(page, labelText);
  const option = page.getByRole('option', { name: new RegExp(`^${optionText}$`, 'i') }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
  } else {
    await page.getByText(new RegExp(`^${optionText}$`, 'i')).last().click({ timeout: 5000 });
  }
  await page.waitForTimeout(500);

  const selected = await getAngularDropdownValue(page, labelText);
  if (!new RegExp(`^${optionText}$`, 'i').test(selected)) {
    const diagnostics = await collectProspectiveBidderFormDiagnostics(page);
    throw new Error(
      `${labelText} selection did not persist; ` +
      `diagnostics=${summarizeFormDiagnostics(diagnostics)}`
    );
  }

  log(`${labelText} selected`);
}

async function ensureClassificationSelected(page, log) {
  const current = await getAngularDropdownValue(page, 'Classification');
  if (!isBlankDropdownValue(current, 'Classification')) {
    log('Classification already selected');
    return;
  }

  log('Setting classification: Other');
  await selectAngularDropdownOption(page, 'Classification', 'Other', log);
}

async function ensureStatusSelected(page, log) {
  const desired = 'Non-Bidder, receive communications';
  const current = await getAngularDropdownValue(page, 'Status');
  if (new RegExp(`^${desired}$`, 'i').test(current)) {
    log('Status already selected');
    return;
  }

  log('Setting status: Non-Bidder, receive communications');
  await selectAngularDropdownOption(page, 'Status', desired, log);
}

async function ensureDoneEnabled(page, doneButton) {
  if (await doneButton.isEnabled({ timeout: 3000 }).catch(() => false)) return;

  const diagnostics = await collectProspectiveBidderFormDiagnostics(page);
  throw new Error(`Prospective bidder Done button is disabled; diagnostics=${summarizeFormDiagnostics(diagnostics)}`);
}

async function ensureProspectiveBidder(page, log) {
  log('Prospective bidder registration required');

  let becomeButton = page
    .getByRole('button', { name: /Become a PB|Become a Prospective Bidder/i })
    .first();
  if (!(await becomeButton.isVisible({ timeout: 3000 }).catch(() => false))) {
    const downloadButton = page
      .getByRole('button', { name: /^(Download|Download All)$/i })
      .first();
    if (await downloadButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await downloadButton.click();
      await page.waitForTimeout(1000);
    }
  }

  becomeButton = page
    .getByRole('button', { name: /Become a PB|Become a Prospective Bidder/i })
    .first();
  if (!(await becomeButton.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error('Prospective bidder registration required, but Become a PB button was not visible');
  }

  const diagnostics = [];
  const onResponse = (res) => {
    try {
      const url = res.url();
      if (!url.includes(API_HOST)) return;
      const req = res.request();
      diagnostics.push(`${req.method()} ${sanitizedApiPath(url)} ${res.status()}`);
    } catch (_) {}
  };

  page.on('response', onResponse);
  try {
    await becomeButton.click();
    await page.waitForTimeout(1500);
    await page.waitForSelector('text=/Prospective Bidder Detail/i', { timeout: 20000 });
    log('Prospective bidder form opened');

    const requiredSummary = await inspectRequiredProspectiveBidderFields(page);
    log(
      `Required fields validated: required=${requiredSummary.required_count ?? 'unknown'} ` +
      `empty_required=${requiredSummary.empty_required_count ?? 'unknown'}`
    );

    await ensureClassificationSelected(page, log);
    await ensureStatusSelected(page, log);

    const refreshedRequiredSummary = await inspectRequiredProspectiveBidderFields(page);
    log(
      `Required fields revalidated: required=${refreshedRequiredSummary.required_count ?? 'unknown'} ` +
      `empty_required=${refreshedRequiredSummary.empty_required_count ?? 'unknown'}`
    );
    if (refreshedRequiredSummary.empty_required_count && refreshedRequiredSummary.empty_required_count > 0) {
      throw new Error(
        `Prospective bidder form has ${refreshedRequiredSummary.empty_required_count} empty required field(s); ` +
        'driver will not hardcode vendor profile values'
      );
    }

    const doneButton = page.getByRole('button', { name: /^Done$/i }).first();
    if (!(await doneButton.isVisible({ timeout: 10000 }).catch(() => false))) {
      throw new Error('Prospective bidder Done button was not visible');
    }
    await ensureDoneEnabled(page, doneButton);

    const classification = await getAngularDropdownValue(page, 'Classification');
    const status = await getAngularDropdownValue(page, 'Status');
    if (isBlankDropdownValue(classification, 'Classification')) {
      throw new Error('Prospective bidder form invalid: Classification has no value');
    }
    if (isBlankDropdownValue(status, 'Status')) {
      throw new Error('Prospective bidder form invalid: Status has no value');
    }

    log('Prospective bidder form valid');
    log('Submitting prospective bidder registration');
    const registrationPost = page.waitForResponse((res) => {
      const req = res.request();
      return res.url().includes(API_HOST) && endpointLooksLikeProspectiveBidderWrite(res.url(), req.method());
    }, { timeout: 30000 });
    await doneButton.click();

    const registrationRes = await registrationPost.catch(() => null);
    if (!registrationRes) {
      throw new Error('Prospective bidder registration did not issue a write request');
    }

    const registrationMethod = registrationRes.request().method();
    const registrationPath = sanitizedApiPath(registrationRes.url());
    log(`Prospective bidder registration response: ${registrationMethod} ${registrationPath} ${registrationRes.status()}`);
    if (!registrationRes.ok()) {
      throw new Error(`Prospective bidder registration write failed: ${registrationRes.status()}`);
    }

    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    log('Prospective bidder registration succeeded');
  } catch (e) {
    if (typeof log.screenshot === 'function') {
      await log.screenshot('planetbids-prospective-bidder-failure', page);
    }
    throw e;
  } finally {
    page.off('response', onResponse);
    if (diagnostics.length > 0) {
      [...new Set(diagnostics)].slice(0, 8).forEach((line) => {
        log(`Prospective bidder API: ${line}`);
      });
    }
  }
}

async function openDocumentsTab(page, log) {
  const docsTab = page.locator('text=Documents').first();
  if (await docsTab.isVisible({ timeout: 8000 }).catch(() => false)) {
    log('Opening PlanetBids Documents tab');
    await docsTab.click();
    await page.waitForResponse((res) => res.url().includes('bid-downloadable-files'), { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(1500);
    return true;
  }

  log('Documents tab not visible; attempting manifest with captured token');
  return false;
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

    await openDocumentsTab(page, log);

    if (!bearerToken) {
      throw new Error('No PlanetBids bearer token captured after login');
    }

    try {
      return await fetchManifest(bidId, bearerToken, log);
    } catch (e) {
      const needsProspectiveBidder = e instanceof ManifestHttpError && e.status === 403;
      const uiRequiresProspectiveBidder = await pageShowsProspectiveBidderRequirement(page);
      if (!needsProspectiveBidder && !uiRequiresProspectiveBidder) {
        throw e;
      }

      await ensureProspectiveBidder(page, log);

      log(`Returning to PlanetBids detail after prospective bidder registration: ${candidate.source_url}`);
      await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await openDocumentsTab(page, log);

      if (!bearerToken) {
        throw new Error('No PlanetBids bearer token captured after prospective bidder registration');
      }

      log('Retrying manifest after prospective bidder registration');
      const docs = await fetchManifest(bidId, bearerToken, log);
      log('Manifest retry succeeded');
      return docs;
    }
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
