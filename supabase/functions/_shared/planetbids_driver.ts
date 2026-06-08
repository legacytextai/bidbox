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
  return parseEstimatedValueDetails(raw).estimated_value;
}

function parseMoneyToken(token: string | null | undefined): number | null {
  if (!token) return null;
  const cleaned = token.replace(/\s+/g, " ").trim();
  const hasDollar = cleaned.includes("$");
  const hasComma = cleaned.includes(",");
  const unitMatch = cleaned.match(/([KMB])\b|\b(thousand|million|billion)\b/i);
  const numberMatch = cleaned.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!numberMatch) return null;

  const n = parseFloat(numberMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;

  const unit = (unitMatch?.[1] ?? unitMatch?.[2] ?? "").toLowerCase();
  let value = n;
  if (unit === "b" || unit === "billion") value = n * 1_000_000_000;
  if (unit === "m" || unit === "million") value = n * 1_000_000;
  if (unit === "k" || unit === "thousand") value = n * 1_000;

  if (!hasDollar && !hasComma && !unit && value < 10000) return null;
  return Math.round(value);
}

function parseEstimatedValueDetails(raw: string | null | undefined): {
  estimated_value: number | null;
  estimated_value_raw: string | null;
  estimated_value_low: number | null;
  estimated_value_high: number | null;
} {
  if (!raw) {
    return {
      estimated_value: null,
      estimated_value_raw: null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const text = String(raw).replace(/\s+/g, " ").trim();
  const moneyPattern = /(?:\$+\s*)?\d[\d,]*(?:\.\d+)?\s*(?:[KkMmBb]|thousand|million|billion)?/g;
  const values = [...text.matchAll(moneyPattern)]
    .map((m) => ({ raw: m[0].trim(), value: parseMoneyToken(m[0]) }))
    .filter((m): m is { raw: string; value: number } => m.value !== null);

  if (values.length === 0) {
    return {
      estimated_value: null,
      estimated_value_raw: text || null,
      estimated_value_low: null,
      estimated_value_high: null,
    };
  }

  const first = values[0].value;
  const second = values[1]?.value ?? null;
  if (second !== null && /(?:-|–|—|\bto\b|\band\b|\bbetween\b)/i.test(text)) {
    const low = Math.min(first, second);
    const high = Math.max(first, second);
    return {
      estimated_value: Math.round((low + high) / 2),
      estimated_value_raw: text,
      estimated_value_low: low,
      estimated_value_high: high,
    };
  }

  return {
    estimated_value: first,
    estimated_value_raw: text,
    estimated_value_low: null,
    estimated_value_high: null,
  };
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
      const biddingRows = () =>
        page.locator("tr, [role='row']").filter({ has: page.getByText(/^Bidding$/) });

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
      await page.waitForSelector("body", { timeout: 30000 });
      await page.waitForTimeout(3000);

      const rowCount = await biddingRows().count();
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
            await page.waitForSelector("body", { timeout: 30000 });
            await page.waitForTimeout(2000);
          }

          const rows = biddingRows();
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

            const findEstimateRaw = (): string | null => {
              const labels = [
                "Engineer's Estimate",
                "Engineers Estimate",
                "Estimated Value",
                "Estimated Amount",
                "Estimated Cost",
                "Estimate Range",
                "Project Estimate",
                "Project Value",
                "Construction Estimate",
                "Cost Estimate",
                "Budget",
              ];

              for (const label of labels) {
                const direct = field(label);
                if (direct) return `${label}: ${direct}`;
              }

              const normalized = bodyText.replace(/\s+/g, " ");
              const labelPattern = labels
                .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "'?"))
                .join("|");
              const moneyPattern =
                "(?:\\$\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*(?:[KkMmBb]|thousand|million|billion)?";
              const re = new RegExp(
                `(?:${labelPattern})\\s*[:\\-]?\\s*(?:between\\s+)?(${moneyPattern}(?:\\s*(?:-|–|—|to|and)\\s*${moneyPattern})?)`,
                "i",
              );
              const m = normalized.match(re);
              return m ? m[0].trim().substring(0, 300) : null;
            };

            const estimated_value_raw = findEstimateRaw();

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

          const estimate = parseEstimatedValueDetails(raw.estimated_value_raw);
          const crawl_data: Record<string, unknown> = {
            bid_id: bidId,
            estimated_value: estimate.estimated_value,
            estimated_value_raw: estimate.estimated_value_raw,
            estimated_value_low: estimate.estimated_value_low,
            estimated_value_high: estimate.estimated_value_high,
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
