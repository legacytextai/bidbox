const { chromium } = require('playwright');
const {
  extractSupportedArchiveEntries,
  isArchiveFile,
} = require('./archive_extraction');
const { replacePortalBidItemsForCandidate } = require('./bid_items');

const DOCUMENT_BUCKET = 'opportunity-documents';
const API_HOST = 'api-external.prod.planetbids.com';
const PLANETBIDS_ORIGIN = 'https://vendors.planetbids.com';
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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

function parseMoneyToken(token) {
  if (!token) return null;
  const cleaned = token.replace(/\s+/g, ' ').trim();
  const hasDollar = cleaned.includes('$');
  const hasComma = cleaned.includes(',');
  const unitMatch = cleaned.match(/([KMB])\b|\b(thousand|million|billion)\b/i);
  const numberMatch = cleaned.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const n = parseFloat(numberMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = (unitMatch?.[1] ?? unitMatch?.[2] ?? '').toLowerCase();
  let value = n;
  if (unit === 'b' || unit === 'billion') value = n * 1_000_000_000;
  if (unit === 'm' || unit === 'million') value = n * 1_000_000;
  if (unit === 'k' || unit === 'thousand') value = n * 1_000;

  if (!hasDollar && !hasComma && !unit && value < 10000) return null;
  return Math.round(value);
}

function parseEstimatedValueDetails(raw) {
  if (!raw) {
    return {
      estimated_value: null,
      estimated_value_raw: null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const text = String(raw).replace(/\s+/g, ' ').trim();
  const moneyPattern = /(?:\$+\s*)?\d[\d,]*(?:\.\d+)?\s*(?:[KkMmBb]|thousand|million|billion)?/g;
  const values = [...text.matchAll(moneyPattern)]
    .map((m) => ({ value: parseMoneyToken(m[0]) }))
    .filter((m) => m.value !== null);

  if (values.length === 0) {
    return {
      estimated_value: null,
      estimated_value_raw: text || null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const first = values[0].value;
  const second = values[1]?.value ?? null;
  if (second !== null && /(?:-|–|—|\bto\b|\band\b|\bbetween\b)/i.test(text)) {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return {
      estimated_value: Math.round((low + high) / 2),
      estimated_value_raw: text,
      estimated_value_low: low,
      estimated_value_high: high,
    };
  }

  return {
    estimated_value: first,
    estimated_value_raw: text,
    estimated_value_low: null,
    estimated_value_high: null,
  };
}

function parseBooleanSignal(value) {
  if (value === true || value === false) return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return null;
  if (/\b(optional|not required|not mandatory|no|false)\b/.test(text)) return false;
  if (/\b(mandatory|required|yes|true|must|required attendance|attendance required)\b/.test(text)) return true;
  return null;
}

function normalizeJobWalkMetadata(raw) {
  const dateTime = firstPresent(raw.job_walk_at, raw.pre_bid_meeting_at);
  const details = firstPresent(raw.job_walk_details);
  const attendanceRequired = firstPresent(raw.attendance_required);
  const location = firstPresent(raw.job_walk_location, raw.pre_bid_meeting_location);
  const link = firstPresent(raw.meeting_link);
  const additionalDetails = firstPresent(raw.additional_details);
  const preBidExists = parseBooleanSignal(raw.pre_bid_meeting) ?? Boolean(dateTime || details || attendanceRequired || location || link || additionalDetails);
  const mandatory = parseBooleanSignal(attendanceRequired) ?? parseBooleanSignal(details);
  const exists = Boolean(preBidExists || dateTime || details || attendanceRequired || location || link || additionalDetails);

  return {
    pre_bid_exists: preBidExists ?? null,
    meeting_datetime: dateTime ?? null,
    meeting_location: location ?? null,
    meeting_link: link ?? null,
    additional_details: additionalDetails ?? null,
    pre_bid_location: location ?? null,
    pre_bid_meeting_link: link ?? null,
    pre_bid_notes: additionalDetails ?? null,
    job_walk_exists: exists || null,
    job_walk_mandatory: mandatory,
    job_walk_at: dateTime ?? null,
    pre_bid_meeting_at: firstPresent(raw.pre_bid_meeting_at, dateTime),
    job_walk_details: [details, additionalDetails, location ? `Location: ${location}` : null].filter(Boolean).join(' | ') || null,
    job_walk_location: location ?? null,
    attendance_required: attendanceRequired ?? null,
    pre_bid_meeting: raw.pre_bid_meeting || preBidExists || null,
  };
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

function normalizeManifestJson(json, bearerToken, log) {
  const docs = (json?.data ?? [])
    .map(normalizeManifestItem)
    .filter((doc) => doc.source_url)
    .map((doc) => ({ ...doc, bearer_token: bearerToken }));
  log(`Manifest returned ${docs.length} downloadable document(s)`);
  return docs;
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function firstPresent(...values) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function findDeepValue(value, keyPatterns, path = []) {
  if (value === null || value === undefined || path.length > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepValue(item, keyPatterns, path);
      if (found !== null && found !== undefined && cleanText(found)) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;

  for (const [key, child] of Object.entries(value)) {
    if (keyPatterns.some((pattern) => pattern.test(key)) && cleanText(child)) return child;
  }
  for (const child of Object.values(value)) {
    const found = findDeepValue(child, keyPatterns, path.concat('child'));
    if (found !== null && found !== undefined && cleanText(found)) return found;
  }
  return null;
}

function findBidItemArrays(value, path = []) {
  if (value === null || value === undefined || path.length > 8) return [];
  if (Array.isArray(value)) {
    const objectItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
    const itemLikeCount = objectItems.filter((item) => {
      const source = item.attributes && typeof item.attributes === 'object' ? { ...item, ...item.attributes } : item;
      return Boolean(firstPresent(
        findDeepValue(source, [/description/i, /item.*name/i, /work.*description/i]),
        source.description,
        source.item_description,
        source.itemDescription,
        source.name
      ));
    }).length;
    const pathHint = path.join('.').toLowerCase();
    if (objectItems.length > 0 && itemLikeCount > 0 && (/line|item|bid/.test(pathHint) || itemLikeCount >= Math.min(2, objectItems.length))) {
      return [objectItems];
    }
    return objectItems.flatMap((item, index) => findBidItemArrays(item, path.concat(String(index))));
  }
  if (typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => findBidItemArrays(child, path.concat(key)));
}

function normalizePlanetBidsApiItem(item, index) {
  const attrs = item?.attributes && typeof item.attributes === 'object' ? item.attributes : {};
  const source = { ...item, ...attrs };
  const description = firstPresent(
    source.description,
    source.item_description,
    source.itemDescription,
    source.lineItemDescription,
    source.bidItemDescription,
    source.workDescription,
    source.name,
    source.title,
    findDeepValue(source, [/description/i, /item.*name/i, /work.*description/i])
  );
  if (!description) return null;

  return {
    item_number: firstPresent(
      source.item_number,
      source.itemNumber,
      source.lineItemNumber,
      source.bidItemNumber,
      source.number,
      source.sequence,
      source.seq,
      findDeepValue(source, [/item.*(number|no)$/i, /^number$/i, /sequence/i])
    ),
    item_code: firstPresent(
      source.item_code,
      source.itemCode,
      source.lineItemCode,
      source.bidItemCode,
      source.code,
      findDeepValue(source, [/item.*code/i, /^code$/i])
    ),
    description,
    unit_of_measure: firstPresent(
      source.unit_of_measure,
      source.unitOfMeasure,
      source.uom,
      source.unit,
      findDeepValue(source, [/unit.*measure/i, /^uom$/i, /^unit$/i])
    ),
    quantity_raw: firstPresent(
      source.quantity_raw,
      source.quantityRaw,
      source.quantity,
      source.qty,
      source.estimatedQuantity,
      findDeepValue(source, [/quantity/i, /^qty$/i])
    ),
    reference: firstPresent(source.reference, source.ref, source.specSection, source.specificationSection),
    raw_text: cleanText(JSON.stringify(source)).substring(0, 1000),
    metadata: {
      source_parser: 'planetbids_api_response',
      api_index: index,
      api_type: source.type ?? null,
      source_id: source.id ?? null,
    },
  };
}

function extractPlanetBidsBidItemsFromJson(json) {
  const arrays = findBidItemArrays(json);
  const rows = [];
  const seen = new Set();

  for (const array of arrays) {
    for (const item of array) {
      const normalized = normalizePlanetBidsApiItem(item, rows.length);
      if (!normalized) continue;
      const key = [
        normalized.item_number,
        normalized.item_code,
        normalized.description,
        normalized.quantity_raw,
        normalized.unit_of_measure,
      ].map((part) => cleanText(part).toLowerCase()).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(normalized);
    }
  }

  return rows;
}

function planetBidsAuthHeaders(bearerToken) {
  return {
    Authorization: `Bearer ${bearerToken}`,
    'User-Agent': BROWSER_USER_AGENT,
    Referer: `${PLANETBIDS_ORIGIN}/`,
    Origin: PLANETBIDS_ORIGIN,
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
    'User-Agent': BROWSER_USER_AGENT,
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
      headers: planetBidsAuthHeaders(bearerToken),
    }
  );

  if (!manifestRes.ok) {
    const body = await manifestRes.text();
    throw new ManifestHttpError(manifestRes.status, body);
  }

  return normalizeManifestJson(await manifestRes.json(), bearerToken, log);
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
    const manifestResponse = page
      .waitForResponse((res) => res.url().includes('bid-downloadable-files'), { timeout: 20000 })
      .catch(() => null);
    await docsTab.click();
    const res = await manifestResponse;
    await page.waitForTimeout(1500);
    if (!res) return null;
    if (!res.ok()) {
      log(`Documents tab manifest response: HTTP ${res.status()}`);
      return null;
    }
    try {
      log('Documents tab manifest response captured');
      return await res.json();
    } catch (e) {
      log(`Documents tab manifest JSON parse failed: ${e.message}`);
      return null;
    }
  }

  log('Documents tab not visible; attempting manifest with captured token');
  return null;
}

async function extractPlanetBidsBidItems(page, candidate, log) {
  const bidItemResponses = [];
  const responseListener = async (res) => {
    try {
      const url = res.url();
      if (!url.includes(API_HOST) || !res.ok()) return;
      if (!/(line|bid).{0,30}item|item.{0,30}(line|bid)/i.test(url)) return;
      const json = await res.json().catch(() => null);
      if (json) bidItemResponses.push({ url, json });
    } catch (_) {}
  };

  page.on('response', responseListener);
  const lineItemsTab = page
    .getByText(/^(Line Items|Bid Items|Bid Line Items|Items)$/i)
    .first();

  if (!(await lineItemsTab.isVisible({ timeout: 5000 }).catch(() => false))) {
    page.off('response', responseListener);
    log('PlanetBids Line Items tab not visible; bid item extraction skipped');
    return [];
  }

  log('Opening PlanetBids Line Items tab');
  await lineItemsTab.click();
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  page.off('response', responseListener);

  const rows = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const headerIndex = (headers, patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));
    const tables = Array.from(document.querySelectorAll('table'));
    const items = [];

    for (const table of tables) {
      const tableRows = Array.from(table.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => clean(cell.innerText)))
        .filter((row) => row.some(Boolean));
      if (tableRows.length < 2) continue;

      const headers = tableRows[0].map((header) => header.toLowerCase());
      const tableText = clean(table.innerText);
      if (!/(line\s*items?|bid\s*items?|item\s*(no|number)|description|quantity|qty|unit)/i.test(tableText)) continue;

      const section = clean(table.closest('section, mat-card, div')?.querySelector('h1,h2,h3,h4,h5,strong')?.textContent ?? '');
      const itemIndex = headerIndex(headers, [/item\s*(no|number)?/, /^#$/]);
      const codeIndex = headerIndex(headers, [/code/]);
      const descIndex = headerIndex(headers, [/description/, /item\s*description/, /scope/]);
      const unitIndex = headerIndex(headers, [/^unit$/, /uom/, /unit\s*of\s*measure/]);
      const qtyIndex = headerIndex(headers, [/quantity/, /^qty$/]);
      const refIndex = headerIndex(headers, [/reference/, /^ref$/]);
      if (descIndex < 0) continue;

      for (const row of tableRows.slice(1)) {
        const description = row[descIndex];
        if (!description || /^total\b/i.test(description)) continue;
        items.push({
          section_name: section || null,
          item_number: itemIndex >= 0 ? row[itemIndex] : null,
          item_code: codeIndex >= 0 ? row[codeIndex] : null,
          description,
          unit_of_measure: unitIndex >= 0 ? row[unitIndex] : null,
          quantity_raw: qtyIndex >= 0 ? row[qtyIndex] : null,
          reference: refIndex >= 0 ? row[refIndex] : null,
          raw_text: row.join(' | '),
          metadata: {
            source_table_headers: tableRows[0],
          },
        });
      }
    }

    return items;
  }).catch((e) => {
    log(`PlanetBids Line Items table parse failed: ${e.message}`);
    return [];
  });

  const apiRows = bidItemResponses.flatMap((response) => {
    const parsed = extractPlanetBidsBidItemsFromJson(response.json);
    return parsed.map((row) => ({
      ...row,
      metadata: {
        ...(row.metadata ?? {}),
        api_url: response.url,
      },
    }));
  });

  if (apiRows.length > 0) {
    log(`PlanetBids bid item API rows discovered: ${apiRows.length}`);
  }

  const combinedRows = [];
  const seen = new Set();
  for (const row of [...rows, ...apiRows]) {
    const key = [
      row.item_number,
      row.item_code,
      row.description,
      row.quantity_raw,
      row.unit_of_measure,
    ].map((part) => cleanText(part).toLowerCase()).join('|');
    if (!row.description || seen.has(key)) continue;
    seen.add(key);
    combinedRows.push(row);
  }

  const bidId = candidate.crawl_data?.bid_id ?? extractBidId(candidate.source_url);
  const normalized = combinedRows.map((row, index) => ({
    ...row,
    source_portal: 'planetbids',
    source_opportunity_id: bidId,
    extraction_method: 'portal_tab',
    extraction_status: 'extracted',
    source_url: candidate.source_url,
    source_order: index + 1,
    metadata: {
      ...(row.metadata ?? {}),
      source: 'planetbids_line_items_tab',
      bid_id: bidId,
    },
  }));

  log(`PlanetBids bid item rows discovered: ${normalized.length}`);
  return normalized;
}

async function extractPortalMetadata(page, log) {
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = document.body?.innerText ?? '';

    const field = (label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const patterns = [
        new RegExp(`${escaped}\\s*[:\\n]\\s*([^\\n]+)`, 'i'),
        new RegExp(`${escaped}\\s+([^\\n]{1,180})`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = bodyText.match(pattern);
        if (match?.[1]) {
          const value = clean(match[1]);
          if (value && value.toLowerCase() !== label.toLowerCase()) return value.substring(0, 500);
        }
      }

      const labels = [...document.querySelectorAll('label, dt, th, strong, b, span, div')]
        .filter((el) => clean(el.textContent).replace(/:$/, '').toLowerCase() === label.toLowerCase());

      for (const el of labels) {
        const sibling = el.nextElementSibling ? clean(el.nextElementSibling.textContent) : '';
        if (sibling && sibling.toLowerCase() !== label.toLowerCase()) return sibling.substring(0, 500);

        const parentText = clean(el.parentElement?.textContent ?? '');
        const parentMatch = parentText.match(new RegExp(`^${escaped}\\s*:?\\s*(.+)$`, 'i'));
        if (parentMatch?.[1]) return clean(parentMatch[1]).substring(0, 500);
      }

      return null;
    };

    const extractPreBidSection = () => {
      const sectionHeaderRe = /^(pre[-\s]?bid(?:\s+meeting)?(?:\s+information)?|prebid(?:\s+meeting)?(?:\s+information)?|job\s+walk|site\s+visit|mandatory\s+pre[-\s]?bid)$/i;
      const fieldLabels = [
        'Date & Time',
        'Date/Time',
        'Meeting Date',
        'Meeting Time',
        'Location',
        'Meeting Location',
        'Address',
        'Venue',
        'Attendance Required',
        'Attendance Mandatory',
        'Mandatory',
        'Meeting Type',
        'Meeting Link',
        'Additional Details',
      ];
      const fieldLabelRe = new RegExp(fieldLabels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
      const nodes = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,summary,label,dt,th,strong,b,span,div')];

      const findSectionContainer = () => {
        for (const node of nodes) {
          const ownText = clean([...node.childNodes]
            .filter((child) => child.nodeType === Node.TEXT_NODE)
            .map((child) => child.textContent)
            .join(' ') || node.textContent);
          if (!ownText || ownText.length > 120 || !sectionHeaderRe.test(ownText.replace(/:$/, ''))) continue;

          let current = node.parentElement;
          let best = null;
          for (let depth = 0; current && current !== document.body && depth < 6; depth += 1) {
            const text = clean(current.textContent);
            const headerIndex = text.toLowerCase().indexOf(ownText.toLowerCase());
            const headerNearStart = headerIndex >= 0 && headerIndex <= Math.max(80, text.length * 0.2);
            // Raised from 5000 to 15000: PlanetBids page components often exceed 5000 chars.
            if (headerNearStart && fieldLabelRe.test(text) && text.length <= 15000) {
              best = current;
              break;
            }
            current = current.parentElement;
          }
          if (best) return { header: ownText.replace(/:$/, ''), container: best };
        }
        return null;
      };

      const section = findSectionContainer();
      if (!section) return {};

      // Use innerText (preserves newlines) so the fallback regex can stop
      // at line boundaries. clean(textContent) collapses newlines to spaces,
      // causing [^\n]{1,300} to bleed across field boundaries.
      const sectionText = section.container.innerText ?? clean(section.container.textContent);
      const scopedField = (label) => {
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Include td: PlanetBids may use table cells for field labels.
        const exactLabels = [...section.container.querySelectorAll('label,dt,td,th,strong,b,span,div')]
          .filter((el) => clean(el.textContent).replace(/:$/, '').toLowerCase() === label.toLowerCase());

        for (const el of exactLabels) {
          const sibling = el.nextElementSibling ? clean(el.nextElementSibling.textContent) : '';
          if (sibling && sibling.toLowerCase() !== label.toLowerCase()) return sibling.substring(0, 500);

          const parentText = clean(el.parentElement?.textContent ?? '');
          const parentMatch = parentText.match(new RegExp(`^${escaped}\\s*:?\\s*(.+)$`, 'i'));
          if (parentMatch?.[1]) return clean(parentMatch[1]).substring(0, 500);
        }

        // sectionText now uses innerText, so [^\n] correctly captures one line.
        const match = sectionText.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n]{1,300})`, 'i'));
        return match?.[1] ? clean(match[1]).substring(0, 300) : null;
      };

      const dateTime =
        scopedField('Date & Time') ||
        scopedField('Date/Time');
      const meetingDate = scopedField('Meeting Date');
      const meetingTime = scopedField('Meeting Time');
      const combinedMeetingDateTime = meetingDate && meetingTime ? `${meetingDate} ${meetingTime}` : meetingDate || meetingTime || null;
      const attendanceRequired =
        scopedField('Attendance Required') ||
        scopedField('Attendance Mandatory') ||
        scopedField('Mandatory');
      const location =
        scopedField('Meeting Location') ||
        scopedField('Location') ||
        scopedField('Address') ||
        scopedField('Venue');
      const meetingType = scopedField('Meeting Type');
      const meetingLink = scopedField('Meeting Link');
      const additionalDetails = scopedField('Additional Details');

      return {
        pre_bid_meeting: true,
        job_walk_at: dateTime || combinedMeetingDateTime || null,
        pre_bid_meeting_at: dateTime || combinedMeetingDateTime || null,
        job_walk_details: [section.header, meetingType, additionalDetails].filter(Boolean).join(' | ') || section.header,
        job_walk_location: location || null,
        pre_bid_meeting_location: location || null,
        attendance_required: attendanceRequired || null,
        meeting_type: meetingType || null,
        meeting_link: meetingLink || null,
        additional_details: additionalDetails || null,
      };
    };

    const findEstimateRaw = () => {
      const labels = [
        "Engineer's Estimate",
        'Engineers Estimate',
        'Estimated Value',
        'Estimated Bid Value',
        'Estimated Amount',
        'Estimated Cost',
        'Estimate Range',
        'Construction Estimate',
        'Budget',
        'Project Estimate',
      ];

      for (const label of labels) {
        const value = field(label);
        if (value) return value;
      }

      const contextMatch = bodyText.match(
        /(?:engineer'?s?\s+estimate|estimated\s+(?:bid\s+)?value|estimated\s+amount|estimated\s+cost|construction\s+estimate|project\s+estimate|budget)[^\n$]{0,80}(\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:[KMB]|thousand|million|billion)?(?:\s*(?:-|–|—|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?\s*(?:[KMB]|thousand|million|billion)?)?)/i
      );
      return contextMatch?.[1]?.trim() ?? null;
    };

    const scopeMatch = bodyText.match(
      /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i
    );
    const preBidSection = extractPreBidSection();

    // Body-text fallback for pre-bid date/time when section-scoped
    // extraction missed it.  bodyText = document.body.innerText preserves
    // newlines, so [^\n]+ correctly stops after the date value.
    const pre_bid_context_date = (() => {
      if (preBidSection.job_walk_at) return null;
      const idx = bodyText.search(/pre[-\s]?bid(?:\s+meeting)?|job\s+walk/i);
      if (idx < 0) return null;
      const excerpt = bodyText.substring(idx, idx + 800);
      const m = excerpt.match(/Date(?:\s*[&\/]\s*|\s+(?:and|&)\s+)Time[:\s\n]+([^\n]+)/i);
      return m ? m[1].trim() || null : null;
    })();

    return {
      estimated_value_raw: findEstimateRaw(),
      license_requirements:
        field('License Requirements') ||
        field('License Type') ||
        field('Required License') ||
        field('License') ||
        null,
      department: field('Department') || field('Agency Department') || null,
      liquidated_damages:
        field('Liquidated Damages') ||
        field('Liquidated Damage') ||
        field('LDs') ||
        null,
      contract_duration:
        field('Contract Duration') ||
        field('Duration') ||
        field('Project Duration') ||
        field('Time of Completion') ||
        field('Completion Time') ||
        null,
      bid_validity:
        field('Bid Validity') ||
        field('Bid Valid Until') ||
        field('Bid Hold') ||
        field('Validity') ||
        null,
      delivery_dates:
        field('Delivery Dates') ||
        field('Delivery Date') ||
        field('Start Date') ||
        field('Completion Date') ||
        null,
      project_address:
        field('Project Address') ||
        field('Work Location') ||
        field('Location') ||
        field('Project Location') ||
        null,
      job_walk_at:
        preBidSection.job_walk_at ||
        field('Job Walk Date') ||
        field('Job Walk Date & Time') ||
        field('Pre-Bid Meeting Date') ||
        field('Pre-Bid Meeting Date & Time') ||
        field('Prebid Meeting Date') ||
        field('Site Visit Date') ||
        null,
      pre_bid_meeting_at: preBidSection.pre_bid_meeting_at || pre_bid_context_date || null,
      pre_bid_meeting:
        preBidSection.pre_bid_meeting ||
        field('Pre-Bid Meeting') ||
        field('Prebid Meeting') ||
        field('Job Walk') ||
        null,
      job_walk_location:
        preBidSection.job_walk_location ||
        field('Job Walk Location') ||
        field('Pre-Bid Meeting Location') ||
        field('Prebid Meeting Location') ||
        field('Site Visit Location') ||
        field('Meeting Location') ||
        null,
      job_walk_details:
        preBidSection.job_walk_details ||
        field('Job Walk') ||
        field('Pre-Bid Meeting') ||
        field('Prebid Meeting') ||
        field('Mandatory Pre-Bid') ||
        field('Site Visit') ||
        null,
      attendance_required:
        preBidSection.attendance_required ||
        field('Attendance Required') ||
        field('Attendance Mandatory') ||
        field('Mandatory Attendance') ||
        field('Mandatory') ||
        null,
      meeting_type: preBidSection.meeting_type || null,
      meeting_link: preBidSection.meeting_link || null,
      additional_details: preBidSection.additional_details || null,
      county: field('County') || field('Location County') || null,
      scope_text: scopeMatch ? scopeMatch[1].trim().substring(0, 3000) : null,
    };
  }).catch((e) => {
    log(`Portal metadata extraction skipped: ${e.message}`);
    return {};
  });

  const estimate = parseEstimatedValueDetails(raw.estimated_value_raw);
  const jobWalkMetadata = normalizeJobWalkMetadata(raw);
  const metadata = {
    estimated_value: estimate.estimated_value,
    estimated_value_raw: estimate.estimated_value_raw,
    estimated_value_low: estimate.estimated_value_low,
    estimated_value_high: estimate.estimated_value_high,
    license_requirements: raw.license_requirements ?? null,
    department: raw.department ?? null,
    liquidated_damages: raw.liquidated_damages ?? null,
    contract_duration: raw.contract_duration ?? null,
    bid_validity: raw.bid_validity ?? null,
    delivery_dates: raw.delivery_dates ?? null,
    project_address: raw.project_address ?? null,
    ...jobWalkMetadata,
    meeting_type: raw.meeting_type ?? null,
    meeting_link: raw.meeting_link ?? null,
    additional_details: raw.additional_details ?? null,
    county: raw.county ?? null,
    scope_text: raw.scope_text ?? null,
    portal_metadata_refreshed_at: new Date().toISOString(),
  };

  const populated = Object.entries(metadata)
    .filter(([key, value]) => key !== 'portal_metadata_refreshed_at' && value !== null && value !== '')
    .map(([key]) => key);

  if (populated.length > 0) {
    log(`Portal metadata refreshed: ${populated.join(', ')}`);
  } else {
    log('Portal metadata refresh found no structured fields');
  }

  return metadata;
}

async function mergeCandidatePortalMetadata(supabase, candidate, portalMetadata, log) {
  const nextMetadata = Object.fromEntries(
    Object.entries(portalMetadata ?? {}).filter(([, value]) => value !== null && value !== '')
  );
  if (Object.keys(nextMetadata).length === 0) return null;

  const crawlData = {
    ...(candidate.crawl_data ?? {}),
    ...nextMetadata,
  };

  const { error } = await supabase
    .from('opportunity_candidates')
    .update({ crawl_data: crawlData })
    .eq('id', candidate.id);

  if (error) {
    log(`Candidate portal metadata update failed: ${error.message}`);
    return null;
  }

  log('Candidate crawl_data updated with portal metadata');
  return crawlData;
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

    const portalMetadata = await extractPortalMetadata(page, log);
    const bidItems = await extractPlanetBidsBidItems(page, candidate, log).catch((e) => {
      log(`PlanetBids bid item extraction failed: ${e.message}`);
      return [];
    });
    const capturedManifestJson = await openDocumentsTab(page, log);

    if (!bearerToken) {
      throw new Error('No PlanetBids bearer token captured after login');
    }

    if (capturedManifestJson) {
      return {
        documents: normalizeManifestJson(capturedManifestJson, bearerToken, log),
        portalMetadata,
        bidItems,
      };
    }

    try {
      return {
        documents: await fetchManifest(bidId, bearerToken, log),
        portalMetadata,
        bidItems,
      };
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
      const retryCapturedManifestJson = await openDocumentsTab(page, log);
      const refreshedAfterRegistration = await extractPortalMetadata(page, log);
      const retryPortalMetadata = {
        ...portalMetadata,
        ...Object.fromEntries(
          Object.entries(refreshedAfterRegistration).filter(([, value]) => value !== null && value !== '')
        ),
      };
      const retryBidItems = await extractPlanetBidsBidItems(page, candidate, log).catch((e) => {
        log(`PlanetBids bid item retry extraction failed: ${e.message}`);
        return bidItems;
      });

      if (!bearerToken) {
        throw new Error('No PlanetBids bearer token captured after prospective bidder registration');
      }

      if (retryCapturedManifestJson) {
        log('Manifest retry succeeded from Documents tab response');
        return {
          documents: normalizeManifestJson(retryCapturedManifestJson, bearerToken, log),
          portalMetadata: retryPortalMetadata,
          bidItems: retryBidItems,
        };
      }

      log('Retrying manifest after prospective bidder registration');
      const docs = await fetchManifest(bidId, bearerToken, log);
      log('Manifest retry succeeded');
      return {
        documents: docs,
        portalMetadata: retryPortalMetadata,
        bidItems: retryBidItems,
      };
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
      headers: planetBidsAuthHeaders(doc.bearer_token),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Download HTTP ${res.status}: ${body.substring(0, 200)}`);
    }

    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new Error('Download returned an empty file');
    }

    let archiveExtraction = null;
    let extractedDocuments = [];
    if (isArchiveFile(doc.file_name)) {
      log(`Extracting archive contents: ${doc.file_name}`);
      archiveExtraction = await extractSupportedArchiveEntries(bytes, log);
      log(`Archive extraction summary for ${doc.file_name}: entries=${archiveExtraction.stats.total_entries} extracted=${archiveExtraction.stats.extracted} skipped=${archiveExtraction.stats.skipped} failed=${archiveExtraction.stats.failed}`);
      extractedDocuments = await storeExtractedArchiveDocuments({
        supabase,
        taskId,
        candidateId,
        parentDoc: {
          ...doc,
          id: record.id,
          document_source_order: doc.document_source_order,
        },
        entries: archiveExtraction.entries,
        log,
      });
    }

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, bytes, {
        contentType: extensionToContentType(doc.file_name),
        upsert: true,
      });

    if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

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
        file_size: bytes.byteLength,
        manifest_data: mergedManifestData,
        ...(archiveExtraction
          ? {
              processing_status: archiveParentProcessingStatus(archiveExtraction),
              processing_error: archiveParentProcessingError(archiveExtraction),
              processing_completed_at: new Date().toISOString(),
              processing_metadata: {
                reason: 'archive_extracted_in_f2',
                stats: archiveExtraction.stats,
              },
              detected_file_type: 'zip',
              detected_mime_type: extensionToContentType(doc.file_name),
              has_text: false,
              needs_ocr: false,
            }
          : {}),
      })
      .eq('id', record.id);

    log(`Stored document: ${doc.file_name} (${bytes.byteLength} bytes)`);
    return {
      status: 'acquired',
      id: record.id,
      size: bytes.byteLength,
      archiveExtraction: archiveExtraction
        ? {
            stats: archiveExtraction.stats,
            extractedDocuments,
          }
        : null,
    };
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
      manifest_data: {
        ...(parentDoc.manifest_data ?? {}),
        source: 'archive_extraction',
        archive_parent_document_id: parentDoc.id,
        archive_parent_file_name: parentDoc.file_name,
        archive_entry_path: entry.entry_path,
        archive_entry_compressed_size: entry.compressed_size,
        archive_entry_uncompressed_size: entry.uncompressed_size,
        acquisition_method: 'f2_archive_extraction',
      },
    };

    try {
      const upserted = await upsertDocumentRecord(supabase, taskId, candidateId, childDoc);
      record = upserted.record;
      const { skipped } = upserted;
      if (skipped) {
        log(`Skipping already acquired archive entry: ${entry.entry_path}`);
        stored.push({ status: 'skipped', id: record.id, filename: fileName });
        continue;
      }

      await supabase
        .from('opportunity_documents')
        .update({ acquisition_status: 'acquiring', acquisition_error: null })
        .eq('id', record.id);

      const storagePath = `opportunity-candidates/${candidateId}/${parentDoc.id}/extracted/${record.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .upload(storagePath, entry.bytes, {
          contentType: extensionToContentType(fileName),
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
          file_name: fileName,
          file_size: entry.file_size,
          file_type: inferFileType(fileName),
          manifest_data: childDoc.manifest_data,
        })
        .eq('id', record.id);

      log(`Uploaded extracted archive document: ${entry.entry_path} (${entry.file_size} bytes)`);
      stored.push({ status: 'acquired', id: record.id, filename: fileName, bytes: entry.file_size });
    } catch (e) {
      if (record?.id) {
        await supabase
          .from('opportunity_documents')
          .update({
            acquisition_status: 'failed',
            acquisition_error: e.message,
          })
          .eq('id', record.id);
      }
      log(`Extracted archive document failed: ${entry.entry_path}: ${e.message}`);
      stored.push({ status: 'failed', filename: fileName, error: e.message });
    }
  }
  return stored;
}

async function acquirePlanetBidsDocuments({ supabase, task, candidate, log }) {
  const { documents: manifestDocs, portalMetadata, bidItems = [] } = await getAuthenticatedManifest(candidate, log);
  const updatedCrawlData = await mergeCandidatePortalMetadata(supabase, candidate, portalMetadata, log);
  if (updatedCrawlData) candidate.crawl_data = updatedCrawlData;
  await replacePortalBidItemsForCandidate({
    supabase,
    candidateId: candidate.id,
    items: bidItems,
    defaults: {
      sourcePortal: 'planetbids',
      sourceOpportunityId: candidate.crawl_data?.bid_id ?? extractBidId(candidate.source_url),
      extractionMethod: 'portal_tab',
      sourceUrl: candidate.source_url,
    },
    log,
  }).catch((e) => {
    log(`PlanetBids bid item storage failed: ${e.message}`);
  });
  let acquired = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const doc of manifestDocs) {
    try {
      const result = await downloadAndStoreDocument(supabase, task.id, candidate.id, doc, log);
      if (result.status === 'acquired') acquired++;
      if (result.status === 'skipped') skipped++;
      if (result.archiveExtraction?.extractedDocuments?.length) {
        for (const extracted of result.archiveExtraction.extractedDocuments) {
          if (extracted.status === 'acquired') acquired++;
          else if (extracted.status === 'skipped') skipped++;
          else if (extracted.status === 'failed') failed++;
        }
      }
    } catch (e) {
      failed++;
      errors.push(`${doc.file_name}: ${e.message}`);
      log(`Document failed: ${doc.file_name} — ${e.message}`);
    }
  }

  const documentsFound = Math.max(manifestDocs.length, acquired + skipped + failed);
  return {
    found: documentsFound,
    acquired,
    skipped,
    failed,
    warningSummary: failed > 0 && (acquired + skipped) > 0
      ? `Some source documents could not be acquired. BidBox successfully acquired ${acquired + skipped} of ${documentsFound} available documents.`
      : null,
    errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
  };
}

module.exports = {
  acquirePlanetBidsDocuments,
  DOCUMENT_BUCKET,
  extractPlanetBidsBidItemsFromJson,
};
