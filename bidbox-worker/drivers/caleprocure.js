const { chromium } = require('playwright');
const { connectBrowserbaseSession, fetchBrowserbaseDownloadZip } = require('../lib/browserbase');

const DEFAULT_LISTING_URL = 'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx';
const DEFAULT_DETAIL_LIMIT = 300;
const DEFAULT_DETAIL_BATCH_SIZE = 40;
const DEFAULT_MAX_DETAIL_SESSIONS = 10;
const DEFAULT_MAX_CONSECUTIVE_DETAIL_FAILURES = 10;

function sourceLabel(source) {
  return source?.name ?? source?.source_name ?? 'Cal eProcure';
}

function collapseWs(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKeyPart(value) {
  return String(value ?? 'document')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'document';
}

function sanitizeFileName(name) {
  const cleaned = String(name ?? 'document')
    .replace(/[\/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'document';
}

function inferFileType(fileName) {
  const match = String(fileName ?? '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : null;
}

function extensionToContentType(fileName) {
  const lower = String(fileName ?? '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.zip')) return 'application/zip';
  return 'application/octet-stream';
}

function parseMoneyAmount(raw) {
  if (!raw) return null;
  const numeric = String(raw).replace(/[$,\s]/g, '');
  const value = Number(numeric);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function extractEstimatedValue(text) {
  const source = String(text ?? '');
  const patterns = [
    /estimated\s+(?:cost|construction\s+cost|value|amount)(?:\s+of\s+(?:construction|this\s+contract))?\s+(?:is|will\s+be|:)?\s*(?:approximately|about)?\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
    /(?:engineer'?s\s+estimate|construction\s+estimate)\s*(?:is|:)?\s*(?:approximately|about)?\s*\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    const value = parseMoneyAmount(match?.[1]);
    if (value) return { value, raw: collapseWs(match[0]) };
  }
  return { value: null, raw: null };
}

function extractContractDuration(text) {
  const source = String(text ?? '');
  const patterns = [
    /estimated\s+duration\s+of\s+(?:this\s+)?(?:contract|project)\s+(?:will\s+be|is|:)?\s*([0-9][0-9,]*\s+(?:calendar|working)?\s*days?)/i,
    /(?:contract|project)\s+duration\s*(?:is|:)?\s*([0-9][0-9,]*\s+(?:calendar|working)?\s*days?)/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) return { value: collapseWs(match[1]), raw: collapseWs(match[0]) };
  }
  return { value: null, raw: null };
}

function uniq(values) {
  return [...new Set((values ?? []).map((v) => collapseWs(v)).filter(Boolean))];
}

function laOffsetMinutes(utcMs) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = {};
  for (const part of dtf.formatToParts(new Date(utcMs))) parts[part.type] = part.value;
  const hour = parts.hour === '24' ? 0 : Number(parts.hour);
  const asIfUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return (asIfUtc - utcMs) / 60000;
}

function laWallClockToUtcISO(year, month, day, hour, minute, second = 0) {
  const guessUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = laOffsetMinutes(guessUtc);
  return new Date(guessUtc - offset * 60000).toISOString();
}

function parseCalEprocureDate(raw) {
  if (!raw) return { iso: null, hadTime: false, sentinel: null };
  const text = collapseWs(String(raw).replace(/\bPST\b|\bPDT\b/gi, ''))
    // Some PeopleSoft cells concatenate date and time, e.g.
    // "07/21/20265:00PM PDT". Repair only that exact safe shape.
    .replace(/^(\d{1,2}\/\d{1,2}\/\d{4})(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)$/i, '$1 $2')
    .trim();
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i);
  if (!match) return { iso: null, hadTime: false, sentinel: raw };

  let hour = match[4] ? Number(match[4]) : 12;
  const minute = match[5] ? Number(match[5]) : 0;
  const second = match[6] ? Number(match[6]) : 0;
  const ampm = match[7]?.toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;

  return {
    iso: laWallClockToUtcISO(Number(match[3]), Number(match[1]), Number(match[2]), hour, minute, second),
    hadTime: Boolean(match[4]),
    sentinel: null,
  };
}

function parseNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function canonicalDetailUrl(businessUnit, eventId) {
  if (!businessUnit || !eventId) return null;
  return `https://caleprocure.ca.gov/event/${encodeURIComponent(businessUnit)}/${encodeURIComponent(eventId)}`;
}

function stableAttachmentSourceKey(eventId, index, fileName) {
  return `caleprocure://event/${encodeURIComponent(eventId || 'unknown')}/attachment/${index}/${normalizeKeyPart(fileName)}`;
}

function documentFamilyFor(fileName, description = '') {
  const value = `${fileName ?? ''} ${description ?? ''}`.toLowerCase();
  if (/addend/.test(value)) return 'addenda';
  if (/plan|drawing/.test(value)) return 'plans';
  if (/spec/.test(value)) return 'specifications';
  if (/rate\s*sheet|wage/.test(value)) return 'wage_rates';
  if (/bid\s*package|invitation\s*for\s*bid|ifb|solicitation/.test(value)) return 'source_documents';
  return 'source_documents';
}

function documentClassFor(fileName, description = '') {
  const value = `${fileName ?? ''} ${description ?? ''}`.toLowerCase();
  if (/addend/.test(value)) return 'addendum';
  if (/plan|drawing/.test(value)) return 'plans';
  if (/spec/.test(value)) return 'specifications';
  if (/rate\s*sheet|wage/.test(value)) return 'wage_rates';
  if (/bid\s*package|invitation\s*for\s*bid|ifb|solicitation/.test(value)) return 'source_document';
  return 'source_document';
}

function normalizePackageDocuments({ eventId, attachments }) {
  return (attachments ?? []).map((attachment, idx) => {
    const sourceOrder = attachment.source_order ?? idx + 1;
    const fileName = sanitizeFileName(attachment.file_name || attachment.filename || `document-${sourceOrder}`);
    const description = collapseWs(attachment.description || attachment.title || '');
    const fileType = inferFileType(fileName);
    const addendumNumberRaw = description.match(/addendum\s*#?\s*(\d+)/i)?.[1]
      ?? fileName.match(/addendum[_\s-]*(\d+)/i)?.[1]
      ?? null;
    const addendumNumber = addendumNumberRaw ? Number(addendumNumberRaw) : null;
    return {
      source_key: attachment.source_key || stableAttachmentSourceKey(eventId, sourceOrder, fileName),
      title: fileName,
      file_name: fileName,
      filename: fileName,
      description: description || null,
      file_extension: fileType,
      file_type: fileType,
      document_family: documentFamilyFor(fileName, description),
      document_class: documentClassFor(fileName, description),
      source_order: sourceOrder,
      document_source_order: sourceOrder,
      addendum_number: addendumNumber,
      is_addendum: Boolean(addendumNumber) || /addend/i.test(`${fileName} ${description}`),
      download_control_id: attachment.download_control_id ?? null,
      row_html_snippet: attachment.row_html_snippet ?? null,
    };
  });
}

function parseCanonicalDetailUrl(rawUrl, eventId = null) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl, 'https://caleprocure.ca.gov');
    const match = url.pathname.match(/\/event\/([^/]+)\/([^/?#]+)/i);
    if (match) {
      return {
        businessUnit: decodeURIComponent(match[1]),
        eventId: decodeURIComponent(match[2]),
        sourceUrl: canonicalDetailUrl(decodeURIComponent(match[1]), decodeURIComponent(match[2])),
      };
    }
  } catch {
    // Fall through to regex extraction from onclick/html snippets.
  }

  const directLink = String(rawUrl).match(/directLinkEventUrl\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/i);
  if (directLink) {
    return {
      businessUnit: directLink[1],
      eventId: directLink[2],
      sourceUrl: canonicalDetailUrl(directLink[1], directLink[2]),
    };
  }

  const eventPath = String(rawUrl).match(/\/event\/([^/'"#\s]+)\/([^/'"#\s]+)/i);
  if (eventPath) {
    return {
      businessUnit: decodeURIComponent(eventPath[1]),
      eventId: decodeURIComponent(eventPath[2]),
      sourceUrl: canonicalDetailUrl(decodeURIComponent(eventPath[1]), decodeURIComponent(eventPath[2])),
    };
  }

  if (eventId) {
    const businessUnit = String(rawUrl).match(/\b(?:BUSINESS_UNIT|businessUnit|business_unit)\W+([0-9]{3,6})\b/i)?.[1] ?? null;
    if (businessUnit) {
      return { businessUnit, eventId, sourceUrl: canonicalDetailUrl(businessUnit, eventId) };
    }
  }

  return null;
}

async function openBrowser(log) {
  if (process.env.BROWSERBASE_API_KEY) {
    return { ...(await connectBrowserbaseSession(log)), transport: 'browserbase' };
  }

  if (process.env.CALEPROCURE_ALLOW_LOCAL_PLAYWRIGHT !== 'true') {
    throw new Error('BROWSERBASE_API_KEY not configured. Cal eProcure blocks local headless Playwright with HTTP 403; run this driver through Browserbase.');
  }

  const executablePath = process.env.CALEPROCURE_CHROME_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();
  return { browser, context, page, sessionId: null, transport: 'local_playwright' };
}

async function waitForSearchRows(page, timeout = 60000) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const renderedRows = Array.from(document.querySelectorAll(
      '#datatable-ready [data-if-label="tblBodyTr"], [data-if-label="tblBodyTr"]'
    )).filter((row) => visible(row) && /\S/.test(row.innerText ?? ''));
    const psRows = Array.from(document.querySelectorAll(
      'tr[id^="trRESP_INQA_HD_VW_GR$0_row"], tr[id^="trRESP_INQA_HD_VW$0_row"]'
    )).filter((row) => visible(row) && /\S/.test(row.innerText ?? ''));
    const pagerText = document.body?.innerText?.match(/Showing Results\s+\d+\s*-\s*\d+\s+of\s+\d+/i);
    return renderedRows.length > 0 || psRows.length > 0 || Boolean(pagerText);
  }, { timeout });
  await page.waitForTimeout(1500);
}

async function waitForSearchShell(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => {
    return Boolean(
      document.querySelector('#searchForm')
      || document.querySelector('#RESP_INQA_WK_INQ_AUC_GO_PB')
      || /Event Search/i.test(document.body?.innerText ?? '')
    );
  }, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function clickSearch(page, log) {
  const selectors = [
    '#RESP_INQA_WK_INQ_AUC_GO_PB',
    '[data-if-source*="RESP_INQA_WK_INQ_AUC_GO_PB"]',
  ];

  for (const selector of selectors) {
    const control = page.locator(selector).first();
    if (await control.count().catch(() => 0)) {
      await control.click({ timeout: 10000 });
      log(`Cal eProcure Search clicked via ${selector}`);
      return true;
    }
  }

  const textButton = page.getByRole('button', { name: /^Search$/i }).first();
  if (await textButton.count().catch(() => 0)) {
    await textButton.click({ timeout: 10000 });
    log('Cal eProcure Search clicked via role=button');
    return true;
  }

  const textLink = page.getByText(/^Search$/i).first();
  if (await textLink.count().catch(() => 0)) {
    await textLink.click({ timeout: 10000 });
    log('Cal eProcure Search clicked via visible text');
    return true;
  }

  log('Cal eProcure Search control not found');
  return false;
}

async function captureSearchDiagnostics(page, stage, log) {
  const diagnostics = await page.evaluate((stageLabel) => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const resultTable =
      document.querySelector('#datatable-ready')
      || document.querySelector('[data-if-label="tbl"]')
      || document.querySelector('table');
    return {
      stage: stageLabel,
      title: document.title || null,
      url: window.location.href,
      body_preview: clean(document.body?.innerText ?? '').slice(0, 1200),
      iframe_count: document.querySelectorAll('iframe').length,
      datatable_ready_rows: document.querySelectorAll('#datatable-ready [data-if-label="tblBodyTr"]').length,
      template_rows: document.querySelectorAll('[data-if-label="tblBodyTr"]').length,
      peoplesoft_rows: document.querySelectorAll('tr[id^="trRESP_INQA_HD_VW_GR$0_row"], tr[id^="trRESP_INQA_HD_VW$0_row"]').length,
      event_id_cells: document.querySelectorAll('[data-if-label="tdEventId"], a[id^="AUC_ID_COL$"], a[id^="AUC_ID_BUS_UNIT$"]').length,
      pager_text: clean(document.body?.innerText ?? '').match(/Showing Results\s+\d+\s*-\s*\d+\s+of\s+\d+/i)?.[0] ?? null,
      result_html_preview: resultTable?.outerHTML?.slice(0, 1500) ?? null,
    };
  }, stage);

  log(`Cal eProcure diagnostics ${stage}: ${JSON.stringify(diagnostics)}`);
  return diagnostics;
}

async function collectListingRows(page, log) {
  const rows = await page.evaluate(() => {
    const text = (el) => (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    const readCell = (row, label, selectors = []) => {
      const byLabel = row.querySelector(`[data-if-label="${label}"]`);
      const labelText = text(byLabel);
      if (labelText) return labelText;
      for (const selector of selectors) {
        const value = text(row.querySelector(selector));
        if (value) return value;
      }
      return '';
    };
    const collectAnchors = (row) => Array.from(row?.querySelectorAll('a[href], button, [onclick]') ?? []).map((el) => ({
      text: text(el),
      id: el.id || null,
      name: el.getAttribute('name') || null,
      href: el.href || el.getAttribute('href') || null,
      onclick: el.getAttribute('onclick') || null,
      html: el.outerHTML || null,
    }));
    const result = [];
    const seen = new Set();

    const renderedRows = Array.from(document.querySelectorAll(
      '#datatable-ready [data-if-label="tblBodyTr"], [data-if-label="tblBodyTr"]'
    )).filter((row) => visible(row) && /\S/.test(text(row)));

    for (const row of renderedRows) {
      const eventCell = row.querySelector('[data-if-label="tdEventId"], a[id^="AUC_ID_COL$"], a[id^="AUC_ID_BUS_UNIT$"]');
      const eventId = text(eventCell);
      if (!eventId || /\[Event ID\]/i.test(eventId) || seen.has(`rendered:${eventId}`)) continue;
      seen.add(`rendered:${eventId}`);

      const publishedDateRaw = readCell(row, 'tdPubDate', ['[id^="AUC_DTTM_FINISH_FR$"]']);
      const endDateRaw = readCell(row, 'tdEndDate', ['[id^="RESP_INQA1_WK_AUC_DTTM_FINISH$"]', '[id^="RESP_INQA_HD_VW_AUC_DTTM_FINISH$"]']);
      const rowHtml = row.outerHTML ?? '';
      result.push({
        eventId,
        title: readCell(row, 'tdEventName', ['[id^="RESP_INQA1_WK_ZZ_AUC_NAME$"]', '[id^="RESP_INQA_HD_VW_ZZ_AUC_NAME$"]']),
        department: readCell(row, 'tdDepName', ['[id^="BUS_UNIT_TBL_FS_DESCR$"]']),
        publishedDateRaw,
        endDateRaw,
        status: readCell(row, 'tdStatus', ['[id^="ZZ_DERIVED_DESCR"]']),
        rowText: text(row),
        rowHtml,
        eventCellId: eventCell?.id || null,
        anchors: collectAnchors(row),
      });
    }

    if (result.length > 0) return result;

    for (const row of document.querySelectorAll('tr[id^="trRESP_INQA_HD_VW_GR$0_row"], tr[id^="trRESP_INQA_HD_VW$0_row"]')) {
      const eventCell = row.querySelector('a[id^="AUC_ID_COL$"], a[id^="AUC_ID_BUS_UNIT$"], [data-if-label="tdEventId"]');
      const eventId = text(eventCell);
      if (!eventId || seen.has(`ps:${eventId}`)) continue;
      seen.add(`ps:${eventId}`);

      const rowHtml = row?.outerHTML ?? '';
      const rowText = text(row);

      result.push({
        eventId,
        title: readCell(row, 'tdEventName', ['[id^="RESP_INQA1_WK_ZZ_AUC_NAME$"]', '[id^="RESP_INQA_HD_VW_ZZ_AUC_NAME$"]']),
        department: readCell(row, 'tdDepName', ['[id^="BUS_UNIT_TBL_FS_DESCR$"]']),
        publishedDateRaw: readCell(row, 'tdPubDate', ['[id^="AUC_DTTM_FINISH_FR$"]']),
        endDateRaw: readCell(row, 'tdEndDate', ['[id^="RESP_INQA1_WK_AUC_DTTM_FINISH$"]', '[id^="RESP_INQA_HD_VW_AUC_DTTM_FINISH$"]']),
        status: readCell(row, 'tdStatus', ['[id^="ZZ_DERIVED_DESCR"]']),
        rowText,
        rowHtml,
        eventCellId: eventCell?.id || null,
        anchors: collectAnchors(row),
      });
    }

    if (result.length > 0) return result;

    // Fallback for the visually-rendered table if PeopleSoft IDs change.
    const eventPattern = /^[A-Z0-9]{2,}(?:-[A-Z0-9]+)?$/;
    for (const row of document.querySelectorAll('tr')) {
      const cells = Array.from(row.querySelectorAll('td')).map(text);
      if (cells.length < 4 || !eventPattern.test(cells[0])) continue;
      result.push({
        eventId: cells[0],
        title: cells[1] ?? '',
        department: cells[2] ?? '',
        publishedDateRaw: null,
        endDateRaw: cells.find((c) => /\d{2}\/\d{2}\/\d{4}/.test(c)) ?? null,
        status: cells.find((c) => /Posted|Open|Closed|Awarded/i.test(c)) ?? null,
        rowText: text(row),
        rowHtml: row.outerHTML,
        eventCellId: row.querySelector('a[href], button, [onclick], td')?.id || null,
        anchors: collectAnchors(row),
      });
    }

    return result;
  });

  log(`Cal eProcure listing rows observed: ${rows.length}`);
  return rows;
}

function resolveRowDetailTarget(row) {
  for (const anchor of row.anchors ?? []) {
    const parsed = parseCanonicalDetailUrl(anchor.href, row.eventId)
      ?? parseCanonicalDetailUrl(anchor.onclick, row.eventId)
      ?? parseCanonicalDetailUrl(anchor.html, row.eventId);
    if (parsed) return parsed;
  }

  const parsed = parseCanonicalDetailUrl(row.rowHtml, row.eventId);
  return parsed;
}

function attrSelector(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isClosedContextError(error) {
  return /Target page, context or browser has been closed|Browser has been closed|context has been closed|page has been closed/i.test(error?.message ?? String(error ?? ''));
}

function makeClosedContextError(message) {
  const error = new Error(message);
  error.code = 'CALEPROCURE_CONTEXT_CLOSED';
  return error;
}

function isClosedContextAbort(error) {
  return error?.code === 'CALEPROCURE_CONTEXT_CLOSED' || isClosedContextError(error);
}

async function pageIsUsable(page) {
  try {
    if (!page || page.isClosed()) return false;
    const context = page.context();
    return context.pages().some((candidate) => candidate === page && !candidate.isClosed());
  } catch {
    return false;
  }
}

async function hasListingRows(page) {
  if (!(await pageIsUsable(page))) return false;
  return page.evaluate(() => {
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    return Array.from(document.querySelectorAll(
      '#datatable-ready [data-if-label="tblBodyTr"], [data-if-label="tblBodyTr"], tr[id^="trRESP_INQA_HD_VW_GR$0_row"], tr[id^="trRESP_INQA_HD_VW$0_row"]'
    )).some((row) => visible(row) && /\S/.test(row.innerText ?? ''));
  }).catch(() => false);
}

async function logFailedRowDiagnostics(page, row, reason, log) {
  const pageState = await page.evaluate((eventId) => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const summarize = (el) => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name'),
        href: el.getAttribute('href'),
        role: el.getAttribute('role'),
        onclick: el.getAttribute('onclick'),
        data_if_label: el.getAttribute('data-if-label'),
        data_if_ps_clickable: el.getAttribute('data-if-ps-clickable'),
        text: clean(el.innerText || el.textContent).slice(0, 200),
        visible: visible(el),
        box: rect.width || rect.height ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        } : null,
        html: el.outerHTML.slice(0, 500),
      };
    };
    const candidates = Array.from(document.querySelectorAll(
      'a, button, [role="button"], [onclick], [data-if-ps-clickable="true"], td, span, div'
    )).filter((el) => clean(el.innerText || el.textContent).includes(eventId));
    const summaries = candidates.slice(0, 20).map(summarize);
    return {
      title: document.title || null,
      url: window.location.href,
      visible_candidate_targets: summaries.filter((item) => item.visible).slice(0, 10),
      hidden_candidate_targets: summaries.filter((item) => !item.visible).slice(0, 10),
    };
  }, row.eventId ?? '').catch(() => ({
    title: null,
    url: page.url(),
    visible_candidate_targets: [],
    hidden_candidate_targets: [],
  }));

  log(`Cal eProcure first failed detail row diagnostics: ${JSON.stringify({
    reason,
    event_id: row.eventId ?? null,
    title: row.title ?? null,
    eventCellId: row.eventCellId ?? null,
    visible_candidate_targets: pageState.visible_candidate_targets,
    hidden_candidate_targets: pageState.hidden_candidate_targets,
    anchors: (row.anchors ?? []).slice(0, 10).map((anchor) => ({
      id: anchor.id ?? null,
      name: anchor.name ?? null,
      href: anchor.href ?? null,
      onclick: anchor.onclick ?? null,
      text: anchor.text ?? null,
    })),
    row_text: row.rowText ?? null,
    row_html_snippet: (row.rowHtml ?? '').slice(0, 1000),
    page_url: pageState.url,
    page_title: pageState.title,
  })}`);
}

async function waitForRecognizableDetail(page, eventId) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction((expectedEventId) => {
    const url = window.location.href;
    const bodyText = document.body?.innerText ?? '';
    return /\/event\/[^/]+\/[^/?#]+/i.test(url)
      || Boolean(document.querySelector('[data-if-label="eventName"], #RESP_AUC_H0B_WK_AUC_ID_BUS_UNIT'))
      || /Event\s*:|Details|Published Date|Event End Date|Dept:/i.test(bodyText)
      || Boolean(expectedEventId && bodyText.includes(expectedEventId));
  }, eventId ?? null, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function locateListingRowClickTargets(page, row) {
  if (!(await pageIsUsable(page))) throw makeClosedContextError(`Cal eProcure listing page is closed before locating ${row.eventId ?? 'unknown event'}`);
  const tokenPrefix = `bidbox-cale-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const descriptors = await page.evaluate(({ eventId, title, eventCellId, tokenPrefix: prefix }) => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') !== 0
        && rect.width > 0
        && rect.height > 0;
    };
    const box = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width || rect.height ? {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } : null;
    };
    const clickableish = (el) => {
      if (!el) return false;
      const tag = el.tagName.toLowerCase();
      return tag === 'a'
        || tag === 'button'
        || el.getAttribute('role') === 'button'
        || el.hasAttribute('onclick')
        || el.getAttribute('data-if-ps-clickable') === 'true'
        || window.getComputedStyle(el).cursor === 'pointer';
    };
    const rows = Array.from(document.querySelectorAll(
      '#datatable-ready [data-if-label="tblBodyTr"], [data-if-label="tblBodyTr"], tr, [role="row"]'
    )).filter((el) => clean(el.innerText || el.textContent).includes(eventId));
    const rowWithTitle = rows.find((el) => visible(el) && title && clean(el.innerText || el.textContent).includes(title))
      || rows.find((el) => visible(el))
      || rows.find((el) => title && clean(el.innerText || el.textContent).includes(title))
      || rows[0]
      || document;
    if (rowWithTitle !== document) {
      rowWithTitle.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    const raw = [];
    const add = (el, label, score) => {
      if (!el || raw.includes(el)) return;
      const text = clean(el.innerText || el.textContent);
      if (!text.includes(eventId) && !(title && text.includes(title))) return;
      raw.push(el);
      el.setAttribute('data-bidbox-cale-target', `${prefix}-${raw.length}`);
      const rect = box(el);
      candidates.push({
        label,
        token: el.getAttribute('data-bidbox-cale-target'),
        visible: visible(el),
        score,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        role: el.getAttribute('role'),
        href: el.getAttribute('href'),
        onclick: el.getAttribute('onclick'),
        data_if_label: el.getAttribute('data-if-label'),
        data_if_ps_clickable: el.getAttribute('data-if-ps-clickable'),
        text: text.slice(0, 200),
        box: rect,
        html: el.outerHTML.slice(0, 500),
      });
    };
    const candidates = [];

    if (eventCellId) {
      const byId = document.getElementById(eventCellId);
      if (byId) add(byId, `eventCellId:${eventCellId}`, 10);
    }

    const exactTextNodes = Array.from(rowWithTitle.querySelectorAll('a, button, [role="button"], [onclick], [data-if-ps-clickable="true"], td, span, div'))
      .filter((el) => clean(el.innerText || el.textContent) === eventId);
    for (const el of exactTextNodes) {
      add(el, 'exact-event-id-text', 100);
      let parent = el.parentElement;
      for (let depth = 0; parent && depth < 4; depth += 1, parent = parent.parentElement) {
        if (clickableish(parent)) add(parent, `exact-event-id-clickable-ancestor:${depth + 1}`, 95 - depth);
      }
    }

    for (const el of Array.from(rowWithTitle.querySelectorAll('a, button, [role="button"], [onclick], [data-if-ps-clickable="true"]'))) {
      const text = clean(el.innerText || el.textContent);
      if (text.includes(eventId)) add(el, 'visible-clickable-event-id', 90);
      if (title && text.includes(title)) add(el, 'visible-clickable-title', 80);
    }

    for (const el of Array.from(rowWithTitle.querySelectorAll('td, span, div')).filter(visible)) {
      const text = clean(el.innerText || el.textContent);
      if (text === eventId) add(el, 'visible-event-id-cell', 70);
      if (title && text === title) add(el, 'visible-title-cell', 60);
    }

    const globalExactEventNodes = Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], [data-if-ps-clickable="true"], td, span, div'))
      .filter((el) => visible(el) && clean(el.innerText || el.textContent) === eventId);
    for (const el of globalExactEventNodes) {
      add(el, 'global-visible-event-id-text', 88);
      let parent = el.parentElement;
      for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
        if (visible(parent) && clickableish(parent)) add(parent, `global-visible-clickable-ancestor:${depth + 1}`, 86 - depth);
      }
    }

    const globalTitleNodes = title
      ? Array.from(document.querySelectorAll('a, button, [role="button"], [onclick], [data-if-ps-clickable="true"], td, span, div'))
        .filter((el) => visible(el) && clean(el.innerText || el.textContent) === title)
      : [];
    for (const el of globalTitleNodes) {
      add(el, 'global-visible-title-text', 65);
      let parent = el.parentElement;
      for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
        if (visible(parent) && clickableish(parent)) add(parent, `global-visible-title-clickable-ancestor:${depth + 1}`, 63 - depth);
      }
    }

    return candidates
      .sort((a, b) => Number(b.visible) - Number(a.visible) || b.score - a.score)
      .slice(0, 12);
  }, {
    eventId: row.eventId ?? '',
    title: row.title ?? '',
    eventCellId: row.eventCellId ?? '',
    tokenPrefix,
  }).catch(() => []);

  return descriptors.map((descriptor) => ({
    descriptor,
    locator: page.locator(`[data-bidbox-cale-target="${attrSelector(descriptor.token)}"]`).first(),
  }));
}

async function clickRowAndCaptureDetail(page, row, log) {
  let clickTargets = await locateListingRowClickTargets(page, row);
  if (clickTargets.length === 0) {
    await page.waitForTimeout(500).catch(() => {});
    clickTargets = await locateListingRowClickTargets(page, row);
  }
  let lastError = null;
  const attempted = [];

  for (const target of clickTargets) {
    try {
      if (!(await pageIsUsable(page))) throw makeClosedContextError(`Cal eProcure listing page closed before clicking ${row.eventId ?? 'unknown event'}`);
      const context = page.context();
      const pagesBefore = new Set(context.pages());
      attempted.push({
        label: target.descriptor.label,
        visible: target.descriptor.visible,
        id: target.descriptor.id,
        tag: target.descriptor.tag,
      });
      const popupPromise = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
      const newPagePromise = context.waitForEvent('page', { timeout: 1500 }).catch(() => null);
      if (target.descriptor.visible) {
        await target.locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
        await target.locator.click({ timeout: 15000 });
      } else {
        await target.locator.evaluate((el) => {
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.click();
        }, undefined, { timeout: 15000 });
      }
      const popup = await popupPromise;
      const newPage = await newPagePromise;
      const openedPage = popup || (newPage && !pagesBefore.has(newPage) ? newPage : null);
      if (page.isClosed() && !openedPage) {
        throw makeClosedContextError(`Cal eProcure click closed the listing page for ${row.eventId ?? 'unknown event'}`);
      }

      const detailPage = openedPage || page;
      await waitForRecognizableDetail(detailPage, row.eventId);
      const finalUrl = detailPage.url();
      const parsed = parseCanonicalDetailUrl(finalUrl, row.eventId);
      const detail = await extractDetailMetadata(detailPage);

      if (openedPage && openedPage !== page) {
        await openedPage.close().catch(() => {});
      }

      return {
        target: parsed ?? {
          businessUnit: null,
          eventId: row.eventId,
          sourceUrl: finalUrl,
        },
        detail,
        method: `click:${target.descriptor.label}`,
      };
    } catch (e) {
      lastError = e;
      if (isClosedContextAbort(e)) throw e;
    }
  }

  throw new Error(`No click target navigated to detail for ${row.eventId ?? 'unknown event'}; attempted=${JSON.stringify(attempted).slice(0, 800)}${lastError ? `; last=${lastError.message}` : ''}`);
}

async function restoreListingPage(page, listingUrl, log) {
  if (!(await pageIsUsable(page))) {
    throw makeClosedContextError('Cal eProcure listing page closed before restore');
  }
  if (await hasListingRows(page)) return;

  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
    if (isClosedContextAbort(e)) throw e;
    log(`Cal eProcure goBack after detail failed: ${e.message}`);
  });

  if (!(await pageIsUsable(page))) {
    throw makeClosedContextError('Cal eProcure listing page closed during restore');
  }
  if (await hasListingRows(page)) return;

  log('Cal eProcure listing table not restored after detail; reloading listing and rerunning Search');
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForSearchShell(page);
  await clickSearch(page, log).catch((e) => {
    log(`Cal eProcure Search click during listing restore failed: ${e.message}`);
  });
  await waitForSearchRows(page, 60000).catch((e) => {
    log(`Cal eProcure listing restore row wait failed: ${e.message}`);
  });
}

async function extractDetailMetadata(page) {
  return page.evaluate(() => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim() || null;
    const text = (el) => clean(el?.innerText || el?.textContent || '');
    const byId = (...ids) => {
      for (const id of ids) {
        const value = text(document.getElementById(id));
        if (value) return value;
      }
      return null;
    };
    const byPrefix = (prefix) => {
      const value = text(document.querySelector(`[id^="${CSS.escape(prefix)}"]`));
      return value || null;
    };
    const allByPrefix = (prefix) => Array.from(document.querySelectorAll(`[id^="${CSS.escape(prefix)}"]`))
      .map(text)
      .filter(Boolean);
    const labeled = {};
    for (const node of document.querySelectorAll('[data-if-label]')) {
      const label = node.getAttribute('data-if-label');
      const value = text(node);
      if (label && value && !labeled[label]) labeled[label] = value;
    }

    const bodyText = text(document.body) || '';
    const h1 = text(document.querySelector('h1'));
    const eventHeader = bodyText.match(/\bEvent\s*:\s*([A-Z0-9-]+)/i)?.[1] ?? null;
    const email = bodyText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
    const sectionBetween = (startLabel, endLabels) => {
      const start = bodyText.search(new RegExp(`${startLabel}\\s*:`, 'i'));
      if (start < 0) return null;
      const afterStart = bodyText.slice(start).replace(new RegExp(`^${startLabel}\\s*:\\s*`, 'i'), '');
      const endPositions = endLabels
        .map((label) => afterStart.search(new RegExp(`\\b${label}\\b`, 'i')))
        .filter((idx) => idx > 20);
      const end = endPositions.length ? Math.min(...endPositions) : Math.min(afterStart.length, 4000);
      return clean(afterStart.slice(0, end));
    };

    const rowsFromTable = (rowPrefix, fields) => {
      return Array.from(document.querySelectorAll(`[id^="${CSS.escape(rowPrefix)}"]`)).map((row) => {
        const out = {};
        for (const [key, prefix] of Object.entries(fields)) {
          out[key] = text(row.querySelector(`[id^="${CSS.escape(prefix)}"]`));
        }
        return out;
      }).filter((row) => Object.values(row).some(Boolean));
    };

    const unspsc = rowsFromTable('trZZ_UNSPSC_CD_VW2$', {
      code: 'ZZ_CATGRY_CD_VW_CATEGORY_CD$',
      description: 'ZZ_CAT_DSCR_VW_DESCR254',
    });
    const licenses = rowsFromTable('trZZ_UNSPSC_CD_VW$', {
      code: 'ZZ_LICENS_CD_VW_LICENSE_CODE$',
      description: 'ZZ_CLS_CD_VW_DESCR254$',
    });
    const serviceAreas = rowsFromTable('trZZ_AUC_SA_TBL$', {
      id: 'ZZ_AUC_SA_TBL_ZZ_SRVC_AREA_ID$',
      county: 'ZZ_SA_VW_COUNTY$',
    });

    const descriptionById = byId('AUC_HDR_DESCRLONG');
    const descriptionFromBody = sectionBetween('Description', [
      'Purpose and Description of Services',
      'Contact Information',
      'Pre Bid Conference',
      'UNSPSC',
      'Contractor License',
      'Service Area',
    ]);
    const purposeSection = sectionBetween('Purpose and Description of Services', [
      'Contact Information',
      'Pre Bid Conference',
      'UNSPSC',
      'Contractor License',
      'Service Area',
    ]);
    const combinedDescription = [
      descriptionById,
      descriptionFromBody && descriptionFromBody !== descriptionById ? descriptionFromBody : null,
      purposeSection,
    ].filter(Boolean).join('\n\n') || null;

    return {
      pageTitle: document.title || null,
      url: window.location.href,
      rootContainers: {
        main: Boolean(document.querySelector('#main')),
        eventName: Boolean(document.querySelector('[data-if-label="eventName"]')),
        unspscTable: Boolean(document.querySelector('#unspscTable')),
        contractorTable: Boolean(document.querySelector('#contractorTable')),
        serviceAreaTable: Boolean(document.querySelector('#serviceAreaTable')),
      },
      eventId: byId('RESP_AUC_H0B_WK_AUC_ID_BUS_UNIT') || eventHeader,
      title: labeled.eventName || h1,
      department: byId('SP_BU_GL_CLSVW_DESCR', 'BUS_UNIT_TBL_FS_DESCR'),
      formatType: [
        byId('RESP_AUC_H0B_WK_AUC_FORMAT_BIDBER'),
        byId('AUC_HDR_AUC_TYPE'),
      ].filter(Boolean).join(' / ') || null,
      eventVersion: byId('AUC_HDR_AUC_VERSION'),
      publishedDateRaw: byId('AUC_HDR_AUC_DTTM_START'),
      endDateRaw: byId('AUC_HDR_AUC_DTTM_FINISH') || byPrefix('AUC_HDR_AUC_DTTM_FINISH'),
      description: combinedDescription,
      descriptionRaw: descriptionById,
      purposeAndDescription: purposeSection,
      contactName: byId('AUC_HDR_NAME1'),
      contactPhone: byId('AUC_HDR_PHONE'),
      contactEmail: byId('RESP_INQ_DL0_WK_EMAILID') || email,
      preBid: {
        mandatory: byId('ZZ_BID_CNF_VW_COMMENT1$0'),
        date: byId('ZZ_BID_CNF_VW_DATE1$0'),
        time: byId('ZZ_BID_CNF_VW_DUE_DT_TIME$0'),
        location: byId('ZZ_BID_CNF_VW_DESCR254_1$0'),
        comments: byId('ZZ_BID_CNF_VW_DESCR254_MIXED$0'),
        raw: allByPrefix('ZZ_BID_CNF_VW_'),
      },
      unspsc,
      licenses,
      serviceAreas,
      bodyTextPreview: bodyText.slice(0, 2000),
      bodyTextForExtraction: bodyText.slice(0, 12000),
    };
  });
}

async function waitForDetail(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => {
    const bodyText = document.body?.innerText ?? '';
    return /Event\s*:|Details|Published Date|Event End Date|Dept:/i.test(bodyText)
      || Boolean(document.querySelector('[data-if-label="eventName"], #RESP_AUC_H0B_WK_AUC_ID_BUS_UNIT'));
  }, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

function caleprocureCredentials() {
  return {
    username: process.env.CALEPROCURE_USERNAME
      || process.env.CALEPROCURE_USER
      || process.env.CALEPROCURE_EMAIL
      || null,
    password: process.env.CALEPROCURE_PASSWORD || null,
  };
}

async function isCalEprocureLoginPage(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    return Boolean(document.querySelector('input[type="password"]'))
      || /sign\s*in|login|user\s*id|password/i.test(text);
  }).catch(() => false);
}

async function caleprocureLogin(page, log = console.log) {
  if (!(await isCalEprocureLoginPage(page))) return false;

  const { username, password } = caleprocureCredentials();
  if (!username || !password) {
    const error = new Error('missing_caleprocure_credentials');
    error.code = 'missing_caleprocure_credentials';
    throw error;
  }

  log('Cal eProcure login required; signing in with configured credentials');
  const usernameSelectors = [
    'input[type="email"]',
    'input[name*="USER" i]',
    'input[id*="USER" i]',
    'input[name*="LOGIN" i]',
    'input[id*="LOGIN" i]',
    'input[type="text"]',
  ];
  let filledUsername = false;
  for (const selector of usernameSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count().catch(() => 0)) {
      await locator.fill(username, { timeout: 10000 }).catch(() => {});
      filledUsername = true;
      break;
    }
  }

  const passwordLocator = page.locator('input[type="password"]').first();
  if (!(await passwordLocator.count().catch(() => 0))) {
    throw new Error('Cal eProcure login page did not expose a password input');
  }
  await passwordLocator.fill(password, { timeout: 10000 });

  if (!filledUsername) {
    throw new Error('Cal eProcure login page did not expose a username input');
  }

  const submit = page.getByRole('button', { name: /sign\s*in|log\s*in|login|submit/i }).first();
  if (await submit.count().catch(() => 0)) {
    await submit.click({ timeout: 10000 });
  } else {
    await passwordLocator.press('Enter');
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? '';
    return !document.querySelector('input[type="password"]')
      || /Event Details|Comments|View Attachments|Attached File|Event Package/i.test(text);
  }, { timeout: 60000 }).catch(() => {});

  if (await isCalEprocureLoginPage(page)) {
    throw new Error('Cal eProcure login did not complete');
  }

  return true;
}

async function openEventPackage(page, log = console.log) {
  const packageButton = page.getByText(/View Event Package/i).first();
  if (!(await packageButton.count().catch(() => 0))) {
    throw new Error('Cal eProcure Event Package button not found on detail page');
  }

  await packageButton.click({ timeout: 15000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 }).catch(() => {});
  if (await isCalEprocureLoginPage(page)) {
    await caleprocureLogin(page, log);
  }
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? '';
    return /Comments|View Attachments|Attached File|Download/i.test(text);
  }, { timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function extractEventPackage(page, eventIdHint = null) {
  const raw = await page.evaluate((eventIdFallback) => {
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const text = (el) => clean(el?.innerText || el?.textContent || el?.value || '');
    const bodyText = clean(document.body?.innerText ?? '');
    const eventId = bodyText.match(/\bEvent ID\s+([A-Z0-9-]+)/i)?.[1]
      || bodyText.match(/\bEvent\s*:\s*([A-Z0-9-]+)/i)?.[1]
      || eventIdFallback
      || null;
    const eventName = bodyText.match(/\bEvent Name\s+(.+?)(?:\s+Comments\b|\s+View Attachments\b|$)/i)?.[1]
      || null;

    const textarea = document.querySelector('textarea');
    let comments = text(textarea);
    if (!comments) {
      const match = bodyText.match(/\bComments\s+(.+?)\s+(?:View All\s+)?(?:1\s+of\s+\d+\s+)?View Attachments\b/i);
      comments = clean(match?.[1] || '');
    }

    const rows = Array.from(document.querySelectorAll('[id^="trAUC_ATTCH_HD_VW"]'));
    const attachments = rows.map((row, idx) => {
      const filename = text(row.querySelector('[id^="PV_ATTACH_WRK_ATTACHUSERFILE$"]'));
      const description = text(row.querySelector('span[id^="PV_ATTACH_WRK_ATTACH_DESCR$"], input[id^="PV_ATTACH_WRK_ATTACH_DESCR$"]'));
      const download = row.querySelector('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"], button, [role="button"], [onclick]');
      return {
        source_order: idx + 1,
        file_name: filename,
        description,
        download_control_id: download?.id || null,
        has_download_control: Boolean(download),
        row_html_snippet: row.outerHTML?.slice(0, 1200) ?? null,
      };
    }).filter((row) => row.file_name || row.description || row.has_download_control);

    return {
      url: window.location.href,
      pageTitle: document.title || null,
      eventId,
      eventName,
      comments: comments || null,
      attachments,
      bodyTextPreview: bodyText.slice(0, 2000),
    };
  }, eventIdHint);

  const eventId = raw.eventId || eventIdHint;
  const documents = normalizePackageDocuments({ eventId, attachments: raw.attachments });
  return {
    ...raw,
    eventId,
    documents,
    attachment_count: documents.length,
    extracted_at: new Date().toISOString(),
  };
}

function buildCandidateFromDetail({ listingUrl, row, target, detail, packageDiagnostics = null }) {
  const eventId = detail.eventId || row.eventId || target.eventId;
  const title = detail.title || row.title || eventId;
  const department = detail.department || row.department || null;
  const due = parseCalEprocureDate(detail.endDateRaw || row.endDateRaw);
  const published = parseCalEprocureDate(detail.publishedDateRaw || row.publishedDateRaw);
  const licenseCodes = uniq((detail.licenses ?? []).map((l) => l.code));
  const counties = uniq((detail.serviceAreas ?? []).map((area) => area.county));
  const richText = [detail.description, detail.purposeAndDescription, detail.bodyTextForExtraction].filter(Boolean).join('\n');
  const estimated = extractEstimatedValue(richText);
  const duration = extractContractDuration(richText);

  return {
    source_url: target.sourceUrl,
    raw_title: eventId && title && !title.startsWith(eventId) ? `${eventId} - ${title}` : title,
    agency: department,
    bid_due_at: due.iso,
    estimated_value: estimated.value,
    estimated_value_low: estimated.value,
    estimated_value_high: estimated.value,
    county: counties.join(', ') || null,
    project_address: null,
    required_licenses: licenseCodes.length > 0 ? licenseCodes : null,
    required_naics: null,
    portal_bid_id: eventId,
    portal_department: department,
    crawl_data: {
      source: 'caleprocure_events',
      listing_url: listingUrl,
      source_url: target.sourceUrl,
      event_id: eventId,
      business_unit: target.businessUnit,
      event_version: detail.eventVersion,
      title,
      department,
      agency: department,
      format_type: detail.formatType,
      listing_status: row.status || null,
      published_date_raw: detail.publishedDateRaw || row.publishedDateRaw || null,
      published_at: published.iso,
      bid_due_raw: detail.endDateRaw || row.endDateRaw || null,
      bid_due_time_available: due.hadTime,
      bid_due_note: due.iso ? null : due.sentinel,
      description: detail.description,
      estimated_value: estimated.value,
      estimated_value_raw: estimated.raw,
      contract_duration: duration.value,
      contract_duration_raw: duration.raw,
      contact: {
        name: detail.contactName,
        phone: detail.contactPhone,
        email: detail.contactEmail,
      },
      pre_bid: detail.preBid,
      unspsc: detail.unspsc ?? [],
      contractor_licenses: detail.licenses ?? [],
      service_areas: detail.serviceAreas ?? [],
      counties,
      package_diagnostics: packageDiagnostics,
      detail_diagnostics: {
        page_title: detail.pageTitle,
        final_url: detail.url,
        root_containers: detail.rootContainers,
      },
      extracted_at: new Date().toISOString(),
      extraction_method: 'caleprocure_v1_browser_detail',
      document_acquisition_supported: true,
      document_acquisition_note: 'Event Package documents are acquired only on explicit user intent; scan-time auto-prefetch remains disabled.',
    },
  };
}

async function capturePackageDownloadDiagnostics(page, sessionId, log) {
  const diagnostics = {
    attempted: true,
    package_url: null,
    attachments: [],
    download_protocol: null,
    error: null,
  };

  try {
    const packageButton = page.getByText(/View Event Package/i).first();
    await packageButton.click({ timeout: 10000 });
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    await page.waitForFunction(() => /View Attachments|Attached File|Download/i.test(document.body?.innerText ?? ''), { timeout: 30000 });
    await page.waitForTimeout(1000);
    diagnostics.package_url = page.url();
    diagnostics.attachments = await page.evaluate(() => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('[id^="trAUC_ATTCH_HD_VW"]')).map((row) => ({
        filename: clean(row.querySelector('[id^="PV_ATTACH_WRK_ATTACHUSERFILE$"]')?.textContent),
        description: clean(
          row.querySelector('span[id^="PV_ATTACH_WRK_ATTACH_DESCR$"]')?.textContent
          || row.querySelector('input[id^="PV_ATTACH_WRK_ATTACH_DESCR$"]')?.value
        ),
        has_download_control: Boolean(row.querySelector('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]')),
      })).filter((row) => row.filename || row.description || row.has_download_control);
    });

    if (!process.env.CALEPROCURE_CLICK_DOWNLOAD_DIAGNOSTIC) {
      diagnostics.download_protocol = 'not_clicked_set_CALEPROCURE_CLICK_DOWNLOAD_DIAGNOSTIC=true_to_probe';
      return diagnostics;
    }

    const downloadControl = page.locator('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]').first();
    const responseRecords = [];
    const onResponse = (res) => {
      const headers = res.headers();
      const contentDisposition = headers['content-disposition'] || '';
      const contentType = headers['content-type'] || '';
      if (/attachment|pdf|octet-stream|download/i.test(`${contentDisposition} ${contentType}`)) {
        responseRecords.push({
          url: res.url(),
          status: res.status(),
          content_type: contentType,
          content_disposition: contentDisposition,
        });
      }
    };
    page.on('response', onResponse);
    await downloadControl.click({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const readyButton = page.getByRole('button', { name: /Download Attachment/i }).first();
    const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
    const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
    await readyButton.click({ timeout: 15000 }).catch(() => {});
    const download = await downloadPromise;
    const popup = await popupPromise;
    page.off('response', onResponse);

    diagnostics.download_protocol = {
      playwright_download_event: Boolean(download),
      suggested_filename: download ? await download.suggestedFilename() : null,
      popup_opened: Boolean(popup),
      popup_url: popup ? popup.url() : null,
      response_records: responseRecords,
      browserbase_download_zip_available: sessionId ? 'probe_supported' : 'local_session',
    };

    if (sessionId && download) {
      const bytes = await fetchBrowserbaseDownloadZip(sessionId, log).catch(() => null);
      diagnostics.download_protocol.browserbase_download_bytes = bytes?.length ?? 0;
    }
  } catch (e) {
    diagnostics.error = e.message;
  }

  return diagnostics;
}

async function openListingSession({ listingUrl, sourceName, log, captureDiagnostics = false }) {
  const session = await openBrowser(log);
  const { page, transport } = session;
  log(`[${sourceName}] Opening Cal eProcure via ${transport}: ${listingUrl}`);

  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForSearchShell(page);
  if (captureDiagnostics) await captureSearchDiagnostics(page, 'after_load', log);

  await waitForSearchRows(page, 10000).catch((e) => {
    if (captureDiagnostics) log(`Cal eProcure initial row wait did not observe rendered rows: ${e.message}`);
  });

  let rows = await collectListingRows(page, log);
  if (rows.length === 0) {
    await clickSearch(page, log).catch((e) => {
      log(`Cal eProcure Search click failed: ${e.message}`);
      return false;
    });
    await waitForSearchRows(page, 60000).catch((e) => {
      log(`Cal eProcure post-search row wait did not observe rendered rows: ${e.message}`);
    });
    if (captureDiagnostics) await captureSearchDiagnostics(page, 'after_search', log);
    rows = await collectListingRows(page, log);
  }

  return { session, rows };
}

async function scrapeCalEprocure(source, log = console.log) {
  const listingUrl = source.listing_url || DEFAULT_LISTING_URL;
  const detailLimit = parseNumberEnv('CALEPROCURE_MAX_DETAILS', DEFAULT_DETAIL_LIMIT);
  const detailBatchSize = parseNumberEnv('CALEPROCURE_DETAIL_BATCH_SIZE', DEFAULT_DETAIL_BATCH_SIZE);
  const maxDetailSessions = parseNumberEnv('CALEPROCURE_MAX_DETAIL_SESSIONS', DEFAULT_MAX_DETAIL_SESSIONS);
  const maxConsecutiveFailures = parseNumberEnv('CALEPROCURE_MAX_CONSECUTIVE_DETAIL_FAILURES', DEFAULT_MAX_CONSECUTIVE_DETAIL_FAILURES);
  const sourceName = sourceLabel(source);
  const candidates = [];
  const errorMessages = [];
  let nonNavigationErrors = 0;
  const telemetry = {
    listing_rows_observed: 0,
    detail_navigation_attempted: 0,
    detail_navigation_static_success: 0,
    detail_navigation_click_success: 0,
    detail_navigation_failed: 0,
    detail_navigation_aborted_context_closed: false,
    detail_navigation_aborted_after_row: null,
    detail_navigation_remaining_skipped: 0,
    candidates_inserted: 0,
    detail_batches_attempted: 0,
    detail_sessions_started: 0,
    detail_sessions_restarted: 0,
    detail_context_deaths: 0,
    detail_rows_skipped_due_to_safety_limit: 0,
    detail_worklist_size: 0,
    detail_processed_event_ids: [],
    detail_failed_event_ids_sample: [],
  };
  let session;
  let page;
  let sessionId;

  const recordError = (message) => {
    nonNavigationErrors++;
    errorMessages.push(message);
    log(`[${sourceName}] ${message}`);
  };

  const closeCurrentSession = async () => {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
    session = null;
    page = null;
    sessionId = null;
  };

  const startListingSession = async ({ captureDiagnostics = false, restart = false } = {}) => {
    await closeCurrentSession();
    if (telemetry.detail_sessions_started >= maxDetailSessions) {
      throw new Error(`Cal eProcure max detail sessions reached (${maxDetailSessions})`);
    }
    const opened = await openListingSession({ listingUrl, sourceName, log, captureDiagnostics });
    session = opened.session;
    page = session.page;
    sessionId = session.sessionId;
    telemetry.detail_sessions_started++;
    if (restart) telemetry.detail_sessions_restarted++;
    return opened.rows;
  };

  try {
    let rows = await startListingSession({ captureDiagnostics: true });

    telemetry.listing_rows_observed = rows.length;
    const rowsToProcess = rows.slice(0, detailLimit).map((row, index) => ({
      ...row,
      rowIndex: index,
    }));
    telemetry.detail_worklist_size = rowsToProcess.length;
    let firstFailedRowLogged = false;
    let packageDiagnosticsCaptured = false;
    let consecutiveFailures = 0;
    let rowIndex = 0;

    while (rowIndex < rowsToProcess.length) {
      if (!page || !(await pageIsUsable(page))) {
        telemetry.detail_context_deaths++;
        telemetry.detail_navigation_aborted_context_closed = true;
        telemetry.detail_navigation_aborted_after_row = rowsToProcess[rowIndex]?.eventId ?? null;
        rows = await startListingSession({ restart: true });
        if (rows.length > 0) telemetry.listing_rows_observed = Math.max(telemetry.listing_rows_observed, rows.length);
      }

      telemetry.detail_batches_attempted++;
      const batchStartIndex = rowIndex;
      const batchEndIndex = Math.min(batchStartIndex + detailBatchSize, rowsToProcess.length);
      log(`[${sourceName}] Cal eProcure detail batch ${telemetry.detail_batches_attempted}: rows ${batchStartIndex + 1}-${batchEndIndex} of ${rowsToProcess.length}`);

      while (rowIndex < batchEndIndex) {
      const row = rowsToProcess[rowIndex];
      let shouldRestoreListing = false;
      if (!(await pageIsUsable(page))) {
        telemetry.detail_navigation_aborted_context_closed = true;
        telemetry.detail_navigation_aborted_after_row = row.eventId ?? null;
        telemetry.detail_context_deaths++;
        break;
      }
      telemetry.detail_navigation_attempted++;
      try {
        let target = resolveRowDetailTarget(row);
        let detail = null;
        let navigationMethod = 'static';

        if (target?.sourceUrl) {
          shouldRestoreListing = true;
          await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await waitForDetail(page);
          detail = await extractDetailMetadata(page);
          telemetry.detail_navigation_static_success++;
        } else {
          shouldRestoreListing = true;
          const clicked = await clickRowAndCaptureDetail(page, row, log);
          target = clicked.target;
          detail = clicked.detail;
          navigationMethod = clicked.method;
          telemetry.detail_navigation_click_success++;
        }

        let packageDiagnostics = null;

        if (!packageDiagnosticsCaptured && process.env.CALEPROCURE_CAPTURE_PACKAGE_DIAGNOSTICS === 'true') {
          packageDiagnostics = await capturePackageDownloadDiagnostics(page, sessionId, log);
          packageDiagnosticsCaptured = true;
        }

        const candidate = buildCandidateFromDetail({ listingUrl, row, target, detail, packageDiagnostics });
        candidate.crawl_data.detail_navigation_method = navigationMethod;
        if (!candidate.raw_title || !candidate.portal_bid_id) {
          throw new Error(`Metadata extraction incomplete for ${target.sourceUrl}: title=${candidate.raw_title || 'missing'} event_id=${candidate.portal_bid_id || 'missing'}`);
        }
        candidates.push(candidate);
        telemetry.candidates_inserted = candidates.length;
        telemetry.detail_processed_event_ids.push(candidate.portal_bid_id || row.eventId);
        consecutiveFailures = 0;
        log(`[${sourceName}] Parsed Cal eProcure event ${candidate.portal_bid_id}: ${candidate.raw_title}`);
      } catch (e) {
        telemetry.detail_navigation_failed++;
        consecutiveFailures++;
        if (row.eventId && telemetry.detail_failed_event_ids_sample.length < 25) {
          telemetry.detail_failed_event_ids_sample.push(row.eventId);
        }
        if (!firstFailedRowLogged) {
          await logFailedRowDiagnostics(page, row, `detail_navigation_failed:${e.message}`, log).catch(() => {});
          firstFailedRowLogged = true;
        }
        if (isClosedContextAbort(e)) {
          telemetry.detail_navigation_aborted_context_closed = true;
          telemetry.detail_navigation_aborted_after_row = row.eventId ?? null;
          telemetry.detail_context_deaths++;
        }
      } finally {
        if (shouldRestoreListing && page && !page.isClosed()) {
          await restoreListingPage(page, listingUrl, log).catch((e) => {
            if (isClosedContextAbort(e)) {
              telemetry.detail_navigation_aborted_context_closed = true;
              telemetry.detail_navigation_aborted_after_row = row.eventId ?? null;
              telemetry.detail_context_deaths++;
              return;
            }
            recordError(`Cal eProcure listing restore failed after ${row.eventId || '(unknown)'}: ${e.message}`);
          });
        }
      }

        rowIndex++;

        if (consecutiveFailures >= maxConsecutiveFailures) {
          telemetry.detail_rows_skipped_due_to_safety_limit = rowsToProcess.length - rowIndex;
          telemetry.detail_navigation_remaining_skipped = telemetry.detail_rows_skipped_due_to_safety_limit;
          errorMessages.push(`Cal eProcure detail navigation aborted: ${consecutiveFailures} consecutive failures; skipped ${telemetry.detail_rows_skipped_due_to_safety_limit} remaining row(s)`);
          rowIndex = rowsToProcess.length;
          break;
        }

        if (!page || !(await pageIsUsable(page))) {
          if (rowIndex < rowsToProcess.length) {
            await closeCurrentSession();
            break;
          }
        }
      }

      if (rowIndex < rowsToProcess.length) {
        await closeCurrentSession();
        try {
          rows = await startListingSession({ restart: true });
          if (rows.length > 0) telemetry.listing_rows_observed = Math.max(telemetry.listing_rows_observed, rows.length);
        } catch (e) {
          telemetry.detail_navigation_remaining_skipped = rowsToProcess.length - rowIndex;
          telemetry.detail_rows_skipped_due_to_safety_limit = telemetry.detail_navigation_remaining_skipped;
          errorMessages.push(`Cal eProcure detail navigation aborted: ${e.message}; skipped ${telemetry.detail_navigation_remaining_skipped} remaining row(s)`);
          break;
        }
      }
    }

    log(`[${sourceName}] Cal eProcure detail navigation summary: ${JSON.stringify(telemetry)}`);
    if (telemetry.detail_navigation_failed > 0) {
      errorMessages.push(`Cal eProcure detail navigation failed for ${telemetry.detail_navigation_failed}/${telemetry.detail_navigation_attempted} attempted row(s)`);
    }

    if (rows.length > detailLimit) {
      log(`[${sourceName}] Detail limit ${detailLimit} reached; ${rows.length - detailLimit} row(s) left for next controlled scan`);
    }

    await closeCurrentSession();
  } catch (e) {
    recordError(`Cal eProcure scrape failed: ${e.message}`);
  } finally {
    await closeCurrentSession();
  }

  return {
    candidates,
    errors: nonNavigationErrors + telemetry.detail_navigation_failed,
    errorMessages,
    telemetry,
  };
}

module.exports = {
  DEFAULT_LISTING_URL,
  openBrowser,
  waitForDetail,
  extractDetailMetadata,
  buildCandidateFromDetail,
  openEventPackage,
  caleprocureLogin,
  extractEventPackage,
  normalizePackageDocuments,
  stableAttachmentSourceKey,
  sanitizeFileName,
  inferFileType,
  extensionToContentType,
  documentFamilyFor,
  documentClassFor,
  parseCalEprocureDate,
  parseCanonicalDetailUrl,
  scrapeCalEprocure,
};
