import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
const page = await browser.newPage();
await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-search', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
const rows = page.locator('tr').filter({ hasText: 'Bidding' });
await rows.first().click();
await page.waitForTimeout(3000);
console.log('Detail URL:', page.url());
const detail = await page.evaluate(() => {
  const allText = document.body.innerText;
  const naics = [...new Set(allText.match(/\b2[3-9]\d{4}\b/g) ?? [])];
  const docLinks = [];
  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href ?? '';
    const text = a.textContent?.trim() ?? '';
    if (href.match(/\.(pdf|doc|docx|zip|dwg)$/i) || text.match(/download|plan|spec|addend/i)) docLinks.push({ text, href: href.substring(0, 150) });
  });
  return { naics_codes: naics, doc_links: docLinks, full_text: allText.substring(0, 2000) };
});
console.log('NAICS codes:', detail.naics_codes);
console.log('Doc links:', JSON.stringify(detail.doc_links, null, 2));
console.log('Page text:', detail.full_text);
await page.locator('text=Documents').first().click();
await page.waitForTimeout(2000);
const docTab = await page.evaluate(() => document.body.innerText.substring(0, 1000));
console.log('Documents tab:', docTab);
await browser.close();