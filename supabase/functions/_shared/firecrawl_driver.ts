import { CandidateData, DriverContext, OpportunityDriver, OpportunitySource, ScanResult } from "./opportunity_driver.ts";

interface PlanetBidsOpportunity {
  title: string;
  invitation_number: string | null;
  bid_id: string | null;
  due_date: string | null;
}

interface GenericOpportunity {
  url: string;
  title: string;
  bid_due_date: string | null;
}

function extractPortalId(url: string): string | null {
  const match = url.match(/\/portal\/(\d+)\//);
  return match ? match[1] : null;
}

function buildPlanetBidsDetailUrl(portalId: string, bidId: string): string {
  return `https://vendors.planetbids.com/portal/${portalId}/bo/bo-detail/${bidId}`;
}

function isValidCandidateUrl(url: string, listingUrl: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    if (url === listingUrl) return false;
    const hasQuery = parsed.search.length > 1;
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const hasDeepPath = pathSegments.length >= 2;
    return hasQuery || hasDeepPath;
  } catch {
    return false;
  }
}

function parseBidDueDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    if (raw.includes("T")) {
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const [year, month, day] = raw.split("-").map(Number);
    if (!year || !month || !day) return null;
    // Treat bare date as noon PST (UTC-8) = 20:00 UTC
    const d = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

export class FirecrawlDriver implements OpportunityDriver {
  async scan(source: OpportunitySource, ctx: DriverContext): Promise<ScanResult> {
    const { log, firecrawlApiKey, lovableApiKey } = ctx;
    const candidates: CandidateData[] = [];
    let errors = 0;

    // PlanetBids requires portal ID extracted from listing URL
    let portalId: string | null = null;
    if (source.portal_type === "planetbids") {
      portalId = extractPortalId(source.listing_url);
      if (!portalId) {
        log(`[${source.name}] Could not extract portal ID from URL — skipping`);
        return { candidates, errors: 1 };
      }
      log(`[${source.name}] Portal ID: ${portalId}`);
    }

    // Firecrawl scrape — PlanetBids pages need more time to render
    const waitFor = source.portal_type === "planetbids" ? 8000 : 5000;
    log(`[${source.name}] Scraping listing (waitFor=${waitFor}ms): ${source.listing_url}`);

    let markdown = "";
    try {
      const scrapeResponse = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${firecrawlApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: source.listing_url,
          formats: ["markdown"],
          onlyMainContent: true,
          waitFor,
        }),
      });

      const scrapeData = await scrapeResponse.json();
      if (!scrapeResponse.ok || !scrapeData.success) {
        log(`[${source.name}] Firecrawl scrape failed: ${JSON.stringify(scrapeData).substring(0, 300)}`);
        return { candidates, errors: 1 };
      }

      markdown = scrapeData.data?.markdown || scrapeData.markdown || "";
      log(`[${source.name}] Scraped ${markdown.length} chars`);
    } catch (e) {
      log(`[${source.name}] Firecrawl fetch error: ${e}`);
      return { candidates, errors: 1 };
    }

    if (markdown.length < 100) {
      log(`[${source.name}] Markdown too short, likely empty page`);
      return { candidates, errors: 1 };
    }

    log(`[${source.name}] Running LLM extraction...`);

    if (source.portal_type === "planetbids") {
      let opportunities: PlanetBidsOpportunity[] = [];

      try {
        const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are extracting bid opportunities from a PlanetBids listing page.
Extract ONLY rows where Stage = Bidding.
Do NOT return rows where Stage is Closed, Rejected, Awarded, or any value other than Bidding.
For each qualifying row, find the bid_id by looking for href links in the format /bo-detail/{number} embedded in the page content. The invitation_number alone (e.g. GP-26-0016) does NOT contain the numeric bid_id — it must come from a /bo-detail/{number} link. If no such link is found for a row, set bid_id to null.`,
              },
              {
                role: "user",
                content: `Extract all active bidding opportunities from this PlanetBids listing page.\n\nSOURCE URL: ${source.listing_url}\n\nCONTENT:\n${markdown.substring(0, 15000)}`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "extract_planetbids_opportunities",
                  description: "Extract active bidding opportunities from a PlanetBids listing page",
                  parameters: {
                    type: "object",
                    properties: {
                      opportunities: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string", description: "Bid title as shown on the listing" },
                            invitation_number: { type: "string", description: "Invitation or solicitation number (e.g. GP-26-0016)" },
                            bid_id: { type: "string", description: "Numeric ID found in a /bo-detail/{number} href link on the page. NOT derived from the invitation_number. Null if no such link is found." },
                            due_date: { type: "string", description: "Bid closing date in YYYY-MM-DD format if shown, otherwise null" },
                          },
                          required: ["title"],
                        },
                      },
                    },
                    required: ["opportunities"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "extract_planetbids_opportunities" } },
          }),
        });

        if (!llmResponse.ok) {
          const errText = await llmResponse.text();
          log(`[${source.name}] LLM request failed: ${llmResponse.status} ${errText.substring(0, 300)}`);
          return { candidates, errors: 1 };
        }

        const llmData = await llmResponse.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          opportunities = parsed.opportunities || [];
          log(`[${source.name}] LLM returned ${opportunities.length} raw items`);
        }
      } catch (e) {
        log(`[${source.name}] LLM error: ${e}`);
        return { candidates, errors: 1 };
      }

      for (const opp of opportunities) {
        if (!opp.bid_id) {
          log(`[${source.name}] Skipped — no bid_id for: ${opp.invitation_number ?? opp.title}`);
          continue;
        }
        candidates.push({
          source_url: buildPlanetBidsDetailUrl(portalId!, opp.bid_id),
          raw_title: opp.title?.substring(0, 500) || null,
          bid_due_at: parseBidDueDate(opp.due_date),
        });
      }
    } else {
      // Generic path for non-PlanetBids portals
      let opportunities: GenericOpportunity[] = [];

      try {
        const llmResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${lovableApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              {
                role: "system",
                content: `You are a web scraper assistant. Extract a list of individual bid or project opportunities from a public procurement listing page. Each item must be a distinct project with its own detail page URL. Do not return category links, navigation links, search filters, or the listing page URL itself. Only return items that are clearly individual solicitations or contracts.`,
              },
              {
                role: "user",
                content: `Extract all individual project opportunities from this procurement listing page.\n\nSOURCE URL: ${source.listing_url}\n\nCONTENT:\n${markdown.substring(0, 15000)}`,
              },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "extract_opportunity_list",
                  description: "Extract a list of individual procurement opportunities from a listing page",
                  parameters: {
                    type: "object",
                    properties: {
                      opportunities: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            url: { type: "string", description: "Full absolute URL to the individual project detail page" },
                            title: { type: "string", description: "Project or bid title as shown on the listing" },
                            bid_due_date: { type: "string", description: "Bid closing or due date in YYYY-MM-DD format if shown, otherwise null" },
                          },
                          required: ["url", "title"],
                        },
                      },
                    },
                    required: ["opportunities"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "extract_opportunity_list" } },
          }),
        });

        if (!llmResponse.ok) {
          const errText = await llmResponse.text();
          log(`[${source.name}] LLM request failed: ${llmResponse.status} ${errText.substring(0, 300)}`);
          return { candidates, errors: 1 };
        }

        const llmData = await llmResponse.json();
        const toolCall = llmData.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          const parsed = JSON.parse(toolCall.function.arguments);
          opportunities = parsed.opportunities || [];
          log(`[${source.name}] LLM returned ${opportunities.length} raw items`);
        }
      } catch (e) {
        log(`[${source.name}] LLM error: ${e}`);
        return { candidates, errors: 1 };
      }

      for (const opp of opportunities) {
        if (!opp.url || !isValidCandidateUrl(opp.url, source.listing_url)) {
          log(`[${source.name}] Skipped invalid URL: ${opp.url}`);
          continue;
        }
        candidates.push({
          source_url: opp.url,
          raw_title: opp.title?.substring(0, 500) || null,
          bid_due_at: parseBidDueDate(opp.bid_due_date),
        });
      }
    }

    return { candidates, errors };
  }
}
