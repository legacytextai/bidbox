const { chromium } = require('playwright');

const CURRENT_CALTRANS_ADVERTISEMENTS_URL = 'https://ppmoe.dot.ca.gov/cc?id=cc_advertisement';
const STALE_CALTRANS_URLS = new Set([
  'https://ppmoe.dot.ca.gov/des/oe/contract-advertisements/cs-bids.html',
]);

function normalizeCaltransListingUrl(listingUrl) {
  if (!listingUrl || STALE_CALTRANS_URLS.has(listingUrl)) {
    return CURRENT_CALTRANS_ADVERTISEMENTS_URL;
  }
  return listingUrl;
}

function parseMoney(raw) {
  if (!raw) return null;
  const cleaned = raw.replace(/[$,]/g, '').trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseCaltransBidDueDate(raw) {
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  // Caltrans advertised listings say "Bids Opening in Sacramento" but do not
  // expose a time on the list card. Store noon Pacific as a neutral sortable
  // placeholder and preserve the raw date in crawl_data for audit/display.
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 19, 0, 0));
  return date.toISOString();
}

function firstMatch(text, regex) {
  const match = text.match(regex);
  return match?.[1]?.trim() ?? null;
}

function parseCounty(locationText, routeLine) {
  const source = `${locationText ?? ''}\n${routeLine ?? ''}`;
  const cityCountyMatch = source.match(/\bCITY AND COUNTY OF\s+([A-Z][A-Z\s]+?)(?:\s+FROM|\s+AT|\s+NEAR|\s+ON|\n|$)/);
  if (cityCountyMatch?.[1]) {
    return cityCountyMatch[1].trim().replace(/\s+/g, ' ');
  }

  const countyMatch = source.match(/\b(?:IN\s+)?([A-Z][A-Z\s,]+?)\s+COUNT(?:Y|IES)\b/);
  if (countyMatch?.[1]) {
    return countyMatch[1]
      .split(',')
      .map((part) => part.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join(', ');
  }

  const routeCounty = routeLine?.match(/^\d{2}-([A-Za-z]{2,3}(?:,[A-Za-z]{2,3})?)-/);
  return routeCounty?.[1] ?? null;
}

function parseCaltransCard(card) {
  const { titleText, href, text } = card;
  const titleMatch = titleText.match(/^([0-9]{2}-[A-Z0-9]+)\s*-\s*(.+)$/i);
  if (!titleMatch) return null;

  const contractNumber = titleMatch[1].toUpperCase();
  const projectTitle = titleMatch[2].trim();
  const district = contractNumber.slice(0, 2);
  const routeLine = firstMatch(text, /^(\d{2}-[A-Za-z]{2,3}(?:,[A-Za-z]{2,3})?-[^\n]+?)\s+\*\s+Date Advertised\s+\d{4}-\d{2}-\d{2}/m);
  const advertisedAtRaw = firstMatch(text, /Date Advertised\s+(\d{4}-\d{2}-\d{2})/);
  const bidDueRaw = firstMatch(text, /Bids Open\s+(\d{4}-\d{2}-\d{2})(?:\s+\([^)]+\))?/);
  const bidDueLabel = firstMatch(text, /(Bids Open\s+\d{4}-\d{2}-\d{2}(?:\s+\([^)]+\))?)/);
  const estimateRaw = firstMatch(text, /Estimate:\s*([$0-9,.]+)/);
  const location = firstMatch(text, /(^In\s+[^\n]+(?:\n(?!The Contractor|Subs\/Suppliers|Planholders|Bid Book|List of Bid Items|\[\d+\]|Download Files)[^\n]+)*)/m);
  const licenseRequirements = firstMatch(text, /(The Contractor must have[^\n]+)/);
  const contractDuration = firstMatch(text, /(\d[\d,]*\s+Working Days)/);
  const goalRequirement = firstMatch(text, /\d[\d,]*\s+Working Days\s+\*\s+([^\n]+)/);
  const hasMandatoryPreBid = /mandatory pre-bid meeting/i.test(text);
  const addendaCountRaw = firstMatch(text, /See\s+\[(\d+)\]\s+Addendum\(s\)/i);
  const bidderInquiriesRaw = firstMatch(text, /\[(\d+)\]\s+Bidder Inquiries/i);

  return {
    contract_number: contractNumber,
    project_title: projectTitle,
    raw_title: `${contractNumber} - ${projectTitle}`,
    source_url: href,
    bid_due_at: parseCaltransBidDueDate(bidDueRaw),
    crawl_data: {
      source: 'caltrans_contractors_corner',
      listing_url: CURRENT_CALTRANS_ADVERTISEMENTS_URL,
      contract_number: contractNumber,
      project_title: projectTitle,
      district,
      route_line: routeLine,
      date_advertised_raw: advertisedAtRaw,
      bid_due_raw: bidDueRaw,
      bid_due_label: bidDueLabel,
      bid_due_time_available: false,
      bid_due_time_note: bidDueRaw ? 'Caltrans advertised listing exposes bid opening date but not time in the list card.' : null,
      engineer_estimate_raw: estimateRaw,
      engineer_estimate: parseMoney(estimateRaw),
      county: parseCounty(location, routeLine),
      location,
      license_requirements: licenseRequirements,
      contract_duration: contractDuration,
      goal_requirement: goalRequirement,
      mandatory_pre_bid_meeting: hasMandatoryPreBid,
      addenda_count: addendaCountRaw ? Number(addendaCountRaw) : 0,
      bidder_inquiries_count: bidderInquiriesRaw ? Number(bidderInquiriesRaw) : 0,
      extracted_at: new Date().toISOString(),
      extraction_method: 'caltrans_v1_rendered_card',
      document_acquisition_supported: false,
    },
  };
}

async function launchBrowser() {
  const executablePath = process.env.CALTRANS_CHROME_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (executablePath) {
    return chromium.launch({ headless: true, executablePath });
  }
  return chromium.launch({ headless: true });
}

async function scrapeCaltrans(source, log = console.log) {
  const listingUrl = normalizeCaltransListingUrl(source.listing_url);
  const candidates = [];
  const errorMessages = [];
  let browser;

  const recordError = (message) => {
    errorMessages.push(message);
    log(`[${source.source_name}] ${message}`);
  };

  try {
    log(`[${source.source_name}] Opening Caltrans Contractors Corner: ${listingUrl}`);
    browser = await launchBrowser();
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
    });

    await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('a[href*="cc_advertisement_details"][href*="ad_id="]'))
        .some((anchor) => /^\d{2}-/.test(anchor.innerText.trim()));
    }, { timeout: 45000 });
    await page.waitForTimeout(1500);

    const cards = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a[href*="cc_advertisement_details"][href*="ad_id="]'))
        .filter((anchor) => /^\d{2}-/.test(anchor.innerText.trim()))
        .map((anchor) => {
          const container = anchor.closest('li') ?? anchor.parentElement;
          return {
            titleText: anchor.innerText.trim(),
            href: anchor.href,
            text: container?.innerText ?? anchor.innerText,
          };
        });
    });

    log(`[${source.source_name}] Caltrans cards found: ${cards.length}`);

    const seen = new Set();
    for (const card of cards) {
      try {
        const candidate = parseCaltransCard(card);
        if (!candidate) {
          recordError(`Unable to parse Caltrans card title: ${card.titleText}`);
          continue;
        }
        if (seen.has(candidate.source_url)) continue;
        seen.add(candidate.source_url);
        candidates.push(candidate);
        log(`[${source.source_name}] Parsed Caltrans opportunity ${candidate.crawl_data.contract_number}: ${candidate.crawl_data.project_title}`);
      } catch (e) {
        recordError(`Caltrans card parse failed: ${e.message}`);
      }
    }
  } catch (e) {
    recordError(`Caltrans scrape failed: ${e.message}`);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  return {
    candidates,
    errors: errorMessages.length,
    errorMessages,
  };
}

module.exports = {
  CURRENT_CALTRANS_ADVERTISEMENTS_URL,
  normalizeCaltransListingUrl,
  parseCaltransBidDueDate,
  parseCaltransCard,
  scrapeCaltrans,
};
