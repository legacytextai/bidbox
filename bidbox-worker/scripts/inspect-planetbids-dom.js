/**
 * DOM inspector for PlanetBids Line Items tab.
 *
 * Opens the Northwood bid page (or any PlanetBids URL via INSPECT_URL),
 * logs in, navigates back, clicks the Line Items tab, waits for render,
 * then dumps:
 *   - Every row-like element: tag, classes, text
 *   - Every cell-like element inside each row: tag, classes, text
 *   - The full outerHTML of the rendered tab panel (truncated)
 *   - Every intercepted API response URL + raw JSON
 *
 * No parsing or extraction. Pure observation.
 *
 * Usage:
 *   node scripts/inspect-planetbids-dom.js
 *   INSPECT_URL=https://vendors.planetbids.com/portal/15927/bo/bo-detail/143017 node scripts/inspect-planetbids-dom.js
 *
 * Required env vars:
 *   BROWSERBASE_API_KEY
 *   BROWSERBASE_PROJECT_ID
 *   SUPABASE_URL               (to look up Northwood candidate URL if INSPECT_URL not set)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   PLANETBIDS_EMAIL
 *   PLANETBIDS_PASSWORD
 */

'use strict';

const { chromium } = require('playwright-core');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const API_HOST = 'api-external.prod.planetbids.com';

const ARTIFACT_DIR = path.resolve(__dirname, '../../debug-artifacts/planetbids-northwood');
fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

const reportLines = [];

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  reportLines.push(line);
}

function save(filename, content) {
  const dest = path.join(ARTIFACT_DIR, filename);
  fs.writeFileSync(dest, content);
  log(`Saved: ${dest}`);
}

async function createPage() {
  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID ?? '';
  if (!bbApiKey) throw new Error('BROWSERBASE_API_KEY not configured');

  log('Creating Browserbase session...');
  const res = await fetch('https://www.browserbase.com/v1/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-bb-api-key': bbApiKey },
    body: JSON.stringify({ projectId: bbProjectId }),
  });
  if (!res.ok) throw new Error(`Browserbase session failed: ${res.status} — ${await res.text()}`);
  const { id: sessionId } = await res.json();
  log(`Session: ${sessionId}`);

  const browser = await chromium.connectOverCDP(
    `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`
  );
  const context = browser.contexts()[0] ?? (await browser.newContext());
  const page = await context.newPage();
  await page.setExtraHTTPHeaders({ 'User-Agent': BROWSER_USER_AGENT });
  return { browser, page };
}

async function getTargetUrl() {
  if (process.env.INSPECT_URL) return process.env.INSPECT_URL;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const { data, error } = await supabase
    .from('opportunity_candidates')
    .select('source_url, raw_title')
    .ilike('raw_title', '%northwood%')
    .eq('portal_type', 'planetbids')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) throw new Error(`Northwood candidate not found: ${error?.message}`);
  log(`Found candidate: ${data.raw_title} → ${data.source_url}`);
  return data.source_url;
}

async function loginToPlanetBids(page) {
  const email = process.env.PLANETBIDS_EMAIL;
  const password = process.env.PLANETBIDS_PASSWORD;
  if (!email || !password) { log('No credentials — proceeding as public'); return; }

  const loginBtn = page.locator('text=LOG IN').first();
  if (!(await loginBtn.isVisible({ timeout: 8000 }).catch(() => false))) {
    log('LOG IN not visible — already logged in or public page');
    return;
  }
  log('Logging in...');
  await loginBtn.click();
  await page.waitForTimeout(1500);
  await page.locator('input[type=email], input[name=email]').first().fill(email);
  await page.locator('input[type=password]').first().fill(password);
  await page.locator('button[type=submit]').first().click();
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  log('Login submitted');
}

async function main() {
  const targetUrl = await getTargetUrl();
  const { browser, page } = await createPage();

  // Capture every API response from PlanetBids
  const apiResponses = [];
  page.on('response', (res) => {
    if (!res.url().includes(API_HOST)) return;
    res.json().then((json) => {
      apiResponses.push({ url: res.url(), status: res.status(), json });
    }).catch(() => {
      apiResponses.push({ url: res.url(), status: res.status(), json: null });
    });
  });

  try {
    log(`Navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    log(`URL after navigation: ${page.url()}`);

    await loginToPlanetBids(page);

    log(`Re-navigating to: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    log(`URL after re-navigation: ${page.url()}`);

    // ── List all tabs ────────────────────────────────────────────────────────
    const allTabInfo = await page.evaluate(() => {
      const els = [
        ...document.querySelectorAll('[role="tab"]'),
        ...document.querySelectorAll('mat-tab-label, .mat-tab-label, .mat-mdc-tab'),
      ];
      return els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        classes: el.className,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ariaSelected: el.getAttribute('aria-selected'),
      }));
    });
    console.log('\n══ TABS FOUND ══════════════════════════════');
    for (const t of allTabInfo) {
      console.log(`  <${t.tag}> class="${t.classes}" aria-selected="${t.ariaSelected}" text="${t.text}"`);
    }

    // ── Click the Line Items tab ─────────────────────────────────────────────
    const lineItemsTab = page
      .locator('[role="tab"], mat-tab-label, .mat-tab-label, .mat-mdc-tab')
      .filter({ hasText: /line\s*items?|bid\s*items?/i })
      .first();

    const tabVisible = await lineItemsTab.isVisible({ timeout: 5000 }).catch(() => false);
    if (!tabVisible) {
      log('Line Items tab not found — trying getByText fallback');
      const fallback = page.getByText(/line\s*items?|bid\s*items?/i).first();
      if (await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
        await fallback.click();
        log('Clicked via fallback');
      } else {
        log('ERROR: Could not find Line Items tab');
      }
    } else {
      const label = await lineItemsTab.innerText().catch(() => '?');
      log(`Clicking tab: "${label.trim()}"`);
      await lineItemsTab.click();
    }

    log('Waiting for content to render...');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);
    log(`URL after tab click: ${page.url()}`);

    // ── Artifact 1: full page screenshot ─────────────────────────────────────
    const screenshot = await page.screenshot({ fullPage: true }).catch((e) => {
      log(`Screenshot failed: ${e.message}`);
      return null;
    });
    if (screenshot) save('page-after-tab-click.png', screenshot);

    // ── Artifact 2: full page HTML ────────────────────────────────────────────
    const fullHtml = await page.content().catch(() => '');
    if (fullHtml) save('page-after-tab-click.html', fullHtml);

    // ── Raw DOM dump of the active tab panel ─────────────────────────────────
    const panelDump = await page.evaluate(() => {
      const panel =
        document.querySelector('mat-tab-body[aria-hidden="false"]') ||
        document.querySelector('mat-tab-body.mat-mdc-tab-body-active') ||
        document.querySelector('mat-tab-body.mat-tab-body-active') ||
        document.querySelector('[role="tabpanel"]:not([aria-hidden="true"])');

      if (!panel) return { found: false, outerHTML: '', innerText: '' };

      return {
        found: true,
        panelTag: panel.tagName.toLowerCase(),
        panelClass: panel.className,
        panelAriaHidden: panel.getAttribute('aria-hidden'),
        outerHTML: panel.outerHTML,
        innerText: panel.innerText ?? '',
      };
    });

    console.log('\n══ ACTIVE TAB PANEL ════════════════════════');
    console.log(`  found: ${panelDump.found}`);
    if (panelDump.found) {
      console.log(`  tag:   ${panelDump.panelTag}`);
      console.log(`  class: ${panelDump.panelClass}`);
      console.log(`  aria-hidden: ${panelDump.panelAriaHidden}`);
      console.log(`\n── innerText (first 3000 chars) ──`);
      console.log(panelDump.innerText.substring(0, 3000));
      console.log(`\n── outerHTML preview (first 2000 chars) ──`);
      console.log(panelDump.outerHTML.substring(0, 2000));

      // ── Artifact 3: focused container outerHTML ───────────────────────────
      if (panelDump.outerHTML) save('line-items-panel.html', panelDump.outerHTML);
    }

    // ── Enumerate every row-like and cell-like element in the panel ──────────
    const elementDump = await page.evaluate(() => {
      const panel =
        document.querySelector('mat-tab-body[aria-hidden="false"]') ||
        document.querySelector('mat-tab-body.mat-mdc-tab-body-active') ||
        document.querySelector('mat-tab-body.mat-tab-body-active') ||
        document.querySelector('[role="tabpanel"]:not([aria-hidden="true"])') ||
        document.body;

      const clean = (v) => (v ?? '').replace(/\s+/g, ' ').trim().substring(0, 120);

      // Row-like: any element with "row" in tag or role, or common row class patterns
      const rowSelectors = [
        'tr', 'mat-row', '[role="row"]',
        '[class*="row"]', '[class*="-row"]',
        'li[class*="item"]', 'li[class*="bid"]',
        'div[class*="bid-item"]', 'div[class*="line-item"]',
        'div[class*="item-row"]', 'div[class*="table-row"]',
      ];
      const rowEls = Array.from(panel.querySelectorAll(rowSelectors.join(',')));

      // Cell-like: any element with "cell" or "col" in tag or role
      const cellSelectors = [
        'td', 'th', 'mat-cell', 'mat-header-cell',
        '[role="cell"]', '[role="columnheader"]', '[role="gridcell"]',
        '[class*="cell"]', '[class*="-col"]',
      ];
      const cellEls = Array.from(panel.querySelectorAll(cellSelectors.join(',')));

      return {
        rows: rowEls.slice(0, 40).map((el) => ({
          tag: el.tagName.toLowerCase(),
          classes: el.className.substring(0, 200),
          role: el.getAttribute('role'),
          text: clean(el.innerText || el.textContent),
          childCount: el.children.length,
        })),
        cells: cellEls.slice(0, 80).map((el) => ({
          tag: el.tagName.toLowerCase(),
          classes: el.className.substring(0, 200),
          role: el.getAttribute('role'),
          text: clean(el.innerText || el.textContent),
          parentTag: el.parentElement?.tagName?.toLowerCase(),
          parentClasses: (el.parentElement?.className ?? '').substring(0, 100),
        })),
        rowCount: rowEls.length,
        cellCount: cellEls.length,
      };
    });

    console.log(`\n══ ROW-LIKE ELEMENTS (${elementDump.rowCount} found, showing first 40) ══`);
    for (const [i, r] of elementDump.rows.entries()) {
      console.log(`  [${i}] <${r.tag}> role="${r.role}" class="${r.classes}" children=${r.childCount}`);
      console.log(`       text: "${r.text}"`);
    }

    console.log(`\n══ CELL-LIKE ELEMENTS (${elementDump.cellCount} found, showing first 80) ══`);
    for (const [i, c] of elementDump.cells.entries()) {
      console.log(`  [${i}] <${c.tag}> role="${c.role}" class="${c.classes}"`);
      console.log(`       parent: <${c.parentTag}> class="${c.parentClasses}"`);
      console.log(`       text: "${c.text}"`);
    }

    // ── All API responses ────────────────────────────────────────────────────
    await page.waitForTimeout(1000); // let any late JSON reads complete
    console.log(`\n══ API RESPONSES FROM ${API_HOST} (${apiResponses.length} total) ══`);
    for (const [i, r] of apiResponses.entries()) {
      console.log(`\n  [${i}] ${r.status} ${r.url}`);
      if (r.json !== null) {
        const preview = JSON.stringify(r.json).substring(0, 1500);
        console.log(`  JSON: ${preview}`);
      } else {
        console.log('  JSON: (parse failed or non-JSON)');
      }
    }

    // ── Artifact 4: raw API JSON ──────────────────────────────────────────────
    if (apiResponses.length > 0) {
      const apiDump = apiResponses.map((r) => ({
        url: r.url,
        status: r.status,
        json: r.json,
      }));
      save('api-responses.json', JSON.stringify(apiDump, null, 2));
    }

  } finally {
    await browser.close().catch(() => {});

    // ── Artifact 5: full console report ──────────────────────────────────────
    save('dom-report.txt', reportLines.join('\n'));

    console.log(`\n══ ARTIFACTS SAVED TO: ${ARTIFACT_DIR} ══`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
