/**
 * Re-queue portal_intelligence and bid_item_scan tasks for existing candidates.
 *
 * Use after fixing the portal_summary migration gap and bid_item_scan login bug.
 * Does NOT reset or modify any candidate data — only inserts new agent_tasks rows.
 *
 * Usage:
 *   node scripts/requeue-portal-tasks.js --dry-run
 *   node scripts/requeue-portal-tasks.js --confirm
 *
 * Flags:
 *   --dry-run   Print what would be queued. No data is modified.
 *   --confirm   Execute the re-queue.
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Options (env vars):
 *   REQUEUE_CANDIDATE_ID   Re-queue a single candidate by ID (for spot-testing).
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const readline = require('readline');

const DRY_RUN = !process.argv.includes('--confirm');
const SINGLE_CANDIDATE = process.env.REQUEUE_CANDIDATE_ID ?? null;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

async function verifyMigration() {
  // Probe for portal_summary column — query a single row selecting just that column.
  // If the column doesn't exist, PostgREST returns an error.
  const { error } = await supabase
    .from('opportunity_candidates')
    .select('portal_summary, portal_summary_at')
    .limit(1);

  if (error) {
    throw new Error(
      `portal_summary migration NOT applied — column missing.\n` +
      `Apply supabase/migrations/20260630210000_oml_portal_summary.sql first.\n` +
      `PostgREST error: ${error.message}`
    );
  }
  log('Migration verified: portal_summary and portal_summary_at columns exist.');
}

async function loadCandidates() {
  let query = supabase
    .from('opportunity_candidates')
    .select('id, portal_type, source_url, portal_bid_id, agency')
    .order('created_at', { ascending: false });

  if (SINGLE_CANDIDATE) {
    query = query.eq('id', SINGLE_CANDIDATE);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load candidates: ${error.message}`);
  return data ?? [];
}

async function run() {
  log(DRY_RUN ? 'DRY RUN — no data will be modified' : 'LIVE RUN');

  // Step 1: Verify migration is applied
  await verifyMigration();

  // Step 2: Load candidates
  const candidates = await loadCandidates();
  const planetbidsCandidates = candidates.filter((c) => c.portal_type === 'planetbids');

  log(`Found ${candidates.length} total candidates`);
  log(`  PlanetBids: ${planetbidsCandidates.length} (will get bid_item_scan)`);
  log(`  All portals: ${candidates.length} (will get portal_intelligence)`);

  if (DRY_RUN) {
    log('\nDRY RUN complete — pass --confirm to execute.');
    log(`Would queue: ${planetbidsCandidates.length} bid_item_scan + ${candidates.length} portal_intelligence tasks`);
    return;
  }

  const answer = await confirm(
    `\nAbout to queue ${planetbidsCandidates.length} bid_item_scan + ${candidates.length} portal_intelligence tasks. Type YES to proceed: `
  );
  if (answer !== 'yes') { log('Aborted.'); return; }

  // Step 3: Queue bid_item_scan for PlanetBids candidates
  let bidItemQueued = 0;
  let bidItemErrors = 0;
  for (const c of planetbidsCandidates) {
    const { error } = await supabase.from('agent_tasks').insert({
      task_type: 'bid_item_scan',
      status: 'pending',
      priority: 4,
      trigger_reason: 'requeue_after_login_fix',
      payload: {
        candidate_id: c.id,
        source_url: c.source_url,
        portal_type: c.portal_type,
        source_name: c.agency ?? null,
      },
    });
    if (error) {
      log(`WARN: bid_item_scan queue failed for ${c.id}: ${error.message}`);
      bidItemErrors++;
    } else {
      bidItemQueued++;
    }
  }
  log(`bid_item_scan queued: ${bidItemQueued} (${bidItemErrors} errors)`);

  // Step 4: Queue portal_intelligence for all candidates
  let piQueued = 0;
  let piErrors = 0;
  for (const c of candidates) {
    const { error } = await supabase.from('agent_tasks').insert({
      task_type: 'portal_intelligence',
      status: 'pending',
      priority: 3,
      trigger_reason: 'requeue_after_migration_fix',
      payload: {
        candidate_id: c.id,
        source_url: c.source_url,
        portal_type: c.portal_type,
        source_name: c.agency ?? null,
      },
    });
    if (error) {
      log(`WARN: portal_intelligence queue failed for ${c.id}: ${error.message}`);
      piErrors++;
    } else {
      piQueued++;
    }
  }
  log(`portal_intelligence queued: ${piQueued} (${piErrors} errors)`);

  log('\nRe-queue complete.');
  log(`  bid_item_scan:      ${bidItemQueued} queued, ${bidItemErrors} errors`);
  log(`  portal_intelligence: ${piQueued} queued, ${piErrors} errors`);
}

run().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
