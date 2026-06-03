
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-search', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(5000);
const snap = await page.evaluate(() => ({
  title: document.title,
  tables: document.querySelectorAll('table').length,
  rows: document.querySelectorAll('tr').length,
  bodyText: document.body.innerText.substring(0, 3000),
}));
console.log(JSON.stringify(snap, null, 2));
await browser.close();
