/**
 * Spot-test: run bid_item_scan for the Northwood Park Improvements candidate.
 *
 * Finds the Northwood candidate by title, runs the full extraction pipeline,
 * and reports every diagnostic log line plus the final stored rows.
 *
 * Usage:
 *   node scripts/test-bid-item-scan-northwood.js
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   BROWSERBASE_API_KEY
 *   BROWSERBASE_PROJECT_ID
 *   PLANETBIDS_EMAIL         (if gated behind login)
 *   PLANETBIDS_PASSWORD
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { runPlanetBidsBidItemScan } = require('../drivers/planetbids_documents');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function ts() { return new Date().toISOString(); }

async function main() {
  // Find Northwood candidate
  const { data: candidates, error } = await supabase
    .from('opportunity_candidates')
    .select('id, source_url, portal_type, portal_bid_id, agency, raw_title, crawl_data')
    .ilike('raw_title', '%northwood%')
    .eq('portal_type', 'planetbids')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) { console.error('DB error:', error.message); process.exit(1); }
  if (!candidates?.length) { console.error('No Northwood candidate found. Check raw_title.'); process.exit(1); }

  console.log(`Found ${candidates.length} candidate(s):`);
  for (const c of candidates) {
    console.log(`  ${c.id} — ${c.raw_title} — ${c.source_url}`);
  }

  const candidate = candidates[0];
  console.log(`\nRunning bid_item_scan for: ${candidate.raw_title}`);
  console.log(`Source URL: ${candidate.source_url}`);
  console.log(`Candidate ID: ${candidate.id}\n`);

  const logs = [];
  const log = (msg) => {
    const line = `[${ts()}] ${msg}`;
    logs.push(line);
    console.log(line);
  };

  let result;
  try {
    result = await runPlanetBidsBidItemScan({ supabase, candidate, log });
    console.log(`\n✓ Extraction complete: extracted=${result.extracted} inserted=${result.inserted}`);
  } catch (e) {
    console.error(`\n✗ Extraction threw: ${e.message}`);
    console.error(e.stack);
    process.exit(1);
  }

  // Verify rows in DB
  const { data: storedRows, error: rowErr } = await supabase
    .from('opportunity_bid_items')
    .select('item_number, description, quantity_raw, unit_of_measure, extraction_method')
    .eq('opportunity_candidate_id', candidate.id)
    .eq('extraction_method', 'portal_tab')
    .order('source_order', { ascending: true });

  if (rowErr) { console.error('Row fetch error:', rowErr.message); process.exit(1); }

  console.log(`\nRows in opportunity_bid_items (${storedRows?.length ?? 0}):`);
  for (const row of storedRows ?? []) {
    console.log(`  ${row.item_number ?? '-'} | ${row.description} | qty=${row.quantity_raw ?? '-'} | unit=${row.unit_of_measure ?? '-'}`);
  }

  const expected = [
    'mobilization',
    'site improvements',
    'site furniture',
    'landscape',
    'plant establishment',
    'traffic striping',
  ];

  const found = (storedRows ?? []).map((r) => r.description.toLowerCase());
  const missing = expected.filter((e) => !found.some((f) => f.includes(e)));

  if (missing.length === 0) {
    console.log('\n✓ All 6 expected bid items present in DB.');
  } else {
    console.log(`\n✗ Missing expected items: ${missing.join(', ')}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
