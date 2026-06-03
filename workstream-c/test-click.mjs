
import { chromium } from 'playwright';
const browser = await chromium.launch({ 
  headless: false,
  args: ['--disable-blink-features=AutomationControlled']
});
const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });

await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-search', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);

// Find and click the first Bidding row
const rows = page.locator('tr').filter({ hasText: 'Bidding' });
const count = await rows.count();
console.log('Bidding rows found:', count);

if (count > 0) {
  const firstRow = rows.first();
  const rowText = await firstRow.textContent();
  console.log('Clicking row:', rowText?.trim().substring(0, 100));
  
  await firstRow.click();
  await page.waitForTimeout(3000);
  
  const newUrl = page.url();
  console.log('URL after click:', newUrl);
  
  // Get page content after navigation
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
  console.log('Page content preview:', pageText.substring(0, 500));
}

await browser.close();
