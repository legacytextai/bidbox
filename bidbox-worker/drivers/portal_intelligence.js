'use strict';
/**
 * Portal Intelligence Driver
 *
 * Generates a lightweight opportunity summary from portal metadata only.
 * Does NOT download documents, chunk text, run embeddings, or call F4.
 *
 * Inputs:
 *   - OML normalized columns (estimated_value, county, project_address, ...)
 *   - crawl_data (ALL fields captured during scan)
 *   - portal-native bid items (from opportunity_bid_items)
 *   - source agency name and portal type
 *   - optionally: scraped public page text from Browserbase (best-effort)
 *
 * Output:
 *   - A short plain-text executive summary stored in
 *     opportunity_candidates.portal_summary
 *
 * Cost: one small OpenAI call per opportunity (~300-600 input tokens).
 * This is the "before Analyze Project" layer. After F4 runs, the UI
 * should prefer the richer F4 executive summary over this one.
 */

const { chromium } = require('playwright');

const AI_GATEWAY_URL =
  process.env.PROJECT_INTELLIGENCE_AI_URL ||
  'https://api.openai.com/v1/chat/completions';

const PORTAL_INTELLIGENCE_MODEL =
  process.env.PORTAL_INTELLIGENCE_MODEL ||
  process.env.PROJECT_INTELLIGENCE_MODEL ||
  'gpt-4.1-mini';

const BROWSERBASE_API_KEY = process.env.BROWSERBASE_API_KEY;
const BROWSERBASE_PROJECT_ID = process.env.BROWSERBASE_PROJECT_ID;

function formatCurrency(value) {
  if (!value || typeof value !== 'number') return null;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000)         return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

// Pretty-print a crawl_data key as a human-readable label.
function crawlKeyLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildPortalContext(candidate, bidItems = [], scrapedPageText = null) {
  const crawl = candidate.crawl_data ?? {};
  const lines = [];

  // ── Core identity ──────────────────────────────────────────────────────────
  lines.push(`Agency: ${candidate.agency ?? 'Unknown'}`);
  lines.push(`Title: ${candidate.raw_title ?? 'Unknown'}`);
  lines.push(`Portal: ${candidate.portal_type ?? 'Unknown'}`);

  if (candidate.bid_due_at) {
    const due = new Date(candidate.bid_due_at);
    if (!isNaN(due.getTime())) {
      lines.push(`Bid Due: ${due.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}`);
    }
  }

  const valueStr = formatCurrency(candidate.estimated_value) ??
    formatCurrency(crawl.estimated_value) ??
    formatCurrency(crawl.engineer_estimate);
  if (valueStr) lines.push(`Estimated Value: ${valueStr}`);

  if (candidate.county)             lines.push(`County: ${candidate.county}`);
  if (candidate.project_address)    lines.push(`Location: ${candidate.project_address}`);
  if (candidate.portal_bid_id)      lines.push(`Bid/Contract No: ${candidate.portal_bid_id}`);
  if (candidate.portal_department)  lines.push(`Department: ${candidate.portal_department}`);

  // ── Scope ──────────────────────────────────────────────────────────────────
  if (crawl.scope_text) lines.push(`Scope: ${String(crawl.scope_text).substring(0, 800)}`);

  // ── Procurement details ────────────────────────────────────────────────────
  if (crawl.license_requirements)  lines.push(`License Requirements: ${crawl.license_requirements}`);
  if (crawl.contract_duration)     lines.push(`Contract Duration: ${crawl.contract_duration}`);
  if (crawl.liquidated_damages)    lines.push(`Liquidated Damages: ${crawl.liquidated_damages}`);
  if (crawl.bid_validity)          lines.push(`Bid Validity: ${crawl.bid_validity}`);
  if (crawl.delivery_dates)        lines.push(`Delivery/Completion Dates: ${crawl.delivery_dates}`);
  if (crawl.commodity_codes)       lines.push(`Commodity Codes: ${crawl.commodity_codes}`);
  if (crawl.additional_details)    lines.push(`Additional Details: ${String(crawl.additional_details).substring(0, 400)}`);

  // ── Pre-bid / job walk ─────────────────────────────────────────────────────
  const meetingExists =
    crawl.pre_bid_exists === 'Yes' || crawl.pre_bid_meeting === 'Yes' || crawl.job_walk_exists === 'Yes';
  const attendanceRequired = crawl.attendance_required ?? crawl.job_walk_mandatory ?? null;

  if (meetingExists) {
    const parts = ['Pre-Bid/Job Walk: Yes'];
    if (attendanceRequired)          parts.push(`Attendance Required: ${attendanceRequired}`);
    if (crawl.meeting_type)          parts.push(`Type: ${crawl.meeting_type}`);
    if (crawl.pre_bid_meeting_at)    parts.push(`Date: ${crawl.pre_bid_meeting_at}`);
    if (crawl.job_walk_at)           parts.push(`Date: ${crawl.job_walk_at}`);
    if (crawl.pre_bid_location)      parts.push(`Location: ${crawl.pre_bid_location}`);
    if (crawl.meeting_location)      parts.push(`Location: ${crawl.meeting_location}`);
    if (crawl.meeting_link)          parts.push(`Link: ${crawl.meeting_link}`);
    if (crawl.pre_bid_meeting_link)  parts.push(`Link: ${crawl.pre_bid_meeting_link}`);
    if (crawl.pre_bid_notes)         parts.push(`Notes: ${String(crawl.pre_bid_notes).substring(0, 200)}`);
    lines.push(parts.join(', '));
  } else if (crawl.pre_bid_exists === 'No' || crawl.pre_bid_meeting === 'No') {
    lines.push('Pre-Bid/Job Walk: No');
  }

  // ── Section-scoped job walk (PlanetBids specialty) ─────────────────────────
  if (crawl.section_scoped_job_walk_at) {
    const parts = [`Section-Scoped Job Walk: ${crawl.section_scoped_job_walk_at}`];
    if (crawl.section_scoped_attendance_required) parts.push(`Attendance Required: ${crawl.section_scoped_attendance_required}`);
    if (crawl.section_scoped_job_walk_details)    parts.push(String(crawl.section_scoped_job_walk_details).substring(0, 200));
    lines.push(parts.join(', '));
  }

  // ── Bid items ──────────────────────────────────────────────────────────────
  if (bidItems.length > 0) {
    lines.push(`\nBid Items (${bidItems.length} line items):`);
    const show = bidItems.slice(0, 20);
    for (const item of show) {
      const parts = [
        item.item_number ? `#${item.item_number}` : null,
        item.description,
        item.quantity_raw ? `Qty: ${item.quantity_raw}` : null,
        item.unit_of_measure ?? null,
      ].filter(Boolean);
      lines.push(`  - ${parts.join(' | ')}`);
    }
    if (bidItems.length > 20) lines.push(`  ... and ${bidItems.length - 20} more`);
  }

  // ── Scraped page text (browser capture, best-effort) ──────────────────────
  if (scrapedPageText) {
    lines.push(`\nPortal Page Content (scraped):\n${scrapedPageText.substring(0, 2000)}`);
  }

  return lines.join('\n');
}

// ── Browser tab scraping ───────────────────────────────────────────────────────
// Opens a Browserbase session and reads public-facing tab text from the portal
// page without logging in. Best-effort: returns null on any failure.

async function scrapePublicPortalTabs(sourceUrl, log = () => {}) {
  if (!BROWSERBASE_API_KEY || !BROWSERBASE_PROJECT_ID) return null;
  if (!sourceUrl) return null;

  let browser = null;
  let sessionId = null;

  try {
    // Create Browserbase session.
    const sessionResp = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: {
        'x-bb-api-key': BROWSERBASE_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId: BROWSERBASE_PROJECT_ID }),
    });
    if (!sessionResp.ok) {
      log(`portal_intelligence: Browserbase session create failed (${sessionResp.status}) — skipping tab scrape`);
      return null;
    }
    const sessionData = await sessionResp.json();
    sessionId = sessionData.id;

    browser = await chromium.connectOverCDP(
      `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}&sessionId=${sessionId}`,
    );
    const page = (await browser.contexts())[0]?.pages()[0] ?? await browser.newPage();

    // Navigate to the opportunity page.
    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(2000);

    const segments = [];

    // Collect visible body text from the current view (covers Overview/Details tabs).
    const mainText = await page.evaluate(() => {
      const body = document.body;
      if (!body) return '';
      // Remove script/style noise.
      const cloned = body.cloneNode(true);
      cloned.querySelectorAll('script,style,nav,header,footer').forEach((el) => el.remove());
      return (cloned.textContent ?? '').replace(/\s{2,}/g, ' ').trim().substring(0, 3000);
    });
    if (mainText) segments.push(mainText);

    // Try to click through visible tab buttons (Overview, Description, Pre-Bid, Contacts, Addenda).
    const tabSelectors = [
      'button[data-tab], [role="tab"], .tab-button, .nav-tabs a, .opportunity-tab',
    ];
    let tabs = [];
    for (const sel of tabSelectors) {
      tabs = await page.$$(sel);
      if (tabs.length > 0) break;
    }

    const NON_DOCUMENT_TAB_LABELS = /overview|description|scope|details|pre.?bid|contacts?|addenda/i;
    for (const tab of tabs.slice(0, 8)) {
      try {
        const label = await tab.textContent();
        if (!label || !NON_DOCUMENT_TAB_LABELS.test(label)) continue;
        await tab.click();
        await page.waitForTimeout(1000);
        const tabText = await page.evaluate(() => {
          const main = document.querySelector('main, [role="main"], .tab-content, .opportunity-content');
          const el = main ?? document.body;
          return (el.textContent ?? '').replace(/\s{2,}/g, ' ').trim().substring(0, 1000);
        });
        if (tabText && !segments.some((s) => s.includes(tabText.substring(0, 100)))) {
          segments.push(`[${label.trim()}]: ${tabText}`);
        }
      } catch { /* skip tab on any error */ }
    }

    log(`portal_intelligence: scraped ${segments.length} page section(s) from ${sourceUrl}`);
    return segments.join('\n\n') || null;
  } catch (err) {
    log(`portal_intelligence: tab scrape failed (${err?.message ?? err}) — continuing without it`);
    return null;
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }
}

const SYSTEM_PROMPT = `You are a construction estimating assistant helping a California general contractor quickly evaluate public works opportunities.

You will receive portal metadata about a bidding opportunity. Write a concise executive summary (3-5 sentences) that:
1. Describes what the project is and its key scope
2. Notes the estimated value and location
3. Calls out any important requirements (license, pre-bid meeting attendance, bonding if mentioned)
4. Flags anything unusual or that requires immediate attention

Be direct and informative. Do not repeat the title verbatim as your first sentence. Do not fabricate details. If information is unavailable, omit it — do not say "not specified."`;

async function generatePortalSummary({ candidate, bidItems, scrapedPageText, log = console.log }) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.PROJECT_INTELLIGENCE_AI_KEY;
  if (!apiKey) throw new Error('No AI key configured — set OPENAI_API_KEY or PROJECT_INTELLIGENCE_AI_KEY');

  const context = buildPortalContext(candidate, bidItems, scrapedPageText);
  log(`portal_intelligence: context built (${context.length} chars), calling AI`);

  const response = await fetch(AI_GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: PORTAL_INTELLIGENCE_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Opportunity metadata:\n\n${context}\n\nWrite the executive summary.` },
      ],
      max_tokens: 350,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`Portal Intelligence AI call failed: ${response.status} — ${err.substring(0, 200)}`);
  }

  const json = await response.json();
  const summary = json.choices?.[0]?.message?.content?.trim() ?? '';
  if (!summary) throw new Error('Portal Intelligence: empty response from AI');

  log(`portal_intelligence: summary generated (${summary.length} chars)`);
  return summary;
}

async function runPortalIntelligence({ supabase, candidateId, log = console.log }) {
  if (!candidateId) throw new Error('portal_intelligence: missing candidateId');

  // Load candidate with all columns needed for context.
  const { data: candidate, error: cErr } = await supabase
    .from('opportunity_candidates')
    .select('id, raw_title, agency, portal_type, portal_bid_id, portal_department, bid_due_at, estimated_value, county, project_address, source_url, crawl_data')
    .eq('id', candidateId)
    .single();
  if (cErr || !candidate) throw new Error(`portal_intelligence: candidate not found — ${cErr?.message ?? 'no row'}`);

  // Load portal-native bid items.
  const { data: bidItems } = await supabase
    .from('opportunity_bid_items')
    .select('item_number, description, quantity_raw, unit_of_measure, section_name')
    .eq('opportunity_candidate_id', candidateId)
    .eq('extraction_method', 'portal_tab')
    .order('source_order', { ascending: true })
    .limit(50);

  // Best-effort browser tab scrape (no login, public content only).
  const scrapedPageText = await scrapePublicPortalTabs(candidate.source_url, log);

  const summary = await generatePortalSummary({
    candidate,
    bidItems: bidItems ?? [],
    scrapedPageText,
    log,
  });

  // Persist to portal_summary column.
  const { error: uErr } = await supabase
    .from('opportunity_candidates')
    .update({
      portal_summary: summary,
      portal_summary_at: new Date().toISOString(),
    })
    .eq('id', candidateId);
  if (uErr) throw new Error(`portal_intelligence: update failed — ${uErr.message}`);

  return { summary };
}

module.exports = { runPortalIntelligence };
