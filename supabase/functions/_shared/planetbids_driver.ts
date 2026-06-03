import { chromium } from "npm:playwright-core@1.40.0";

import {
  CandidateData,
  DriverContext,
  OpportunityDriver,
  OpportunitySource,
  ScanResult,
} from "./opportunity_driver.ts";

interface RawDetailData {
  raw_title: string | null;
  due_date_raw: string | null;
  estimated_value_raw: string | null;
  license_requirements: string | null;
  county: string | null;
  commodity_codes: string[];
  scope_text: string | null;
}

interface FileManifestEntry {
  file_title: string;
  filename: string;
  file_size: number | null;
  server_full_path: string;
  server_filename: string;
}

function extractBidId(url: string): string | null {
  const m = url.match(/\/bo-detail\/(\d+)/);
  return m ? m[1] : null;
}

function parseBidDueDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

function parseEstimatedValue(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BbMmKk])?/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  const s = (m[2] ?? "").toUpperCase();
  if (s === "B") return n * 1_000_000_000;
  if (s === "M") return n * 1_000_000;
  if (s === "K") return n * 1_000;
  return n;
}

export class PlanetBidsDriver implements OpportunityDriver {
  async scan(source: OpportunitySource, ctx: DriverContext): Promise<ScanResult> {
    const { log } = ctx;
    const candidates: CandidateData[] = [];
    let errors = 0;

    const bbApiKey = Deno.env.get("BROWSERBASE_API_KEY");
    const bbProjectId = Deno.env.get("BROWSERBASE_PROJECT_ID") ?? "";

    if (!bbApiKey) {
      log(`[${source.name}] BROWSERBASE_API_KEY not configured`);
      return { candidates, errors: 1 };
    }

    // deno-lint-ignore no-explicit-any
    let browser: any = null;

    try {
      // Create Browserbase session
      log(`[${source.name}] Creating Browserbase session`);
      const sessionRes = await fetch("https://www.browserbase.com/v1/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-bb-api-key": bbApiKey,
        },
        body: JSON.stringify({ projectId: bbProjectId }),
      });

      if (!sessionRes.ok) {
        const errText = await sessionRes.text();
        log(`[${source.name}] Browserbase session failed: ${sessionRes.status} — ${errText.substring(0, 200)}`);
        return { candidates, errors: 1 };
      }

      const { id: sessionId } = await sessionRes.json();
      log(`[${source.name}] Session: ${sessionId}`);

      const wsUrl = `wss://connect.browserbase.com?apiKey=${bbApiKey}&sessionId=${sessionId}`;
      browser = await chromium.connectOverCDP(wsUrl);

      const bContext = browser.contexts()[0] ?? (await browser.newContext());
      const page = await bContext.newPage();

      // Intercept Bearer token from outgoing PlanetBids API calls.
      // Captured from the first authenticated request on the listing or detail page.
      let bearerToken: string | null = null;
      page.on("request", (req: { url(): string; headers(): Record<string, string> }) => {
        if (req.url().includes("api-external.prod.planetbids.com")) {
          const auth = req.headers()["authorization"] ?? "";
          if (auth.startsWith("Bearer ")) bearerToken = auth.slice(7);
        }
      });

      // Load listing page and wait for bid table to render
      log(`[${source.name}] Loading listing: ${source.listing_url}`);
      await page.goto(source.listing_url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForSelector("tr", { timeout: 30000 });
      await page.waitForTimeout(3000);

      const rowCount = await page.locator("tr").filter({ hasText: "Bidding" }).count();
      log(`[${source.name}] ${rowCount} Bidding row(s) found`);

      if (rowCount === 0) {
        return { candidates, errors };
      }

      // Click each Bidding row to capture the correct bo-detail URL, then extract metadata.
      // Re-navigating to listing between rows is required because the SPA re-renders on each
      // visit. Click-captured URLs are authoritative — href attributes in rendered markdown
      // are unreliable (this is why the Firecrawl path was replaced).
      for (let i = 0; i < rowCount; i++) {
        try {
          if (i > 0) {
            await page.goto(source.listing_url, { waitUntil: "domcontentloaded", timeout: 60000 });
            await page.waitForSelector("tr", { timeout: 30000 });
            await page.waitForTimeout(2000);
          }

          const rows = page.locator("tr").filter({ hasText: "Bidding" });
          const currentCount = await rows.count();
          if (i >= currentCount) {
            log(`[${source.name}] Row ${i}: no longer present (table changed?) — skipping`);
            continue;
          }

          log(`[${source.name}] Clicking row ${i + 1}/${rowCount}`);
          await rows.nth(i).click();
          await page.waitForURL("**/bo-detail/**", { timeout: 15000 });

          const detailUrl = page.url();
          const bidId = extractBidId(detailUrl);
          if (!bidId) {
            log(`[${source.name}] Row ${i}: unexpected URL after click: ${detailUrl} — skipping`);
            errors++;
            continue;
          }

          // Allow SPA to finish rendering detail fields
          await page.waitForTimeout(2000);

          // TypeScript annotations inside page.evaluate are safe in Deno: the runtime
          // compiles TS → JS before the function is ever serialized for the browser.
          const raw: RawDetailData = await page.evaluate(() => {
            const bodyText = document.body.innerText;

            const field = (label: string): string | null => {
              const re = new RegExp(label + "[:\\s]+([^\\n]{1,300})", "i");
              const m = bodyText.match(re);
              return m ? m[1].trim() || null : null;
            };

            const titleEl = document.querySelector(
              "h1, h2, [class*='title'], [class*='bid-name'], [class*='project-name']",
            ) as HTMLElement | null;
            const raw_title =
              titleEl?.innerText?.trim() ||
              field("Bid Title") ||
              field("Project Title") ||
              field("Project Name") ||
              null;

            const due_date_raw =
              field("Closing Date") ||
              field("Bid Due Date") ||
              field("Bid Due") ||
              field("Due Date") ||
              null;

            const estimated_value_raw =
              field("Estimated Value") ||
              field("Estimated Amount") ||
              field("Engineer.s Estimate") ||
              field("Project Value") ||
              null;

            const license_requirements =
              field("License Type") ||
              field("License") ||
              field("License Requirements") ||
              null;

            const county = field("County") || field("Location County") || null;

            // PlanetBids Categories section uses 91xxx commodity codes
            const commodity_codes = [
              ...new Set((bodyText.match(/\b91\d{2,4}\b/g) ?? []) as string[]),
            ];

            const scopeMatch = bodyText.match(
              /(?:Description|Scope of (?:Work|Services?|Project))[\s:\n]+([\s\S]{50,3000}?)(?:\n{2,}|\n[A-Z][a-z])/i,
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

          const crawl_data: Record<string, unknown> = {
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

          log(
            `[${source.name}] Row ${i + 1}: bid_id=${bidId} title="${(raw.raw_title ?? "").substring(0, 60)}"`,
          );
        } catch (e) {
          log(`[${source.name}] Row ${i}: error — ${e}`);
          errors++;
        }
      }

      // Fetch file manifests — best-effort only.
      // Missing bearer token is not an error; log and continue.
      if (bearerToken) {
        log(`[${source.name}] Bearer token captured — fetching ${candidates.length} manifest(s)`);
        for (const candidate of candidates) {
          const bidId = (candidate.crawl_data as Record<string, unknown>)?.bid_id as
            | string
            | undefined;
          if (!bidId) continue;
          try {
            const manifestRes = await fetch(
              `https://api-external.prod.planetbids.com/papi/bid-downloadable-files?bid_id=${bidId}`,
              {
                headers: {
                  Authorization: `Bearer ${bearerToken}`,
                  Referer: "https://vendors.planetbids.com/",
                  Origin: "https://vendors.planetbids.com",
                },
              },
            );
            if (manifestRes.ok) {
              const json = await manifestRes.json();
              const documents: FileManifestEntry[] = (json.data ?? []).map(
                (item: Record<string, unknown>) => {
                  const a = (item.attributes ?? {}) as Record<string, unknown>;
                  return {
                    file_title: String(a.fileTitle ?? a.file_title ?? ""),
                    filename: String(a.filename ?? ""),
                    file_size: typeof a.fileSize === "number" ? a.fileSize : null,
                    server_full_path: String(a.serverFullPath ?? a.server_full_path ?? ""),
                    server_filename: String(a.serverFilename ?? a.server_filename ?? ""),
                  };
                },
              );
              (candidate.crawl_data as Record<string, unknown>).documents = documents;
              log(`[${source.name}] bid_id=${bidId}: ${documents.length} document(s)`);
            } else {
              log(`[${source.name}] bid_id=${bidId}: manifest HTTP ${manifestRes.status} — skipping`);
            }
          } catch (e) {
            log(`[${source.name}] bid_id=${bidId}: manifest error — ${e}`);
          }
        }
      } else {
        log(`[${source.name}] No bearer token captured — file manifests skipped (best-effort)`);
      }

      log(`[${source.name}] Scan complete. candidates=${candidates.length} errors=${errors}`);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {
          // ignore close errors — session will expire on Browserbase side
        }
      }
    }

    return { candidates, errors };
  }
}
