import { chromium } from 'playwright';
import fs from 'fs';
import https from 'https';

const EMAIL = process.env.PB_EMAIL;
const PASSWORD = process.env.PB_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('Missing credentials'); process.exit(1); }

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled']
});

const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
await page.setExtraHTTPHeaders({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });

let downloadableFilesResponse = null;
let bearerToken = null;

page.on('request', req => {
  if (req.url().includes('api-external.prod.planetbids.com')) {
    const auth = req.headers()['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
      bearerToken = auth.replace('Bearer ', '');
    }
  }
});

page.on('response', async res => {
  if (res.url().includes('bid-downloadable-files')) {
    try {
      const json = await res.json();
      downloadableFilesResponse = json;
      console.log('File manifest captured with', json.data?.length, 'files');
    } catch(e) {}
  }
});

console.log('Step 1: Loading portal...');
await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-search', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(3000);

console.log('Step 2: Logging in...');
await page.locator('text=LOG IN').first().click();
await page.waitForTimeout(2000);
await page.locator('input[type=email], input[name=email]').first().fill(EMAIL);
await page.locator('input[type=password]').first().fill(PASSWORD);
await page.locator('button[type=submit]').first().click();
await page.waitForTimeout(4000);
console.log('Logged in. URL:', page.url());

console.log('Step 3: Navigating to opportunity...');
await page.goto('https://vendors.planetbids.com/portal/15927/bo/bo-detail/141798', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4000);

console.log('Step 4: Opening Documents tab...');
await page.locator('text=Documents').first().click();
await page.waitForTimeout(3000);

console.log('Bearer token captured:', bearerToken ? 'YES — ' + bearerToken.substring(0, 30) + '...' : 'NO');
console.log('File manifest captured:', downloadableFilesResponse ? 'YES' : 'NO');

if (bearerToken && downloadableFilesResponse?.data?.length > 0) {
  const firstFile = downloadableFilesResponse.data[0].attributes;
  const fileUrl = 'https://' + firstFile.serverFullPath + encodeURIComponent(firstFile.serverFilename);
  const fileName = firstFile.filename;
  const savePath = './' + fileName;
  console.log('Downloading:', fileName);
  console.log('URL:', fileUrl);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(savePath);
    const req = https.get(fileUrl, {
      headers: {
        'Authorization': 'Bearer ' + bearerToken,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://vendors.planetbids.com/',
        'Origin': 'https://vendors.planetbids.com',
      }
    }, (res) => {
      console.log('HTTP status:', res.statusCode);
      console.log('Content-Type:', res.headers['content-type']);
      console.log('Content-Length:', res.headers['content-length']);
      if (res.statusCode === 200) {
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          const size = fs.statSync(savePath).size;
          console.log('SUCCESS - Saved:', fileName, 'Size:', size, 'bytes');
          resolve();
        });
      } else {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          console.log('Non-200 response body:', body.substring(0, 500));
          resolve();
        });
      }
    });
    req.on('error', (e) => {
      console.log('HTTPS request error:', e.message);
      resolve();
    });
  });
}

const pdfs = fs.readdirSync('.').filter(f => f.endsWith('.pdf'));
console.log('\nFINAL RESULT:', pdfs.length > 0 ? 'PDF files saved: ' + pdfs.join(', ') : 'No PDF files saved');

await browser.close();
