const { chromium } = require('playwright');

function extractBidId(url) {
  const m = url.match(/\/bo-detail\/(\d+)/);
  return m ? m[1] : null;
}

function parseBidDueDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function parseEstimatedValue(raw) {
  if (!raw) return null;
  const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BbMmKk])?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  const s = (m[2] ?? '').toUpperCase();
  if (s === 'B') return n * 1_000_000_000;
  if (s === 'M') return n * 1_000_000;
  if (s === 'K') return n * 1_000;
  return n;
}

async function scrapePlanetBids(payload, log) {
  const { source_name, listing_url } = payload;
  const candidates = [];
  let errors = 0;

  const bbApiKey = process.env.BROWSERBASE_API_KEY;
  const bbProjectId = process.env.BROWSERBASE_PROJECT_ID ?? '';

  if (!bbApiKey) {
    log(`[${source_name}] BROWSERBASE_API_KEY not configured`);
    return { candidates, errors: 1 };
  }

  let browser = null;

  // FIX 4: 10-minute outer guard — returns partial results on timeout
  const TIMEOUT_MS = 10 * 60 * 1000;
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error('Scrape timed out after 10 minutes')),
      TIMEOUT_MS
    );
  });

  try {
    await Promise.race([
      (async () => {
        log(`[${source_name}] Creating Browserbase session`);
        const sessionRes = await fetch('https://www.browserbase.com/v1/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-bb-api-key': bbApiKey,
          },
          body: JSON.stringify({ projectId: bbProjectId }),
        });

        if (!sessionRes.ok) {
          const errText = await sessionRes.text();
          log(`[${source_name}] Browserbase session failed: ${sessionRes.status} — ${errText.substring(0, 200)}`);
          errors++;
          return;
        }

        const { id: sessionId } = await sessionRes.json();
        log(`[${source_name}] Session: ${sessionId}`);

        const wsUrl = `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`;
        browser = await chromium.connectOverCDP(wsUrl);

        const bContext = browser.contexts()[0] ?? (await browser.newContext());
        const page = await bContext.newPage();

        let bearerToken = null;
        page.on('request', (req) => {
          if (req.url().includes('api-external.prod.planetbids.com')) {
            const auth = req.headers()['authorization'] ?? '';
            if (auth.startsWith('Bearer ')) bearerToken = auth.slice(7);
          }
        });

        log(`[${source_name}] Loading listing: ${listing_url}`);
        await page.goto(listing_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('tr', { timeout: 30000 });
        await page.waitForTimeout(3000);

        const rowCount = await page.locator('tr').filter({ hasText: 'Bidding' }).count();
        log(`[${source_name}] ${rowCount} Bidding row(s) found`);

        if (rowCount === 0) return;

        for (let i = 0; i < rowCount; i++) {
          try {
            if (i > 0) {
              await page.goto(listing_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await page.waitForSelector('tr', { timeout: 45000 });
              await page.waitForTimeout(4000 + Math.floor(Math.random() * 1000)); // FIX 4: jitter
            }

            const rows = page.locator('tr').filter({ hasText: 'Bidding' });
            const currentCount = await rows.count();
            if (i >= currentCount) {
              log(`[${source_name}] Row ${i}: no longer present — skipping`);
              continue;
            }

            log(`[${source_name}] Clicking row ${i + 1}/${rowCount}`);
            await rows.nth(i).click();
            await page.waitForURL('**/bo-detail/**', { timeout: 25000 });

            const detailUrl = page.url();
            const bidId = extractBidId(detailUrl);
            if (!bidId) {
              log(`[${source_name}] Row ${i}: unexpected URL after click: ${detailUrl} — skipping`);
              errors++;
              continue;
            }

            await page.waitForTimeout(1000 + Math.floor(Math.random() * 1000)); // FIX 4: jitter

            const raw = await page.evaluate(() => {
              const bodyText = document.body.innerText;

              const field = (label) => {
                const re = new RegExp(label + '[:\\s]+([^\\n]{1,300})', 'i');
                const m = bodyText.match(re);
                return m ? m[1].trim() || null : null;
              };

              // FIX 1: strip navigation chrome from extracted title
              const cleanTitle = (t) => {
                if (!t) return null;
                return t
                  .replace(/\s*Add to My Bids[\s\S]*/i, '')
                  .replace(/\s*REMAINING[\s\S]*/i, '')
                  .replace(/\s+(?:[A-Z]{1,4}-\d{2}-\d{3,5}|\d{2,4}-\d{3,5})\s*$/, '')
                  .trim() || null;
              };

              const titleEl = document.querySelector(
                "h1, h2, [class*='title'], [class*='bid-name'], [class*='project-name']"
              );
              const raw_title = cleanTitle(
                (titleEl && titleEl.innerText && titleEl.innerText.trim()) ||
                field('Bid Title') ||
                field('Project Title') ||
                field('Project Name') ||
                null
              );

              const due_date_raw =
                field('Closing Date') ||
                field('Bid Due Date') ||
                field('Bid Due') ||
                field('Due Date') ||
                null;

              const estimated_value_raw =
                field('Estimated Value') ||
                field('Estimated Amount') ||
                field("Engineer's Estimate") ||
                field('Project Value') ||
                null;

              const license_requirements =
                field('License Type') ||
                field('License') ||
                field('License Requirements') ||
                null;

              const county = field('County') || field('Location County') || null;

              const commodity_codes = [
                ...new Set((bodyText.match(/\b91\d{2,4}\b/g) ?? [])),
              ];

              const scopeMatch = bodyText.match(
                /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i
              );
              const scope_text = scopeMatch ? scopeMatch[1].trim().substring(0, 3000) : null;

              return {
                raw_title: raw_title ? raw_title.substring(0, 500) : null,
                due_date_raw,
                estimated_value_raw,
                license_requirements,
                county,
                commodity_codes,
                scope_text,
              };
            });

            // FIX 2: skip non-construction bids when codes are present and none are 91xxx
            if (raw.commodity_codes.length > 0) {
              const isConstruction = raw.commodity_codes.some((c) => {
                const n = parseInt(c, 10);
                return n >= 91000 && n <= 91999;
              });
              if (!isConstruction) {
                log(`[${source_name}] Skipping non-construction bid: ${(raw.raw_title ?? '').substring(0, 60)} (codes: ${raw.commodity_codes.join(', ')})`);
                continue;
              }
            }

            const crawl_data = {
              bid_id: bidId,
              estimated_value: parseEstimatedValue(raw.estimated_value_raw),
              license_requirements: raw.license_requirements,
              county: raw.county,
              commodity_codes: raw.commodity_codes,
              scope_text: raw.scope_text,
              scraped_at: new Date().toISOString(),
            };

            candidates.push({
              source_url: detailUrl,
              raw_title: raw.raw_title,
              bid_due_at: parseBidDueDate(raw.due_date_raw),
              crawl_data,
            });

            log(`[${source_name}] Row ${i + 1}: bid_id=${bidId} title="${(raw.raw_title ?? '').substring(0, 60)}"`);
          } catch (e) {
            log(`[${source_name}] Row ${i}: error — ${e.message}`);
            errors++;
          }
        }

        if (bearerToken) {
          log(`[${source_name}] Bearer token captured — fetching ${candidates.length} manifest(s)`);
          for (const candidate of candidates) {
            const bidId = candidate.crawl_data?.bid_id;
            if (!bidId) continue;
            try {
              const manifestRes = await fetch(
                `https://api-external.prod.planetbids.com/papi/bid-downloadable-files?bid_id=${bidId}`,
                {
                  headers: {
                    Authorization: `Bearer ${bearerToken}`,
                    Referer: 'https://vendors.planetbids.com/',
                    Origin: 'https://vendors.planetbids.com',
                  },
                }
              );
              if (manifestRes.ok) {
                const json = await manifestRes.json();
                const documents = (json.data ?? []).map((item) => {
                  const a = item.attributes ?? {};
                  return {
                    file_title: String(a.fileTitle ?? a.file_title ?? ''),
                    filename: String(a.filename ?? ''),
                    file_size: typeof a.fileSize === 'number' ? a.fileSize : null,
                    server_full_path: String(a.serverFullPath ?? a.server_full_path ?? ''),
                    server_filename: String(a.serverFilename ?? a.server_filename ?? ''),
                  };
                });
                candidate.crawl_data.documents = documents;
                log(`[${source_name}] bid_id=${bidId}: ${documents.length} document(s)`);
              } else {
                log(`[${source_name}] bid_id=${bidId}: manifest HTTP ${manifestRes.status} — skipping`);
              }
            } catch (e) {
              log(`[${source_name}] bid_id=${bidId}: manifest error — ${e.message}`);
            }
          }
        } else {
          log(`[${source_name}] No bearer token captured — file manifests skipped`);
        }

        log(`[${source_name}] Scan complete. candidates=${candidates.length} errors=${errors}`);
      })(),
      timeoutPromise,
    ]);
  } catch (e) {
    if (e.message.includes('timed out')) {
      log(`[${source_name}] ${e.message} — returning ${candidates.length} partial result(s)`);
    } else {
      log(`[${source_name}] Scrape error: ${e.message}`);
      errors++;
    }
  } finally {
    clearTimeout(timeoutHandle);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }

  return { candidates, errors };
}

module.exports = { scrapePlanetBids };
