
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: false });
const page = await browser.newPage();

page.on('response', async (response) => {
  const url = response.url();
  if (url.includes('planetbids.com') && response.status() === 200) {
    console.log('API call:', url.substring(0, 120));
  }
});

await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-search', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(8000);

const snap = await page.evaluate(() => ({
  tables: document.querySelectorAll('table').length,
  rows: document.querySelectorAll('tr').length,
  bodyText: document.body.innerText.substring(0, 1000),
  allText: document.body.innerHTML.substring(0, 500),
}));

console.log(JSON.stringify(snap, null, 2));
await browser.close();
