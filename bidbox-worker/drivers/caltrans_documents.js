const fs = require('fs/promises');
const { chromium } = require('playwright');
const {
  extractSupportedArchiveEntries,
  isArchiveFile,
} = require('./archive_extraction');
const { replaceBidItemsForCandidate } = require('./bid_items');

const DOCUMENT_BUCKET = 'opportunity-documents';
const CALTRANS_ORIGIN = 'https://ppmoe.dot.ca.gov';
const CALTRANS_LOGIN_URL = `${CALTRANS_ORIGIN}/cc?id=csm_login`;
const CALTRANS_NDA_URL = `${CALTRANS_ORIGIN}/cc?id=cc_nda`;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_DOWNLOADS_PER_SESSION = 1;
const MAX_DOCUMENT_DOWNLOAD_ATTEMPTS = 3;

const SELECTORS = {
  bidDocumentsPanel: '#bidFiles',
  expandAllButton: '#toggleButton',
  downloadButton: 'button:has-text("Download Selected Files")',
  fileCheckboxes: 'input[type="checkbox"]',
  loginEmail: 'input[type="email"], input[name*="email" i], input[id*="email" i], input[type="text"]',
  loginPassword: 'input[type="password"]',
  loginButton: 'button[type="submit"], input[type="submit"], button:has-text("Log in"), button:has-text("Login")',
  ndaAgree: 'input[type="radio"], input[type="checkbox"]',
  ndaSubmit: 'button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Continue")',
};

const DOCUMENT_CATEGORY_PRIORITY = new Map([
  ['Forms For Bid', 1],
  ['Notice to Bidders & Special Provisions', 2],
  ['Supplemental Info', 3],
  ['Project Plans', 4],
]);

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
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.dwg')) return 'image/vnd.dwg';
  return 'application/octet-stream';
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

function firstMatch(text, regex) {
  const match = String(text ?? '').match(regex);
  return match?.[1]?.trim() ?? null;
}

function parseMoney(raw) {
  if (!raw) return null;
  const value = Number(String(raw).replace(/[$,]/g, '').trim());
  return Number.isFinite(value) ? value : null;
}

function parseFileSize(raw) {
  if (!raw) return null;
  const match = String(raw).match(/([\d,.]+)\s*(bytes?|kb|mb|gb)/i);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toLowerCase();
  if (unit.startsWith('g')) return Math.round(value * 1024 * 1024 * 1024);
  if (unit.startsWith('m')) return Math.round(value * 1024 * 1024);
  if (unit.startsWith('k')) return Math.round(value * 1024);
  return Math.round(value);
}

function parseCounty(locationText, routeLine) {
  const source = `${locationText ?? ''}\n${routeLine ?? ''}`;
  const cityCountyMatch = source.match(/\bCITY AND COUNTY OF\s+([A-Z][A-Z\s]+?)(?:\s+FROM|\s+AT|\s+NEAR|\s+ON|\n|$)/);
  if (cityCountyMatch?.[1]) {
    return cityCountyMatch[1].trim().replace(/\s+/g, ' ');
  }

  const countyMatch = source.match(/\b(?:IN\s+)?([A-Z][A-Z\s,]+?)\s+COUNT(?:Y|IES)\b/);
  if (countyMatch?.[1]) {
    return countyMatch[1]
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(', ');
  }

  const routeCounty = routeLine?.match(/^\d{2}-([A-Za-z]{2,3}(?:,[A-Za-z]{2,3})?)-/);
  return routeCounty?.[1] ?? null;
}

function extractContractNumber(candidate) {
  const urlMatch = String(candidate?.source_url ?? '').match(/[?&]ad_id=([^&]+)/i);
  if (urlMatch?.[1]) return decodeURIComponent(urlMatch[1]).toUpperCase();
  if (candidate?.crawl_data?.contract_number) return String(candidate.crawl_data.contract_number).toUpperCase();
  const titleMatch = String(candidate?.raw_title ?? '').match(/\b(\d{2}-[A-Z0-9]+)\b/i);
  return titleMatch?.[1]?.toUpperCase() ?? null;
}

function buildDetailUrl(candidate) {
  const current = String(candidate?.source_url ?? '');
  if (/id=cc_advertisement_details/i.test(current) && /ad_id=/i.test(current)) {
    return current;
  }
  const contractNumber = extractContractNumber(candidate);
  if (!contractNumber) return current;
  return `${CALTRANS_ORIGIN}/cc?id=cc_advertisement_details&ad_id=${encodeURIComponent(contractNumber)}&active=true&status=Advertising`;
}

function normalizeSourceUrl(candidate, doc) {
  const detailUrl = buildDetailUrl(candidate);
  const url = new URL(detailUrl || `${CALTRANS_ORIGIN}/cc`);
  url.hash = `file=${encodeURIComponent(doc.file_name)}`;
  return url.toString();
}

function documentFamilyForCategory(category) {
  const value = String(category ?? '').toLowerCase();
  if (value.includes('plan')) return 'plans';
  if (value.includes('special provisions') || value.includes('notice')) return 'specifications';
  if (value.includes('form')) return 'bid_forms';
  if (value.includes('supplemental')) return 'supporting_documents';
  if (value.includes('post bid')) return 'supporting_documents';
  return 'supporting_documents';
}

function documentClassForCategory(category) {
  const value = String(category ?? '').toLowerCase();
  if (value.includes('plan')) return 'plans';
  if (value.includes('special provisions')) return 'special_provisions';
  if (value.includes('notice')) return 'notice_to_bidders';
  if (value.includes('form')) return 'bid_forms';
  if (value.includes('supplemental')) return 'supplemental_information';
  return 'source_document';
}

function downloadsPerSession() {
  const raw = Number(process.env.CALTRANS_DOWNLOADS_PER_SESSION);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_DOWNLOADS_PER_SESSION;
}

function isCrashLikeError(error) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('target crashed') ||
    message.includes('target closed') ||
    message.includes('browser has been closed') ||
    message.includes('page has been closed') ||
    message.includes('execution context was destroyed') ||
    message.includes('crash')
  );
}

async function launchBrowser() {
  const executablePath = process.env.CALTRANS_CHROME_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) {
    return chromium.launch({ headless: true, executablePath });
  }
  return chromium.launch({ headless: true });
}

async function closeSession(session) {
  if (!session) return;
  await session.page?.close?.().catch(() => {});
  await session.browser?.close?.().catch(() => {});
}

async function openCaltransSession(detailUrl, log) {
  const browser = await launchBrowser();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1600 },
    acceptDownloads: true,
  });
  await page.setExtraHTTPHeaders({ 'User-Agent': BROWSER_USER_AGENT });
  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForDetailPage(page);
  await expandBidDocuments(page, log);
  return { browser, page, downloads: 0 };
}

async function assertPageHealthy(page) {
  if (!page || page.isClosed()) return false;
  return page.evaluate(() => true).then(() => true).catch(() => false);
}

async function waitForDetailPage(page) {
  await page.waitForFunction(() => {
    const text = document.body?.innerText ?? '';
    return /Advertisement Details/i.test(text) && /Bid Documents/i.test(text);
  }, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

function parseCaltransMetadataFromText(text, candidate) {
  const body = String(text ?? '').replace(/\r/g, '');
  const contractNumber = firstMatch(body, /Advertisement Details\s*\n\s*([0-9]{2}-[A-Z0-9]+)/i)
    ?? extractContractNumber(candidate);
  const title = firstMatch(body, /Advertisement Details\s*\n\s*[0-9]{2}-[A-Z0-9]+\s*-\s*([^\n]+)/i)
    ?? candidate.raw_title;
  const routeLine = firstMatch(body, /^(\d{2}-[A-Z]{2,3}(?:,[A-Z]{2,3})?-[^\n]+?)\s+\*\s+Date Advertised/m)
    ?? candidate.crawl_data?.route_line
    ?? null;
  const district = contractNumber ? contractNumber.slice(0, 2) : candidate.crawl_data?.district ?? null;
  const dateAdvertisedRaw = firstMatch(body, /Date Advertised\s+(\d{4}-\d{2}-\d{2})/i)
    ?? candidate.crawl_data?.date_advertised_raw
    ?? null;
  const bidDueRaw = firstMatch(body, /Bids Open\s+(\d{4}-\d{2}-\d{2})/i)
    ?? candidate.crawl_data?.bid_due_raw
    ?? null;
  const estimateRaw = firstMatch(body, /Estimate:\s*([$0-9,.]+)/i)
    ?? candidate.crawl_data?.engineer_estimate_raw
    ?? candidate.crawl_data?.estimated_value_raw
    ?? null;
  const estimateValue = parseMoney(estimateRaw);
  const location = firstMatch(body, /(^In\s+[^\n]+(?:\n(?!The Contractor|Subs\/Suppliers|Planholders|Bid Book|Expand All|Bid Documents|Post Bid Documents|Bid items|Bidder Inquiries|Subcontractor Opt-Ins|Prime:|Back to Top)[^\n]+)*)/im)
    ?? candidate.crawl_data?.location
    ?? null;
  const licenseRequirements = firstMatch(body, /(The Contractor must have[^\n]+)/i)
    ?? candidate.crawl_data?.license_requirements
    ?? null;
  const workingDays = firstMatch(body, /(\d[\d,]*\s+Working Days)/i)
    ?? candidate.crawl_data?.contract_duration
    ?? null;
  const goalRequirement = firstMatch(body, /\d[\d,]*\s+Working Days\s+\*\s+([^\n]+)/i)
    ?? candidate.crawl_data?.goal_requirement
    ?? null;
  const county = parseCounty(location, routeLine) ?? candidate.crawl_data?.county ?? null;

  return {
    contract_number: contractNumber,
    project_title: title ? String(title).trim() : null,
    district,
    route_postmile: routeLine,
    route_line: routeLine,
    county,
    location,
    date_advertised_raw: dateAdvertisedRaw,
    bid_due_raw: bidDueRaw,
    engineer_estimate_raw: estimateRaw,
    engineer_estimate: estimateValue,
    estimated_value_raw: estimateRaw,
    estimated_value: estimateValue,
    working_days: workingDays,
    contract_duration: workingDays,
    license_requirements: licenseRequirements,
    goal_requirement: goalRequirement,
    detail_metadata_refreshed_at: new Date().toISOString(),
    document_acquisition_supported: true,
  };
}

async function extractCaltransBidItems(page, candidate, log) {
  const items = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const tables = Array.from(document.querySelectorAll('table'));
    const candidates = [];

    const headerIndex = (headers, patterns) => headers.findIndex((header) => patterns.some((pattern) => pattern.test(header)));

    for (const table of tables) {
      const rows = Array.from(table.querySelectorAll('tr'))
        .map((tr) => Array.from(tr.querySelectorAll('th,td')).map((cell) => clean(cell.innerText)))
        .filter((row) => row.some(Boolean));
      if (rows.length < 2) continue;

      const headers = rows[0].map((header) => header.toLowerCase());
      const bodyRows = rows.slice(1);
      const tableText = clean(table.innerText);
      if (!/bid\s*items?|item\s*(no|number)|item\s*code|description|unit|quantity|qty/i.test(tableText)) continue;

      const itemIndex = headerIndex(headers, [/^item\b/, /item\s*(no|number)/]);
      const codeIndex = headerIndex(headers, [/code/]);
      const descIndex = headerIndex(headers, [/description/, /item\s*description/, /work\s*description/]);
      const unitIndex = headerIndex(headers, [/^unit$/, /unit\s*of\s*measure/, /^uom$/]);
      const qtyIndex = headerIndex(headers, [/quantity/, /^qty$/, /estimated\s*quantity/]);
      if (descIndex < 0) continue;

      for (const row of bodyRows) {
        const description = row[descIndex];
        if (!description || /^total\b/i.test(description)) continue;
        candidates.push({
          item_number: itemIndex >= 0 ? row[itemIndex] : null,
          item_code: codeIndex >= 0 ? row[codeIndex] : null,
          description,
          unit_of_measure: unitIndex >= 0 ? row[unitIndex] : null,
          quantity_raw: qtyIndex >= 0 ? row[qtyIndex] : null,
          raw_text: row.join(' | '),
          metadata: {
            source_table_headers: rows[0],
          },
        });
      }
    }

    if (candidates.length > 0) return candidates;

    const text = document.body?.innerText ?? '';
    const bidItemsMatch = text.match(/Bid items?\s*([\s\S]*?)(?:Bidder Inquiries|Subcontractor Opt-Ins|Prime:|Bid Documents|Post Bid Documents|Back to Top|$)/i);
    const block = bidItemsMatch?.[1] ?? '';
    return block
      .split('\n')
      .map((line) => clean(line))
      .filter((line) => /^\d+\s+\d{4,}\s+.+\s+[A-Z]{1,8}\s+[\d,.]+$/i.test(line))
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\d{4,})\s+(.+?)\s+([A-Z]{1,8})\s+([\d,.]+)$/i);
        return {
          item_number: match?.[1] ?? null,
          item_code: match?.[2] ?? null,
          description: match?.[3] ?? line,
          unit_of_measure: match?.[4] ?? null,
          quantity_raw: match?.[5] ?? null,
          raw_text: line,
          metadata: {
            source_parser: 'caltrans_bid_items_text_block',
          },
        };
      });
  });

  const normalized = items.map((item, index) => ({
    ...item,
    source_portal: 'caltrans',
    source_opportunity_id: extractContractNumber(candidate),
    extraction_method: 'portal_tab',
    extraction_status: 'extracted',
    source_url: buildDetailUrl(candidate),
    source_order: index + 1,
    metadata: {
      ...(item.metadata ?? {}),
      source: 'caltrans_contractors_corner',
      detail_url: buildDetailUrl(candidate),
    },
  }));

  log(`Caltrans bid item rows discovered: ${normalized.length}`);
  return normalized;
}

async function mergeCandidateMetadata(supabase, candidate, metadata, log) {
  const crawlData = {
    ...(candidate.crawl_data ?? {}),
    ...Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== '')),
  };

  const { error } = await supabase
    .from('opportunity_candidates')
    .update({ crawl_data: crawlData })
    .eq('id', candidate.id);

  if (error) {
    log(`Caltrans metadata merge failed: ${error.message}`);
    return;
  }
  candidate.crawl_data = crawlData;
  log('Caltrans project metadata refreshed');
}

async function expandBidDocuments(page, log) {
  log('Expanding Bid Documents');
  await page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    if (panel) {
      panel.classList.add('in');
      panel.style.height = 'auto';
      panel.setAttribute('aria-hidden', 'false');
      panel.removeAttribute('style');
      panel.classList.add('in');
    }
  }, SELECTORS.bidDocumentsPanel);
  await page.waitForTimeout(500);
  const visible = await page.locator(`${SELECTORS.bidDocumentsPanel} input[type="checkbox"]`).first().isVisible().catch(() => false);
  if (!visible) {
    const expandAll = page.locator(SELECTORS.expandAllButton).first();
    if (await expandAll.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expandAll.click().catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
}

async function discoverDocuments(page, candidate, log) {
  await expandBidDocuments(page, log);
  const documents = await page.evaluate((selector) => {
    const panel = document.querySelector(selector) || document;
    const fileInputs = Array.from(panel.querySelectorAll('input[type="checkbox"]'))
      .filter((input) => /\.[a-z0-9]{2,5}$/i.test(input.id || ''));

    const getDirectLabelText = (li) => {
      if (!li) return null;
      for (const child of Array.from(li.children)) {
        if (child.tagName === 'LABEL') {
          const strong = child.querySelector('strong');
          return (strong?.innerText || child.innerText || '').replace(/\s*\(Requires NDA sign off\)\s*/i, '').trim();
        }
      }
      return null;
    };

    return fileInputs.map((input, index) => {
      const label = panel.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      const labelText = (label?.innerText || input.id || '').replace(/\s+/g, ' ').trim();
      const fileName = (input.id || labelText.replace(/\s*\([^)]+\)\s*$/, '')).trim();
      const sizeMatch = labelText.match(/\(([^)]+)\)/);
      const fileLi = input.closest('li');
      const categoryLi = fileLi?.parentElement?.closest('li');
      const category = getDirectLabelText(categoryLi) || 'Bid Documents';
      const categoryText = categoryLi?.innerText || '';

      return {
        file_name: fileName,
        file_size_raw: sizeMatch?.[1] ?? null,
        category,
        requires_nda: /requires nda sign off/i.test(categoryText),
        checkbox_id: input.id,
        document_source_order: index + 1,
      };
    });
  }, SELECTORS.bidDocumentsPanel);

  const normalized = documents.map((doc) => {
    const fileName = sanitizeFileName(doc.file_name);
    return {
      file_name: fileName,
      file_type: inferFileType(fileName),
      file_size: parseFileSize(doc.file_size_raw),
      source_url: normalizeSourceUrl(candidate, { file_name: fileName }),
      category: doc.category,
      requires_nda: Boolean(doc.requires_nda),
      checkbox_id: doc.checkbox_id,
      document_source_order: doc.document_source_order,
      document_family: documentFamilyForCategory(doc.category),
      document_class: documentClassForCategory(doc.category),
      manifest_data: {
        source: 'caltrans_contractors_corner',
        category: doc.category,
        requires_nda: Boolean(doc.requires_nda),
        checkbox_id: doc.checkbox_id,
        file_size_raw: doc.file_size_raw,
        detail_url: buildDetailUrl(candidate),
        acquisition_method: 'playwright_individual_download',
      },
    };
  }).sort((a, b) => {
    const byCategory = (DOCUMENT_CATEGORY_PRIORITY.get(a.category) ?? 99) - (DOCUMENT_CATEGORY_PRIORITY.get(b.category) ?? 99);
    return byCategory || a.document_source_order - b.document_source_order;
  });

  log(`Found ${normalized.length} Caltrans bid document file(s)`);
  for (const doc of normalized) {
    log(`Discovered Caltrans document: ${doc.category} / ${doc.file_name}${doc.requires_nda ? ' (NDA)' : ''}`);
  }
  return normalized;
}

function isLoginRequiredMessage(message) {
  return /sign(ed)? in|login|log in|authenticated/i.test(String(message ?? ''));
}

function isNdaRequiredMessage(message) {
  return /\bnda\b|non-disclosure|agreement/i.test(String(message ?? ''));
}

async function loginToCaltrans(page, log) {
  const email = process.env.CALTRANS_EMAIL;
  const password = process.env.CALTRANS_PASSWORD;
  if (!email || !password) {
    throw new Error('Missing Caltrans credentials: CALTRANS_EMAIL and CALTRANS_PASSWORD must be configured');
  }

  log('Logging in to Caltrans Contractors Corner');
  await page.goto(CALTRANS_LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const emailInput = page.locator(SELECTORS.loginEmail).first();
  const passwordInput = page.locator(SELECTORS.loginPassword).first();
  if (!(await emailInput.isVisible({ timeout: 15000 }).catch(() => false))) {
    throw new Error('Caltrans login email field not visible');
  }
  if (!(await passwordInput.isVisible({ timeout: 15000 }).catch(() => false))) {
    throw new Error('Caltrans login password field not visible');
  }

  await emailInput.fill(email);
  await passwordInput.fill(password);
  await page.locator(SELECTORS.loginButton).first().click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
  if (/invalid|incorrect|failed|error/i.test(bodyText) && /password|login|email/i.test(bodyText)) {
    throw new Error('Caltrans login failed; portal reported an authentication error');
  }
  log('Caltrans login submitted');
}

async function acceptCaltransNda(page, detailUrl, log) {
  log('Caltrans NDA required; opening NDA agreement');
  await page.goto(CALTRANS_NDA_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const accepted = await page.evaluate((selector) => {
    const controls = Array.from(document.querySelectorAll(selector));
    const target = controls.find((control) => {
      const id = control.id ? `label[for="${CSS.escape(control.id)}"]` : null;
      const label = id ? document.querySelector(id)?.innerText ?? '' : '';
      const nearby = control.closest('label, div, li, tr')?.innerText ?? '';
      return /i agree|agree|accept/i.test(`${label} ${nearby} ${control.value ?? ''}`);
    }) || controls[0];
    if (!target) return false;
    target.click();
    return true;
  }, SELECTORS.ndaAgree);

  if (!accepted) {
    throw new Error('Caltrans NDA acceptance control not found');
  }

  const submit = page.locator(SELECTORS.ndaSubmit).first();
  if (!(await submit.isVisible({ timeout: 10000 }).catch(() => false))) {
    throw new Error('Caltrans NDA submit control not visible');
  }
  await submit.click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  log('Caltrans NDA acceptance submitted');

  await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await waitForDetailPage(page);
  await expandBidDocuments(page, log);
}

async function clearFileSelections(page) {
  await page.evaluate((selector) => {
    for (const input of Array.from(document.querySelectorAll(`${selector} input[type="checkbox"]`))) {
      if (input.checked) input.click();
    }
  }, SELECTORS.bidDocumentsPanel);
}

async function downloadSelectedFile(page, doc, log) {
  await expandBidDocuments(page, log);
  await clearFileSelections(page);

  const checkbox = page.locator(`${SELECTORS.bidDocumentsPanel} input[id="${doc.checkbox_id.replace(/"/g, '\\"')}"]`).first();
  if (!(await checkbox.count())) {
    throw new Error(`Caltrans file checkbox not found: ${doc.checkbox_id}`);
  }
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.check({ force: true });
  log(`Downloading Caltrans file: ${doc.file_name}`);

  let dialogMessage = null;
  const dialogHandler = async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept().catch(() => {});
  };
  page.on('dialog', dialogHandler);

  try {
    const downloadPromise = page.waitForEvent('download', { timeout: 120000 }).catch(() => null);
    await page.locator(SELECTORS.downloadButton).first().click({ force: true });
    const download = await downloadPromise;
    if (download) {
      return download;
    }
  } finally {
    page.off('dialog', dialogHandler);
  }

  if (dialogMessage) {
    if (isLoginRequiredMessage(dialogMessage)) {
      const err = new Error(`Caltrans login required: ${dialogMessage}`);
      err.code = 'CALTRANS_LOGIN_REQUIRED';
      throw err;
    }
    if (isNdaRequiredMessage(dialogMessage)) {
      const err = new Error(`Caltrans NDA required: ${dialogMessage}`);
      err.code = 'CALTRANS_NDA_REQUIRED';
      throw err;
    }
    throw new Error(`Caltrans download dialog: ${dialogMessage}`);
  }

  throw new Error('Caltrans download did not produce a file');
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
    file_size: doc.file_size,
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

async function storeDownloadedDocument({ supabase, taskId, candidateId, doc, download, log }) {
  const { record, skipped } = await upsertDocumentRecord(supabase, taskId, candidateId, doc);
  if (skipped) {
    log(`Skipping already acquired Caltrans document: ${doc.file_name}`);
    return {
      status: 'skipped',
      id: record.id,
      filename: doc.file_name,
      category: doc.category,
      mimeType: extensionToContentType(doc.file_name),
      uploadedPath: record.storage_path,
      manifestData: doc.manifest_data,
    };
  }

  await supabase
    .from('opportunity_documents')
    .update({ acquisition_status: 'acquiring', acquisition_error: null })
    .eq('id', record.id);

  try {
    const path = await download.path();
    if (!path) throw new Error('Downloaded file path unavailable');
    const bytes = await fs.readFile(path);
    if (bytes.byteLength === 0) throw new Error('Download returned an empty file');

    const finalFileName = sanitizeFileName(download.suggestedFilename() || doc.file_name);
    const storagePath = `opportunity-candidates/${candidateId}/${record.id}/${finalFileName}`;
    const mimeType = extensionToContentType(finalFileName);

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_BUCKET)
      .upload(storagePath, bytes, {
        contentType: mimeType,
        upsert: true,
      });
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
        parentDoc: {
          ...doc,
          id: record.id,
          file_name: finalFileName,
          source_url: doc.source_url,
          document_source_order: doc.document_source_order,
        },
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
              processing_metadata: {
                reason: 'archive_extracted_in_f2',
                stats: archiveExtraction.stats,
              },
              detected_file_type: 'zip',
              detected_mime_type: mimeType,
              has_text: false,
              needs_ocr: false,
            }
          : {}),
      })
      .eq('id', record.id);

    log(`Uploaded Caltrans document: ${finalFileName} (${bytes.byteLength} bytes)`);
    return {
      status: 'acquired',
      id: record.id,
      filename: finalFileName,
      category: doc.category,
      mimeType,
      bytes: bytes.byteLength,
      uploadedPath: storagePath,
      manifestData: mergedManifestData,
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
      category: parentDoc.category,
      document_source_order: (parentDoc.document_source_order ?? 0) * 1000 + index,
      document_family: documentFamilyForCategory(parentDoc.category),
      document_class: documentClassForCategory(parentDoc.category),
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
        stored.push({
          status: 'skipped',
          id: record.id,
          filename: fileName,
          category: childDoc.category,
          mimeType: extensionToContentType(fileName),
          uploadedPath: record.storage_path,
          manifestData: childDoc.manifest_data,
        });
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
        .upload(storagePath, entry.bytes, {
          contentType: mimeType,
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
      stored.push({
        status: 'acquired',
        id: record.id,
        filename: fileName,
        category: childDoc.category,
        mimeType,
        bytes: entry.file_size,
        uploadedPath: storagePath,
        manifestData: childDoc.manifest_data,
      });
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
      stored.push({
        status: 'failed',
        filename: fileName,
        category: childDoc.category,
        error: e.message,
        manifestData: childDoc.manifest_data,
      });
    }
  }
  return stored;
}

async function acquireCaltransDocuments({ supabase, task, candidate, log }) {
  if (!process.env.CALTRANS_EMAIL || !process.env.CALTRANS_PASSWORD) {
    throw new Error('Missing Caltrans credentials: CALTRANS_EMAIL and CALTRANS_PASSWORD must be configured');
  }

  const detailUrl = buildDetailUrl(candidate);
  if (!detailUrl) throw new Error('Caltrans candidate is missing a usable source URL');

  let session = null;
  const perSessionLimit = downloadsPerSession();

  const acquiredDocuments = [];
  let acquired = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  const resetSession = async (reason) => {
    if (reason) log(`Refreshing Caltrans browser session: ${reason}`);
    await closeSession(session);
    session = await openCaltransSession(detailUrl, log);
    return session;
  };

  const ensureSession = async (reason = null) => {
    if (!session || !(await assertPageHealthy(session.page))) {
      return resetSession(reason ?? 'browser/page unavailable');
    }
    if (session.downloads >= perSessionLimit) {
      return resetSession(`download session limit reached (${perSessionLimit})`);
    }
    return session;
  };

  try {
    log(`Opening Caltrans advertisement detail page: ${detailUrl}`);
    session = await openCaltransSession(detailUrl, log);

    const bodyText = await session.page.locator('body').innerText({ timeout: 10000 });
    const metadata = parseCaltransMetadataFromText(bodyText, candidate);
    await mergeCandidateMetadata(supabase, candidate, metadata, log);

    const bidItems = await extractCaltransBidItems(session.page, candidate, log).catch((e) => {
      log(`Caltrans bid item extraction failed: ${e.message}`);
      return [];
    });
    await replaceBidItemsForCandidate({
      supabase,
      candidateId: candidate.id,
      items: bidItems,
      methods: ['portal_tab'],
      defaults: {
        sourcePortal: 'caltrans',
        sourceOpportunityId: extractContractNumber(candidate),
        extractionMethod: 'portal_tab',
        sourceUrl: detailUrl,
      },
      log,
    }).catch((e) => {
      log(`Caltrans bid item storage failed: ${e.message}`);
    });

    const manifestDocs = await discoverDocuments(session.page, candidate, log);

    for (const doc of manifestDocs) {
      let attempts = 0;
      let completed = false;
      let loginAttemptedForDoc = false;
      let ndaAttemptedForDoc = false;
      while (attempts < MAX_DOCUMENT_DOWNLOAD_ATTEMPTS && !completed) {
        attempts++;
        try {
          const current = await ensureSession(attempts > 1 ? `retrying ${doc.file_name}` : null);
          const download = await downloadSelectedFile(current.page, doc, log);
          const stored = await storeDownloadedDocument({
            supabase,
            taskId: task.id,
            candidateId: candidate.id,
            doc,
            download,
            log,
          });
          acquiredDocuments.push(stored);
          if (stored.status === 'acquired') acquired++;
          if (stored.status === 'skipped') skipped++;
          if (stored.archiveExtraction?.extractedDocuments?.length) {
            for (const extracted of stored.archiveExtraction.extractedDocuments) {
              acquiredDocuments.push(extracted);
              if (extracted.status === 'acquired') acquired++;
              else if (extracted.status === 'skipped') skipped++;
              else if (extracted.status === 'failed') failed++;
            }
          }
          current.downloads++;
          completed = true;
        } catch (e) {
          if (e.code === 'CALTRANS_LOGIN_REQUIRED' && !loginAttemptedForDoc) {
            loginAttemptedForDoc = true;
            log('Caltrans login required for document download');
            try {
              const current = await ensureSession('login required');
              await loginToCaltrans(current.page, log);
              await current.page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await waitForDetailPage(current.page);
              await expandBidDocuments(current.page, log);
              continue;
            } catch (loginError) {
              e = loginError;
            }
          }

          if (e.code === 'CALTRANS_NDA_REQUIRED' && !ndaAttemptedForDoc) {
            ndaAttemptedForDoc = true;
            try {
              const current = await ensureSession('NDA required');
              await acceptCaltransNda(current.page, detailUrl, log);
              continue;
            } catch (ndaError) {
              e = ndaError;
            }
          }

          if (isCrashLikeError(e) && attempts < MAX_DOCUMENT_DOWNLOAD_ATTEMPTS) {
            log(`Caltrans browser/page crashed while downloading ${doc.file_name}; retrying with a fresh session (attempt ${attempts + 1}/${MAX_DOCUMENT_DOWNLOAD_ATTEMPTS})`);
            await resetSession(`recovering from ${e.message}`);
            continue;
          }

          if (attempts < MAX_DOCUMENT_DOWNLOAD_ATTEMPTS) {
            log(`Caltrans document attempt failed for ${doc.file_name}: ${e.message}; retrying (attempt ${attempts + 1}/${MAX_DOCUMENT_DOWNLOAD_ATTEMPTS})`);
            if (isCrashLikeError(e)) {
              await resetSession(`recovering from ${e.message}`);
            }
            continue;
          }

          failed++;
          const message = `${doc.file_name}: ${e.message}`;
          errors.push(message);
          log(`Caltrans document failed after ${attempts} attempts: ${message}`);
          const { record } = await upsertDocumentRecord(supabase, task.id, candidate.id, doc);
          await supabase
            .from('opportunity_documents')
            .update({
              acquisition_status: 'failed',
              acquisition_error: e.message,
            })
            .eq('id', record.id);
        }
      }
    }

    const documentsFound = Math.max(manifestDocs.length, acquired + skipped + failed);
    log(`Caltrans acquisition complete: found=${documentsFound} acquired=${acquired} skipped=${skipped} failed=${failed}`);
    return {
      found: documentsFound,
      acquired,
      skipped,
      failed,
      acquiredDocuments,
      stats: { acquired, skipped, failed },
      warningSummary: failed > 0 && (acquired + skipped) > 0
        ? `Some source documents could not be acquired. BidBox successfully acquired ${acquired + skipped} of ${documentsFound} available documents.`
        : null,
      errorSummary: errors.length > 0 ? errors.slice(0, 5).join(' | ') : null,
      errors,
    };
  } finally {
    await closeSession(session);
  }
}

module.exports = {
  acquireCaltransDocuments,
  DOCUMENT_BUCKET,
  SELECTORS,
  parseCaltransMetadataFromText,
  extractCaltransBidItems,
  discoverDocuments,
};
