const { chromium } = require('playwright');
const {
  extractSupportedArchiveEntries,
  isArchiveFile,
} = require('./archive_extraction');
const { replacePortalBidItemsForCandidate } = require('./bid_items');
const { createBrowserbaseSessionId } = require('../lib/browserbase');

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

function pacificOffsetHoursForDate(year, month, day) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
    const tzName = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
    const match = tzName.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (match) return Math.abs(Number(match[1]));
  } catch {
    // Fall through to a conservative California bidding-season default.
  }
  return month >= 3 && month <= 10 ? 7 : 8;
}

function parseBidDueDate(raw) {
  if (!raw) return null;
  const text = String(raw).replace(/\s+/g, ' ').trim();
  const explicitPacific = text.match(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(?:\(?\s*(PDT|PST|PT)\s*\)?)?/i
  );
  if (explicitPacific) {
    const [, monthText, dayText, yearText, hourText, minuteText = '0', meridiem, tzText] = explicitPacific;
    let hour = Number(hourText);
    const minute = Number(minuteText);
    if (/PM/i.test(meridiem) && hour !== 12) hour += 12;
    if (/AM/i.test(meridiem) && hour === 12) hour = 0;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const offsetHours = /PST/i.test(tzText || '')
      ? 8
      : /PDT/i.test(tzText || '')
        ? 7
        : pacificOffsetHoursForDate(year, month, day);
    const d = new Date(Date.UTC(year, month - 1, day, hour + offsetHours, minute, 0));
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  try {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
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
    // Accept arrays that look like bid items even with a single row (lump-sum case).
    // The pathHint guard is broadened to catch PlanetBids endpoints like "schedule",
    // "bidSchedule", "lineItems", "items", "rows" as well as the original "line/item/bid".
    const pathLooksLikeItems = /line|item|bid|schedule|row/.test(pathHint);
    if (objectItems.length > 0 && itemLikeCount > 0 && (pathLooksLikeItems || itemLikeCount >= Math.min(2, objectItems.length))) {
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
  // Centralized create with concurrency gate + 429/503 backoff (see lib/browserbase).
  const sessionId = await createBrowserbaseSessionId(bbApiKey, bbProjectId, log);
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

// ─── Column-index helpers ────────────────────────────────────────────────────
function headerIdx(headers, patterns) {
  return headers.findIndex((h) => patterns.some((p) => p.test(h)));
}

function parseItemsFromHeadersAndRows(headers, rowTexts, sectionName, kind, log) {
  const h = headers.map((x) => x.toLowerCase().trim());
  const itemIdx = headerIdx(h, [/^#$/, /item\s*(no|number|#)?$/, /^no\.?$/]);
  const codeIdx = headerIdx(h, [/item\s*code/, /^code$/]);
  const descIdx = headerIdx(h, [/description/, /item\s*description/, /scope/, /item\s*name/]);
  const uomIdx  = headerIdx(h, [/^uom$/, /unit\s*of\s*measure/, /^unit$/]);
  const qtyIdx  = headerIdx(h, [/^qty$/, /quantity/, /estimated\s*quantity/]);
  const refIdx  = headerIdx(h, [/reference/, /^ref$/]);

  log(`bid_item_extract [${kind}]: headers=[${headers.join(' | ')}] descIdx=${descIdx}`);

  // If no description column found, use the widest column across all rows.
  let effectiveDescIdx = descIdx;
  if (effectiveDescIdx < 0 && rowTexts.length > 0) {
    const colWidths = (rowTexts[0] ?? []).map((_, ci) =>
      Math.max(...rowTexts.map((r) => (r[ci] ?? '').length))
    );
    effectiveDescIdx = colWidths.indexOf(Math.max(...colWidths));
    log(`bid_item_extract [${kind}]: no description column — using widest col ${effectiveDescIdx} as fallback`);
  }

  const items = [];
  for (const [i, row] of rowTexts.entries()) {
    const description = (row[effectiveDescIdx] ?? '').trim();
    // Skip blank rows and bare footer totals ("Total", "Grand Total").
    // Do NOT skip named lump-sum items like "Total Bid Amount" or "Total Base Bid"
    // — those are valid bid schedule entries even though they start with "Total".
    if (!description || /^(grand\s+)?total\s*$/i.test(description)) continue;
    items.push({
      section_name: sectionName || null,
      item_number: itemIdx >= 0 ? (row[itemIdx] ?? '').trim() || String(i + 1) : String(i + 1),
      item_code:   codeIdx >= 0 ? (row[codeIdx] ?? '').trim() || null : null,
      description,
      unit_of_measure: uomIdx >= 0 ? (row[uomIdx] ?? '').trim() || null : null,
      quantity_raw:    qtyIdx >= 0 ? (row[qtyIdx] ?? '').trim() || null : null,
      reference:       refIdx >= 0 ? (row[refIdx] ?? '').trim() || null : null,
      raw_text: row.join(' | '),
      metadata: { source_table_headers: headers, source_table_kind: kind, fallback_desc: descIdx < 0 },
    });
  }
  return items;
}

async function extractPlanetBidsBidItems(page, candidate, log) {
  // ── 1. Instrument: current URL ───────────────────────────────────────────
  const currentUrl = page.url();
  log(`bid_item_extract: current URL = ${currentUrl}`);

  // ── 2. API response interception ─────────────────────────────────────────
  // Register BEFORE clicking the tab so we catch the API call that fires on click.
  // Promise refs are stored so we can await them after page.off() — this avoids
  // the race where page.off() stops new events but in-flight res.json() calls
  // still need to complete.
  const bidItemResponses = [];
  const pendingJsonReads = [];

  const responseListener = (res) => {
    try {
      const url = res.url();
      if (!url.includes(API_HOST) || !res.ok()) return;
      if (!/(line.{0,15}item|bid.{0,15}item|item.{0,15}line|bid.{0,15}schedule|schedule.{0,15}bid|\/items|\/schedule|lump.{0,10}sum)/i.test(url)) return;
      log(`bid_item_extract: intercepted API response — ${url}`);
      const p = res.json()
        .then((json) => {
          if (json) {
            // Log structure so we know what the API actually returns.
            const preview = JSON.stringify(json).substring(0, 500);
            log(`bid_item_extract: API JSON preview — ${preview}`);
            bidItemResponses.push({ url, json });
          }
        })
        .catch((e) => log(`bid_item_extract: API JSON parse error for ${url}: ${e.message}`));
      pendingJsonReads.push(p);
    } catch (_) {}
  };

  page.on('response', responseListener);

  // ── 3. Find and click the Line Items tab ─────────────────────────────────
  let tabClicked = false;

  try {
    // Log all tab labels present so we know what the page actually shows.
    const allTabTexts = await page.locator('[role="tab"], mat-tab-label, .mat-tab-label, .mat-mdc-tab').allInnerTexts().catch(() => []);
    log(`bid_item_extract: visible tabs = [${allTabTexts.map((t) => t.trim()).join(' | ')}]`);

    // Primary: role="tab" scoped to tabs containing "line items" or "bid items"
    const lineItemsTab = page
      .locator('[role="tab"], mat-tab-label, .mat-tab-label, .mat-mdc-tab')
      .filter({ hasText: /line\s*items?|bid\s*items?|bid\s*line\s*items?/i })
      .first();

    if (await lineItemsTab.isVisible({ timeout: 8000 }).catch(() => false)) {
      const label = await lineItemsTab.innerText().catch(() => '?');
      log(`bid_item_extract: clicking tab "${label.trim()}"`);
      await lineItemsTab.click();
      tabClicked = true;
    } else {
      // Fallback: any visible element whose text contains the pattern
      const fallback = page.getByText(/line\s*items?|bid\s*items?/i).first();
      if (await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
        const label = await fallback.innerText().catch(() => '?');
        log(`bid_item_extract: clicking fallback element "${label.trim()}"`);
        await fallback.click();
        tabClicked = true;
      }
    }
  } catch (e) {
    log(`bid_item_extract: tab click threw — ${e.message}`);
  }

  if (!tabClicked) {
    page.off('response', responseListener);
    log('bid_item_extract: Line Items tab not found — extraction skipped');
    return [];
  }

  // ── 4. Wait for content to render ────────────────────────────────────────
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  page.off('response', responseListener);
  await Promise.allSettled(pendingJsonReads);
  log(`bid_item_extract: API responses captured = ${bidItemResponses.length}`);

  // ── 5. PRIMARY DOM EXTRACTION — Playwright locators ──────────────────────
  // Use Playwright's locator API instead of page.evaluate() + querySelectorAll.
  // Playwright locators resolve Angular Material custom elements (mat-row,
  // mat-cell, mat-header-cell) natively, handle Shadow DOM, and read live
  // rendered text — no guessing about the DOM structure from the outside.
  //
  // Strategy waterfall:
  //   A. mat-header-cell + mat-row + mat-cell  (Angular Material non-native table)
  //   B. <table> th/td                          (native HTML table)
  //   C. innerText parsing of active tab panel  (last-resort generic fallback)

  const domItems = [];

  // Scope to the active tab panel — avoids picking up hidden tab content.
  // Angular Material marks inactive tab bodies with aria-hidden="true".
  const activePanel = page.locator([
    'mat-tab-body[aria-hidden="false"]',
    'mat-tab-body.mat-mdc-tab-body-active',
    'mat-tab-body.mat-tab-body-active',
    '[role="tabpanel"]:not([aria-hidden="true"])',
  ].join(', ')).first();

  // ── Strategy A: mat-row / mat-cell (PlanetBids Angular Material) ──────────
  const matRowLocator = activePanel.locator('mat-row');
  const matRowCount = await matRowLocator.count().catch(() => 0);
  log(`bid_item_extract [mat]: mat-row count = ${matRowCount}`);

  if (matRowCount > 0) {
    const rawHeaders = await activePanel.locator('mat-header-cell').allInnerTexts().catch(() => []);
    const headers = rawHeaders.map((h) => h.trim());
    log(`bid_item_extract [mat]: headers = [${headers.join(' | ')}]`);

    const rowTexts = [];
    for (let i = 0; i < matRowCount; i++) {
      const cellTexts = await matRowLocator.nth(i).locator('mat-cell').allInnerTexts().catch(() => []);
      const cells = cellTexts.map((c) => c.trim());
      log(`bid_item_extract [mat]: row ${i + 1} = [${cells.join(' | ')}]`);
      rowTexts.push(cells);
    }

    const parsed = parseItemsFromHeadersAndRows(headers, rowTexts, 'Main Bid', 'mat-row', log);
    domItems.push(...parsed);
    log(`bid_item_extract [mat]: parsed ${parsed.length} item(s)`);
  }

  // ── Strategy B: PlanetBids Ember table (tr.data-row + td[title]) ─────────
  // PlanetBids renders bid items as <tr class="data-row"> inside an Ember.js
  // table where th elements have empty innerText. Column values live in the
  // td[title] attribute. Column positions (0-indexed):
  //   0=itemNumber  1=itemCode  2=description  3=UOM  4=qty  5=reference  6=unitPrice
  if (domItems.length === 0) {
    const emberItems = await page.evaluate(() => {
      const panel =
        document.querySelector('[role="tabpanel"]:not([aria-hidden="true"])') ||
        document.querySelector('#bo-detail-content') ||
        document.body;
      const rows = Array.from(panel.querySelectorAll('tr.data-row'));
      return rows.map((tr, i) => {
        const tds = Array.from(tr.querySelectorAll('td'));
        const t = (idx) => (tds[idx]?.getAttribute('title') ?? '').trim();
        return {
          item_number: t(0) || null,
          item_code: t(1) || null,
          description: t(2),
          uom: t(3) || null,
          quantity: t(4) || null,
          reference: t(5) || null,
          unit_price: t(6) || null,
          data_item_id: tr.getAttribute('data-itemid') || null,
          source_order: i,
        };
      }).filter((r) => r.description);
    });

    log(`bid_item_extract [ember]: tr.data-row count = ${emberItems.length}`);

    if (emberItems.length > 0) {
      for (const item of emberItems) {
        domItems.push({
          item_number: item.item_number,
          item_code: item.item_code,
          description: item.description,
          unit_of_measure: item.uom,
          quantity_raw: item.quantity,
          unit_price_raw: item.unit_price,
          section_name: 'Main Bid',
          source_order: item.source_order,
          extraction_method: 'portal_tab',
          metadata: {
            data_item_id: item.data_item_id,
            reference: item.reference,
            portal: 'planetbids',
            strategy: 'ember-title-attr',
          },
        });
      }
      log(`bid_item_extract [ember]: parsed ${domItems.length} item(s)`);
    }
  }

  // ── Strategy C: native <table> (generic HTML tables) ─────────────────────
  if (domItems.length === 0) {
    const nativeTables = await activePanel.locator('table').count().catch(() => 0);
    log(`bid_item_extract [native]: table count = ${nativeTables}`);

    for (let t = 0; t < nativeTables; t++) {
      const table = activePanel.locator('table').nth(t);
      const allRows = table.locator('tr');
      const rowCount = await allRows.count().catch(() => 0);
      if (rowCount < 2) continue;

      const rawHeaders = await allRows.nth(0).locator('th, td').allInnerTexts().catch(() => []);
      const headers = rawHeaders.map((h) => h.trim());
      const tableText = await table.innerText().catch(() => '');
      if (!/(description|item|quantity|qty|unit)/i.test(tableText)) continue;

      const rowTexts = [];
      for (let r = 1; r < rowCount; r++) {
        const cells = await allRows.nth(r).locator('td').allInnerTexts().catch(() => []);
        rowTexts.push(cells.map((c) => c.trim()));
      }

      const parsed = parseItemsFromHeadersAndRows(headers, rowTexts, '', `native-table-${t}`, log);
      domItems.push(...parsed);
      log(`bid_item_extract [native]: table ${t} → ${parsed.length} item(s)`);
    }
  }

  // ── Strategy D: innerText parsing of active tab panel ─────────────────────
  if (domItems.length === 0) {
    log('bid_item_extract [text]: falling back to innerText parsing');
    const panelText = await activePanel.innerText({ timeout: 5000 }).catch(() => '');
    log(`bid_item_extract [text]: panel innerText (first 1000 chars) = ${panelText.substring(0, 1000)}`);

    const lines = panelText.split('\n').map((l) => l.trim()).filter(Boolean);
    // Find the header line — the one that contains "Description"
    const headerLineIdx = lines.findIndex((l) => /description/i.test(l));
    if (headerLineIdx >= 0) {
      const headers = lines[headerLineIdx].split(/\t|  +/).map((h) => h.trim()).filter(Boolean);
      log(`bid_item_extract [text]: header line = "${lines[headerLineIdx]}"`);

      const rowTexts = lines
        .slice(headerLineIdx + 1)
        .map((l) => l.split(/\t|  +/).map((c) => c.trim()))
        .filter((cols) => cols.length >= 2 && cols.some((c) => c.length > 1));

      const parsed = parseItemsFromHeadersAndRows(headers, rowTexts, '', 'innerText', log);
      domItems.push(...parsed);
      log(`bid_item_extract [text]: parsed ${parsed.length} item(s)`);
    } else {
      log('bid_item_extract [text]: no header line found in panel text');
    }
  }

  // ── 6. API rows ──────────────────────────────────────────────────────────
  const apiItems = bidItemResponses.flatMap((response) => {
    const parsed = extractPlanetBidsBidItemsFromJson(response.json);
    log(`bid_item_extract [api]: ${response.url} → ${parsed.length} row(s)`);
    return parsed.map((row) => ({ ...row, metadata: { ...(row.metadata ?? {}), api_url: response.url } }));
  });

  // ── 7. Merge: DOM rows are primary; API rows fill gaps if DOM is empty ────
  const sourceRows = domItems.length > 0 ? domItems : apiItems;
  if (domItems.length === 0 && apiItems.length === 0) {
    log('bid_item_extract: ZERO rows from both DOM and API');
  }

  // ── 8. Deduplicate ────────────────────────────────────────────────────────
  const combinedRows = [];
  const seen = new Set();
  for (const row of sourceRows) {
    const key = [row.item_number, row.item_code, row.description, row.quantity_raw, row.unit_of_measure]
      .map((p) => cleanText(p).toLowerCase())
      .join('|');
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
    metadata: { ...(row.metadata ?? {}), source: 'planetbids_line_items_tab', bid_id: bidId },
  }));

  log(`bid_item_extract: TOTAL — dom=${domItems.length} api=${apiItems.length} combined=${normalized.length}`);
  return normalized;
}

async function extractPortalMetadata(page, log) {
  const finalUrl = page.url();
  const pageTitle = await page.title().catch(() => '');
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const bodyText = document.body?.innerText ?? '';
    const selectorFailures = [];

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

      selectorFailures.push(label);
      return null;
    };

    const cleanTitle = (t) => {
      if (!t) return null;
      return t
        .replace(/\s*Add to My Bids[\s\S]*/i, '')
        .replace(/\s*REMAINING[\s\S]*/i, '')
        .replace(/\s+(?:[A-Z]{1,4}-\d{2}-\d{3,5}|\d{2,4}-\d{3,5})\s*$/, '')
        .trim() || null;
    };

    // Parses the "Pre-Bid Meeting Information" section from bodyText.
    // Returns an object of lowercased label → value string pairs when the
    // section is found, or null when the heading is absent from the page.
    const extractPreBidMeetingSection = () => {
      const trimLine = (s) => String(s ?? '').trim();

      const KNOWN_LABELS = [
        'pre-bid meeting',
        'meeting type',
        'date & time',
        'date/time',
        'meeting date',
        'meeting time',
        'meeting link',
        'attendance required',
        'attendance mandatory',
        'mandatory',
        'location',
        'meeting location',
        'address',
        'venue',
        'additional details',
        'notes',
      ];
      const labelKey = (s) => trimLine(s).toLowerCase().replace(/\s+/g, ' ');
      const labelSet = new Set(KNOWN_LABELS);

      const headingRe = /^pre[-\s]?bid\s+meeting(?:\s+information)?\s*$/im;
      const headingMatch = bodyText.match(headingRe);
      if (!headingMatch) return null;

      const afterHeading = headingMatch.index + headingMatch[0].length;

      const STOP_RE = /^(?:online\s+q\s*&\s*a|contact\s+information|bid\s+bond|project\s+information|plan\s+holders|required\s+documents|addenda|q\s*&\s*a|documents?|submission)\s*$/im;
      const stopMatch = bodyText.substring(afterHeading).match(STOP_RE);
      const sectionEnd = stopMatch
        ? afterHeading + stopMatch.index
        : Math.min(afterHeading + 2000, bodyText.length);

      const sectionText = bodyText.substring(afterHeading, sectionEnd);
      const lines = sectionText.split('\n').map(trimLine).filter(Boolean);

      const pairs = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const colonIdx = line.indexOf(':');
        if (colonIdx > 0 && colonIdx < 70) {
          const rawKey = labelKey(line.substring(0, colonIdx));
          const rawVal = trimLine(line.substring(colonIdx + 1));
          if (labelSet.has(rawKey) && rawVal) {
            pairs[rawKey] = rawVal;
            continue;
          }
        }

        const lineKey = labelKey(line);
        if (labelSet.has(lineKey)) {
          const nextLine = i + 1 < lines.length ? trimLine(lines[i + 1]) : null;
          if (nextLine && !labelSet.has(labelKey(nextLine))) {
            pairs[lineKey] = nextLine;
            i++;
          } else {
            pairs[lineKey] = null;
          }
        }
      }

      return pairs;
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

    // Parses the "Job Walk" / "Job Walk Information" / "Site Visit" section from
    // bodyText using the same architecture as extractPreBidMeetingSection.
    const extractJobWalkSection = () => {
      const trimLine = (s) => String(s ?? '').trim();
      const KNOWN_LABELS = [
        'date & time', 'date/time', 'meeting date', 'meeting time',
        'location', 'meeting location', 'address', 'venue',
        'attendance required', 'attendance mandatory', 'mandatory',
        'meeting type', 'meeting link',
        'additional details', 'notes',
        'job walk', 'site visit',
      ];
      const labelKey = (s) => trimLine(s).toLowerCase().replace(/\s+/g, ' ');
      const labelSet = new Set(KNOWN_LABELS);

      const headingRe = /^(?:job\s+walk|site\s+visit|mandatory\s+pre[-\s]?bid|pre[-\s]?bid\s+site\s+visit)(?:\s+information)?\s*$/im;
      const headingMatch = bodyText.match(headingRe);
      if (!headingMatch) return null;

      const afterHeading = headingMatch.index + headingMatch[0].length;
      const STOP_RE = /^(?:online\s+q\s*&\s*a|contact\s+information|bid\s+bond|project\s+information|plan\s+holders|required\s+documents|addenda|pre[-\s]?bid\s+meeting(?:\s+information)?|q\s*&\s*a|documents?|submission)\s*$/im;
      const stopMatch = bodyText.substring(afterHeading).match(STOP_RE);
      const sectionEnd = stopMatch
        ? afterHeading + stopMatch.index
        : Math.min(afterHeading + 2000, bodyText.length);

      const sectionText = bodyText.substring(afterHeading, sectionEnd);
      const lines = sectionText.split('\n').map(trimLine).filter(Boolean);

      const pairs = {};
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0 && colonIdx < 70) {
          const rawKey = labelKey(line.substring(0, colonIdx));
          const rawVal = trimLine(line.substring(colonIdx + 1));
          if (labelSet.has(rawKey) && rawVal) { pairs[rawKey] = rawVal; continue; }
        }
        const lineKey = labelKey(line);
        if (labelSet.has(lineKey)) {
          const nextLine = i + 1 < lines.length ? trimLine(lines[i + 1]) : null;
          if (nextLine && !labelSet.has(labelKey(nextLine))) {
            pairs[lineKey] = nextLine; i++;
          } else {
            pairs[lineKey] = null;
          }
        }
      }
      return pairs;
    };

    const scopeMatch = bodyText.match(
      /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i
    );
    const jobWalkPairs = extractJobWalkSection();
    const preBidPairs = extractPreBidMeetingSection();
    const titleEl = document.querySelector(
      "h1, h2, [class*='title'], [class*='bid-name'], [class*='project-name']"
    );
    const raw_title = cleanTitle(
      (titleEl && titleEl.innerText && titleEl.innerText.trim()) ||
      field('Bid Title') ||
      field('Project Title') ||
      field('Project Name') ||
      field('Title') ||
      null
    );
    const due_date_raw =
      field('Closing Date') ||
      field('Bid Due Date') ||
      field('Bid Due') ||
      field('Due Date') ||
      null;

    return {
      raw_title: raw_title ? raw_title.substring(0, 500) : null,
      due_date_raw,
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
      // Job walk fields — section parser only; field() not used (leaks heading text).
      job_walk_at: jobWalkPairs !== null
        ? (jobWalkPairs['date & time'] || jobWalkPairs['date/time'] || jobWalkPairs['meeting date'] || null)
        : null,
      job_walk_details: jobWalkPairs !== null
        ? (jobWalkPairs['additional details'] || jobWalkPairs['notes'] || null)
        : null,
      job_walk_location: jobWalkPairs !== null
        ? (jobWalkPairs['meeting location'] || jobWalkPairs['location'] || jobWalkPairs['address'] || jobWalkPairs['venue'] || null)
        : null,
      // Pre-bid fields — section parser only.
      pre_bid_meeting: preBidPairs !== null
        ? (preBidPairs['pre-bid meeting'] ?? null)
        : null,
      pre_bid_meeting_at: preBidPairs !== null
        ? (preBidPairs['date & time'] || preBidPairs['date/time'] || preBidPairs['meeting date'] || null)
        : null,
      pre_bid_meeting_location: preBidPairs !== null
        ? (preBidPairs['meeting location'] || preBidPairs['location'] || preBidPairs['address'] || preBidPairs['venue'] || null)
        : null,
      meeting_type:
        (jobWalkPairs !== null ? jobWalkPairs['meeting type'] : null) ||
        (preBidPairs !== null ? preBidPairs['meeting type'] : null) ||
        null,
      meeting_link:
        (jobWalkPairs !== null ? jobWalkPairs['meeting link'] : null) ||
        (preBidPairs !== null ? preBidPairs['meeting link'] : null) ||
        null,
      additional_details: preBidPairs !== null
        ? (preBidPairs['additional details'] || preBidPairs['notes'] || null)
        : null,
      attendance_required:
        (jobWalkPairs !== null
          ? (jobWalkPairs['attendance required'] || jobWalkPairs['attendance mandatory'] || jobWalkPairs['mandatory'] || null)
          : null) ||
        (preBidPairs !== null
          ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
          : null) ||
        null,
      section_scoped_job_walk_at: jobWalkPairs !== null
        ? (jobWalkPairs['date & time'] || jobWalkPairs['date/time'] || jobWalkPairs['meeting date'] || null)
        : null,
      section_scoped_job_walk_details: jobWalkPairs !== null
        ? (jobWalkPairs['additional details'] || jobWalkPairs['notes'] || null)
        : null,
      section_scoped_attendance_required:
        (jobWalkPairs !== null
          ? (jobWalkPairs['attendance required'] || jobWalkPairs['attendance mandatory'] || jobWalkPairs['mandatory'] || null)
          : null) ||
        (preBidPairs !== null
          ? (preBidPairs['attendance required'] || preBidPairs['attendance mandatory'] || preBidPairs['mandatory'] || null)
          : null) ||
        null,
      county: field('County') || field('Location County') || null,
      scope_text: scopeMatch ? scopeMatch[1].trim().substring(0, 3000) : null,
      addenda_count: (bodyText.match(/\baddenda?\b/gi) ?? []).length || null,
      document_count: document.querySelectorAll('[href*="download"], [class*="document" i], [class*="file" i]').length || null,
      _debug: {
        parserPath: 'planetbids_detail_body_text_v2',
        rootContainers: {
          bo_detail_content: Boolean(document.querySelector('#bo-detail-content')),
          ember_application: Boolean(document.querySelector('.ember-application, [class*="ember-view"]')),
          app_root: Boolean(document.querySelector('#app, [data-test-root], main')),
          body: Boolean(document.body),
        },
        pageTitle: document.title,
        bodyTextLength: bodyText.length,
        bodyPreview: bodyText.replace(/\s+/g, ' ').trim().substring(0, 800),
        selectorFailures,
      },
    };
  }).catch((e) => {
    log(`Portal metadata extraction skipped: ${e.message}`);
    return {};
  });

  const estimate = parseEstimatedValueDetails(raw.estimated_value_raw);
  const jobWalkMetadata = normalizeJobWalkMetadata(raw);
  const metadata = {
    raw_title: raw.raw_title ?? null,
    due_date_raw: raw.due_date_raw ?? null,
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
    addenda_count: raw.addenda_count ?? null,
    document_count: raw.document_count ?? null,
    portal_metadata_refreshed_at: new Date().toISOString(),
  };

  log(`PlanetBids detail diagnostics: final_url=${finalUrl}; page_title="${pageTitle}"; parser=${raw._debug?.parserPath ?? 'unknown'}; roots=${JSON.stringify(raw._debug?.rootContainers ?? {})}; body_chars=${raw._debug?.bodyTextLength ?? 0}`);
  log(`PlanetBids raw detail metadata before normalization: ${JSON.stringify({
    title: raw.raw_title ?? null,
    solicitation: extractBidId(finalUrl),
    bid_due: raw.due_date_raw ?? null,
    posting_date: null,
    department: raw.department ?? null,
    county: raw.county ?? null,
    estimated_value: raw.estimated_value_raw ?? null,
    location: raw.project_address ?? null,
    description: raw.scope_text ? raw.scope_text.substring(0, 240) : null,
    addenda_count: raw.addenda_count ?? null,
    document_count: raw.document_count ?? null,
  })}`);
  const criticalMissing = ['raw_title', 'due_date_raw', 'department', 'county']
    .filter((key) => !raw[key]);
  if (criticalMissing.length > 0) {
    log(`PlanetBids selector misses for critical fields: ${criticalMissing.join(', ')}; failed_labels=${(raw._debug?.selectorFailures ?? []).slice(0, 30).join(', ')}; body_preview=${raw._debug?.bodyPreview ?? ''}`);
  }

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

  const updatePayload = {
    crawl_data: crawlData,
  };
  if (nextMetadata.raw_title) updatePayload.raw_title = nextMetadata.raw_title;
  if (nextMetadata.due_date_raw) {
    const parsedBidDue = parseBidDueDate(nextMetadata.due_date_raw);
    if (parsedBidDue) updatePayload.bid_due_at = parsedBidDue;
  }
  if (nextMetadata.estimated_value !== undefined) updatePayload.estimated_value = nextMetadata.estimated_value;
  if (nextMetadata.estimated_value_low !== undefined) updatePayload.estimated_value_low = nextMetadata.estimated_value_low;
  if (nextMetadata.estimated_value_high !== undefined) updatePayload.estimated_value_high = nextMetadata.estimated_value_high;
  if (nextMetadata.county) updatePayload.county = nextMetadata.county;
  if (nextMetadata.project_address) updatePayload.project_address = nextMetadata.project_address;
  if (nextMetadata.department) updatePayload.portal_department = nextMetadata.department;
  const bidId = candidate.portal_bid_id ?? candidate.crawl_data?.bid_id ?? extractBidId(candidate.source_url);
  if (bidId) updatePayload.portal_bid_id = bidId;

  const { error } = await supabase
    .from('opportunity_candidates')
    .update(updatePayload)
    .eq('id', candidate.id);

  if (error) {
    log(`Candidate portal metadata update failed: ${error.message}`);
    return null;
  }

  log(`Candidate portal metadata promoted: ${Object.keys(updatePayload).join(', ')}`);
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

// ── LIGHTWEIGHT BID ITEM SCAN ─────────────────────────────────────────────────
// Visits the PlanetBids detail page, clicks the Line Items tab, and stores
// portal-native bid items. Does NOT download documents, run F3/F4, or interact
// with any other tabs. Called by the bid_item_scan worker task which is queued
// immediately after a new candidate is discovered so bid items appear in the
// UI without requiring the user to click Analyze Project first.

async function runPlanetBidsBidItemScan({ supabase, candidate, log = console.log }) {
  if (!candidate?.source_url) throw new Error('bid_item_scan: candidate missing source_url');
  if (candidate.portal_type !== 'planetbids') {
    throw new Error(`bid_item_scan not implemented for portal_type=${candidate.portal_type}`);
  }

  const { browser, page } = await createBrowserbasePage(log);
  try {
    log(`bid_item_scan: navigating to ${candidate.source_url}`);
    await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Attempt login if credentials are present — some agencies gate the Line Items tab.
    // After loginToPlanetBids the browser redirects to the portal dashboard, so we
    // must re-navigate back to the bid detail page before extracting line items.
    const email = process.env.PLANETBIDS_EMAIL;
    const password = process.env.PLANETBIDS_PASSWORD;
    if (email && password) {
      await loginToPlanetBids(page, log).catch((e) => {
        log(`bid_item_scan: login skipped (${e.message}); proceeding as public`);
      });
      log(`bid_item_scan: re-navigating to bid detail after login: ${candidate.source_url}`);
      await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    const items = await extractPlanetBidsBidItems(page, candidate, log);
    log(`bid_item_scan: extracted ${items.length} bid item(s)`);

    const persist = await replacePortalBidItemsForCandidate({
      supabase,
      candidateId: candidate.id,
      items,
      defaults: {
        sourcePortal: 'planetbids',
        sourceOpportunityId: candidate.portal_bid_id ?? candidate.crawl_data?.bid_id ?? null,
        sourceUrl: candidate.source_url,
        extractionMethod: 'portal_tab',
      },
      log,
    });

    return { extracted: items.length, inserted: persist.inserted ?? 0 };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = {
  acquirePlanetBidsDocuments,
  runPlanetBidsBidItemScan,
  DOCUMENT_BUCKET,
  extractPlanetBidsBidItemsFromJson,
};
