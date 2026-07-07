const { chromium } = require('playwright');
const { connectBrowserbaseSession, fetchBrowserbaseDownloadZip } = require('../lib/browserbase');

const DEFAULT_LISTING_URL = 'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx';
const DEFAULT_DETAIL_LIMIT = 300;

function sourceLabel(source) {
  return source?.name ?? source?.source_name ?? 'Cal eProcure';
}

function collapseWs(text) {
  return (text ?? '').replace(/\s+/g, ' ').trim();
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
  const text = collapseWs(String(raw).replace(/\bPST\b|\bPDT\b/gi, '')).trim();
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
      description: byId('AUC_HDR_DESCRLONG'),
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

function buildCandidateFromDetail({ listingUrl, row, target, detail, packageDiagnostics = null }) {
  const eventId = detail.eventId || row.eventId || target.eventId;
  const title = detail.title || row.title || eventId;
  const department = detail.department || row.department || null;
  const due = parseCalEprocureDate(detail.endDateRaw || row.endDateRaw);
  const published = parseCalEprocureDate(detail.publishedDateRaw || row.publishedDateRaw);
  const licenseCodes = uniq((detail.licenses ?? []).map((l) => l.code));
  const counties = uniq((detail.serviceAreas ?? []).map((area) => area.county));

  return {
    source_url: target.sourceUrl,
    raw_title: eventId && title && !title.startsWith(eventId) ? `${eventId} - ${title}` : title,
    agency: department,
    bid_due_at: due.iso,
    estimated_value: null,
    estimated_value_low: null,
    estimated_value_high: null,
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
      document_acquisition_supported: false,
      document_acquisition_note: 'Phase 1 metadata-only driver. Event Package download protocol is diagnostic-only pending Phase 2.',
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

async function scrapeCalEprocure(source, log = console.log) {
  const listingUrl = source.listing_url || DEFAULT_LISTING_URL;
  const detailLimit = parseNumberEnv('CALEPROCURE_MAX_DETAILS', DEFAULT_DETAIL_LIMIT);
  const sourceName = sourceLabel(source);
  const candidates = [];
  const errorMessages = [];
  let session;

  const recordError = (message) => {
    errorMessages.push(message);
    log(`[${sourceName}] ${message}`);
  };

  try {
    session = await openBrowser(log);
    const { browser, page, sessionId, transport } = session;
    log(`[${sourceName}] Opening Cal eProcure via ${transport}: ${listingUrl}`);

    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForSearchShell(page);
    await captureSearchDiagnostics(page, 'after_load', log);

    await waitForSearchRows(page, 10000).catch((e) => {
      log(`Cal eProcure initial row wait did not observe rendered rows: ${e.message}`);
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
      await captureSearchDiagnostics(page, 'after_search', log);
      rows = await collectListingRows(page, log);
    }

    const detailTargets = [];
    for (const row of rows) {
      const target = resolveRowDetailTarget(row);
      if (!target?.sourceUrl) {
        recordError(`No usable detail URL found for Cal eProcure event ${row.eventId || '(unknown)'}`);
        continue;
      }
      detailTargets.push({ row, target });
    }

    log(`[${sourceName}] Cal eProcure detail targets resolved: ${detailTargets.length}/${rows.length}`);

    let packageDiagnosticsCaptured = false;
    for (const { row, target } of detailTargets.slice(0, detailLimit)) {
      try {
        await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await waitForDetail(page);
        const detail = await extractDetailMetadata(page);
        let packageDiagnostics = null;

        if (!packageDiagnosticsCaptured && process.env.CALEPROCURE_CAPTURE_PACKAGE_DIAGNOSTICS === 'true') {
          packageDiagnostics = await capturePackageDownloadDiagnostics(page, sessionId, log);
          packageDiagnosticsCaptured = true;
        }

        const candidate = buildCandidateFromDetail({ listingUrl, row, target, detail, packageDiagnostics });
        if (!candidate.raw_title || !candidate.portal_bid_id) {
          recordError(`Metadata extraction incomplete for ${target.sourceUrl}: title=${candidate.raw_title || 'missing'} event_id=${candidate.portal_bid_id || 'missing'}`);
          continue;
        }
        candidates.push(candidate);
        log(`[${sourceName}] Parsed Cal eProcure event ${candidate.portal_bid_id}: ${candidate.raw_title}`);
      } catch (e) {
        recordError(`Cal eProcure detail extraction failed for ${target.sourceUrl}: ${e.message}`);
      }
    }

    if (detailTargets.length > detailLimit) {
      log(`[${sourceName}] Detail limit ${detailLimit} reached; ${detailTargets.length - detailLimit} target(s) left for next controlled scan`);
    }

    await browser.close().catch(() => {});
    session = null;
  } catch (e) {
    recordError(`Cal eProcure scrape failed: ${e.message}`);
  } finally {
    if (session?.browser) {
      await session.browser.close().catch(() => {});
    }
  }

  return {
    candidates,
    errors: errorMessages.length,
    errorMessages,
  };
}

module.exports = {
  DEFAULT_LISTING_URL,
  parseCalEprocureDate,
  parseCanonicalDetailUrl,
  scrapeCalEprocure,
};
