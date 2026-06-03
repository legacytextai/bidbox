import { chromium } from 'playwright';

const PORTAL_URL = 'https://vendors.planetbids.com/portal/15927/bo/bo-search';

console.log('=== CANDIDATE 1: RAW PLAYWRIGHT ===\n');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  console.log('Step 1: Opening portal...');
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 30000 });
  console.log('✓ Portal loaded\n');

  console.log('Step 2: Waiting for bid table...');
  await page.waitForSelector('table tbody tr', { timeout: 15000 });
  console.log('✓ Table found\n');

  console.log('Step 3: Extracting Bidding rows...');
  const rows = await page.evaluate(() => {
    const results = [];
    const trs = document.querySelectorAll('table tbody tr');
    trs.forEach(tr => {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 4) return;
      const stage = cells[5]?.textContent?.trim() ?? '';
      if (!stage.toLowerCase().includes('bidding')) return;
      results.push({
        title: cells[1]?.textContent?.trim() ?? '',
        invitation: cells[2]?.textContent?.trim() ?? '',
        due_date: cells[3]?.textContent?.trim() ?? '',
        stage: stage,
      });
    });
    return results;
  });
  console.log(`✓ Found ${rows.length} Bidding rows`);
  console.log('Sample rows:', JSON.stringify(rows.slice(0, 3), null, 2), '\n');

  console.log('Step 4: Clicking first Bidding row and capturing URL...');
  const firstBiddingRow = await page.locator('table tbody tr').filter({
    hasText: 'Bidding'
  }).first();

  await firstBiddingRow.click();
  await page.waitForURL(/bo-detail/, { timeout: 10000 });
  const detailUrl = page.url();
  console.log(`✓ Detail URL captured: ${detailUrl}\n`);

  console.log('Step 5: Extracting metadata from detail page...');
  await page.waitForSelector('.opportunity-detail, [class*="detail"], h1', { timeout: 10000 });

  const metadata = await page.evaluate(() => {
    const getText = (selector) => document.querySelector(selector)?.textContent?.trim() ?? null;
    const title = document.querySelector('h1, h2, [class*="title"]')?.textContent?.trim() ?? null;
    
    // Extract NAICS codes
    const naics = [];
    document.querySelectorAll('*').forEach(el => {
      const text = el.textContent?.trim() ?? '';
      const matches = text.match(/\b2[3-9]\d{4}\b/g);
      if (matches && el.children.length === 0) naics.push(...matches);
    });

    // Extract due date
    const allText = document.body.innerText;
    const dueDateMatch = allText.match(/(?:due|closing|bid date)[:\s]+([^\n]+)/i);

    return {
      title,
      naics_codes: [...new Set(naics)].slice(0, 10),
      due_date_text: dueDateMatch?.[1]?.trim() ?? null,
      page_length: allText.length,
    };
  });

  console.log('✓ Metadata extracted:');
  console.log(JSON.stringify(metadata, null, 2), '\n');

  console.log('Step 6: Checking for downloadable files...');
  const fileLinks = await page.evaluate(() => {
    const links = [];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      const text = a.textContent?.trim() ?? '';
      if (href.match(/\.(pdf|doc|docx|xls|xlsx|zip|dwg)$/i) || 
          text.match(/download|plans|specs|addenda/i)) {
        links.push({ text, href });
      }
    });
    return links;
  });
  console.log(`✓ Found ${fileLinks.length} file links`);
  if (fileLinks.length > 0) console.log('Files:', JSON.stringify(fileLinks.slice(0, 5), null, 2));

  console.log('\n=== PLAYWRIGHT RESULT ===');
  console.log('Portal loaded: YES');
  console.log(`Bidding rows found: ${rows.length}`);
  console.log(`Detail URL captured: ${detailUrl ? 'YES - ' + detailUrl : 'NO'}`);
  console.log(`NAICS codes found: ${metadata.naics_codes.length > 0 ? metadata.naics_codes.join(', ') : 'NONE'}`);
  console.log(`Files found: ${fileLinks.length}`);

} catch (err) {
  console.error('✗ FAILED:', err.message);
  console.log('\n=== PLAYWRIGHT RESULT ===');
  console.log('Status: FAILED');
  console.log('Error:', err.message);
} finally {
  await browser.close();
}
