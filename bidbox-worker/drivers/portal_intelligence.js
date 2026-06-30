'use strict';
/**
 * Portal Intelligence Driver
 *
 * Generates a lightweight opportunity summary from portal metadata only.
 * Does NOT download documents, chunk text, run embeddings, or call F4.
 *
 * Inputs:
 *   - OML normalized columns (estimated_value, county, project_address, ...)
 *   - crawl_data (pre-bid meeting, license requirements, scope text, ...)
 *   - portal-native bid items (from opportunity_bid_items)
 *   - source agency name and portal type
 *
 * Output:
 *   - A short plain-text executive summary stored in
 *     opportunity_candidates.portal_summary
 *
 * Cost: one small OpenAI call per opportunity (~200-400 input tokens).
 * This is the "before Analyze Project" layer. After F4 runs, the UI
 * should prefer the richer F4 executive summary over this one.
 */

const AI_GATEWAY_URL =
  process.env.PROJECT_INTELLIGENCE_AI_URL ||
  'https://api.openai.com/v1/chat/completions';

const PORTAL_INTELLIGENCE_MODEL =
  process.env.PORTAL_INTELLIGENCE_MODEL ||
  process.env.PROJECT_INTELLIGENCE_MODEL ||
  'gpt-4.1-mini';

function formatCurrency(value) {
  if (!value || typeof value !== 'number') return null;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1_000_000)     return `$${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1_000)         return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function buildPortalContext(candidate, bidItems = []) {
  const crawl = candidate.crawl_data ?? {};
  const lines = [];

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

  if (candidate.county)         lines.push(`County: ${candidate.county}`);
  if (candidate.project_address) lines.push(`Location: ${candidate.project_address}`);
  if (candidate.portal_bid_id)  lines.push(`Bid/Contract No: ${candidate.portal_bid_id}`);
  if (candidate.portal_department) lines.push(`Department: ${candidate.portal_department}`);

  if (crawl.scope_text)             lines.push(`Scope: ${String(crawl.scope_text).substring(0, 600)}`);
  if (crawl.license_requirements)   lines.push(`License Requirements: ${crawl.license_requirements}`);
  if (crawl.contract_duration)      lines.push(`Contract Duration: ${crawl.contract_duration}`);
  if (crawl.liquidated_damages)     lines.push(`Liquidated Damages: ${crawl.liquidated_damages}`);

  // Pre-bid / job walk
  const meetingExists =
    crawl.pre_bid_exists === 'Yes' || crawl.pre_bid_meeting === 'Yes' || crawl.job_walk_exists === 'Yes';
  const attendanceRequired = crawl.attendance_required ?? crawl.job_walk_mandatory ?? null;
  if (meetingExists) {
    const meetingLine = [
      `Pre-Bid/Job Walk: Yes`,
      attendanceRequired ? `Attendance Required: ${attendanceRequired}` : null,
      crawl.pre_bid_meeting_at ? `Date: ${crawl.pre_bid_meeting_at}` : null,
      crawl.job_walk_at ? `Date: ${crawl.job_walk_at}` : null,
    ].filter(Boolean).join(', ');
    lines.push(meetingLine);
  } else if (crawl.pre_bid_exists === 'No' || crawl.pre_bid_meeting === 'No') {
    lines.push('Pre-Bid/Job Walk: No');
  }

  if (bidItems.length > 0) {
    lines.push(`\nBid Items (${bidItems.length} line items):`);
    const show = bidItems.slice(0, 15);
    for (const item of show) {
      const parts = [
        item.item_number ? `#${item.item_number}` : null,
        item.description,
        item.quantity_raw ? `Qty: ${item.quantity_raw}` : null,
        item.unit_of_measure ?? null,
      ].filter(Boolean);
      lines.push(`  - ${parts.join(' | ')}`);
    }
    if (bidItems.length > 15) lines.push(`  ... and ${bidItems.length - 15} more`);
  }

  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a construction estimating assistant helping a California general contractor quickly evaluate public works opportunities.

You will receive portal metadata about a bidding opportunity. Write a concise executive summary (3-5 sentences) that:
1. Describes what the project is and its key scope
2. Notes the estimated value and location
3. Calls out any important requirements (license, pre-bid meeting, bonding if mentioned)
4. Flags anything unusual or that requires immediate attention

Be direct and informative. Do not repeat the title verbatim as your first sentence. Do not fabricate details. If information is unavailable, omit it — do not say "not specified."`;

async function generatePortalSummary({ candidate, bidItems, log = console.log }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const context = buildPortalContext(candidate, bidItems);
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
      max_tokens: 300,
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

  // Load candidate
  const { data: candidate, error: cErr } = await supabase
    .from('opportunity_candidates')
    .select('id, raw_title, agency, portal_type, portal_bid_id, portal_department, bid_due_at, estimated_value, county, project_address, crawl_data')
    .eq('id', candidateId)
    .single();
  if (cErr || !candidate) throw new Error(`portal_intelligence: candidate not found — ${cErr?.message ?? 'no row'}`);

  // Load portal-native bid items
  const { data: bidItems } = await supabase
    .from('opportunity_bid_items')
    .select('item_number, description, quantity_raw, unit_of_measure, section_name')
    .eq('opportunity_candidate_id', candidateId)
    .eq('extraction_method', 'portal_tab')
    .order('source_order', { ascending: true })
    .limit(50);

  const summary = await generatePortalSummary({
    candidate,
    bidItems: bidItems ?? [],
    log,
  });

  // Persist to portal_summary column
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
