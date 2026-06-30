/**
 * Backfill portal-native bid items for all non-closed PlanetBids and Caltrans candidates.
 *
 * Usage:
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backfill-bid-items.js
 *   SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backfill-bid-items.js --dry-run
 *
 * What it does:
 *   1. Queries all non-closed PlanetBids and Caltrans candidates (bid_due_at >= today).
 *   2. Skips candidates that already have an active preparation task.
 *   3. Queues project_analysis tasks for each eligible candidate.
 *   4. Rate-limits to BATCH_SIZE candidates per BATCH_DELAY_MS window.
 *   5. Reports results.
 *
 * The project_analysis worker path (acquirePlanetBidsDocuments / acquireCaltransDocuments)
 * stores bid items via replacePortalBidItemsForCandidate, which enforces:
 *   - extraction_method === 'portal_tab' for planetbids and caltrans
 *   - Deletes all existing bid-item rows for the candidate before inserting new ones
 *   - If portal returns 0 items, 0 rows are stored (fabricated rows are removed)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 5;       // tasks queued per batch
const BATCH_DELAY_MS = 3000; // ms between batches
const TARGET_PORTALS = ['planetbids', 'caltrans'];
const ACTIVE_TASK_STATUSES = ['pending', 'running', 'retrying'];
const PREPARATION_TASK_TYPES = ['project_analysis', 'document_processing', 'project_intelligence'];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function buildRefreshWindow(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchEligibleCandidates() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('opportunity_candidates')
    .select(
      'id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, ' +
      'analysis_status, document_acquisition_status, document_processing_status, ' +
      'opportunity_intelligence_status, converted_project_id'
    )
    .in('portal_type', TARGET_PORTALS)
    .gte('bid_due_at', now)
    .order('bid_due_at', { ascending: true });

  if (error) throw new Error(`Candidate query failed: ${error.message}`);
  return data ?? [];
}

async function hasActivePreparationTask(candidateId) {
  const { data, error } = await supabase
    .from('agent_tasks')
    .select('id')
    .in('task_type', PREPARATION_TASK_TYPES)
    .in('status', ACTIVE_TASK_STATUSES)
    .contains('payload', { candidate_id: candidateId })
    .limit(1);
  if (error) throw new Error(`Active task lookup failed: ${error.message}`);
  return Boolean(data?.length);
}

async function queueProjectAnalysis(candidate) {
  const requestedAt = new Date().toISOString();
  const payload = {
    candidate_id: candidate.id,
    source_id: candidate.source_id,
    source_name: candidate.agency ?? 'Unknown source',
    source_url: candidate.source_url,
    portal_type: candidate.portal_type,
    agency: candidate.agency,
    raw_title: candidate.raw_title,
    bid_due_at: candidate.bid_due_at,
    requested_at: requestedAt,
    trigger_reason: 'bid_item_backfill',
    preparation_reason: 'bid_item_backfill',
    intelligence_tier: 'opportunity',
    phase: 'f5_opportunity_preparation',
    next_phase: 'f2_document_acquisition',
    intelligence_status: 'queued',
  };

  const { data: task, error: taskError } = await supabase
    .from('agent_tasks')
    .insert({
      task_type: 'project_analysis',
      status: 'pending',
      priority: 5, // lower priority than normal (higher number = lower priority)
      trigger_reason: 'bid_item_backfill',
      refresh_window: buildRefreshWindow(),
      payload,
    })
    .select('id')
    .single();
  if (taskError) throw new Error(`Task insert failed: ${taskError.message}`);

  const { error: updateError } = await supabase
    .from('opportunity_candidates')
    .update({
      analysis_status: 'queued',
      analysis_task_id: task.id,
      analysis_requested_at: requestedAt,
      analysis_started_at: null,
      analysis_completed_at: null,
      analysis_error: null,
      document_acquisition_status: 'queued',
      document_acquisition_started_at: null,
      document_acquisition_completed_at: null,
      document_acquisition_error: null,
      opportunity_lifecycle_status: 'opportunity_intelligence_queued',
      opportunity_intelligence_status: 'queued',
      opportunity_intelligence_task_id: task.id,
      opportunity_intelligence_error: null,
    })
    .eq('id', candidate.id);
  if (updateError) throw new Error(`Candidate update failed: ${updateError.message}`);

  return task.id;
}

async function main() {
  log(`=== BidBox Bid Item Backfill${DRY_RUN ? ' [DRY RUN]' : ''} ===`);

  // ── Step 1: Count eligible candidates ──────────────────────────────────────
  log('Fetching eligible candidates...');
  const candidates = await fetchEligibleCandidates();

  const byPortal = {};
  for (const c of candidates) {
    byPortal[c.portal_type] = (byPortal[c.portal_type] ?? 0) + 1;
  }

  log(`Eligible non-closed candidates:`);
  for (const [portal, count] of Object.entries(byPortal)) {
    log(`  ${portal}: ${count}`);
  }
  log(`  TOTAL: ${candidates.length}`);

  if (candidates.length === 0) {
    log('No eligible candidates found. Exiting.');
    return;
  }

  // ── Step 2: Confirm guardrails ──────────────────────────────────────────────
  log('');
  log('Guardrails: bid_items.js assertPortalAuthoritativeRows() enforces extraction_method=portal_tab');
  log('  for planetbids and caltrans — document/AI-derived rows are rejected at insert time.');
  log('Task path: project_analysis → acquirePlanetBidsDocuments / acquireCaltransDocuments');
  log('           → replacePortalBidItemsForCandidate (deletes existing, inserts portal-native only)');

  if (DRY_RUN) {
    log('');
    log('[DRY RUN] Would queue the above candidates. Exiting without making changes.');
    return;
  }

  // ── Step 3: Queue tasks in batches ─────────────────────────────────────────
  log('');
  log(`Queuing tasks in batches of ${BATCH_SIZE} with ${BATCH_DELAY_MS}ms between batches...`);

  const results = {
    attempted: 0,
    queued: 0,
    skipped_active: 0,
    skipped_converted: 0,
    failed: 0,
    errors: {},
  };

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    log(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(candidates.length / BATCH_SIZE)}: processing ${batch.length} candidates...`);

    for (const candidate of batch) {
      results.attempted++;

      if (candidate.converted_project_id) {
        log(`  SKIP (converted) ${candidate.id} — ${candidate.raw_title?.slice(0, 60) ?? 'no title'}`);
        results.skipped_converted++;
        continue;
      }

      try {
        const hasActive = await hasActivePreparationTask(candidate.id);
        if (hasActive) {
          log(`  SKIP (active task) ${candidate.id} — ${candidate.raw_title?.slice(0, 60) ?? 'no title'}`);
          results.skipped_active++;
          continue;
        }

        const taskId = await queueProjectAnalysis(candidate);
        log(`  QUEUED ${candidate.portal_type} ${candidate.id} → task ${taskId} — ${candidate.raw_title?.slice(0, 60) ?? 'no title'}`);
        results.queued++;
      } catch (e) {
        log(`  FAILED ${candidate.id} — ${e.message}`);
        results.failed++;
        const key = e.message.slice(0, 80);
        results.errors[key] = (results.errors[key] ?? 0) + 1;
      }
    }

    if (i + BATCH_SIZE < candidates.length) {
      log(`Waiting ${BATCH_DELAY_MS}ms before next batch...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  // ── Step 4: Report ─────────────────────────────────────────────────────────
  log('');
  log('=== BACKFILL COMPLETE ===');
  log(`  Eligible:           ${candidates.length}`);
  log(`  Attempted:          ${results.attempted}`);
  log(`  Queued:             ${results.queued}`);
  log(`  Skipped (active):   ${results.skipped_active}`);
  log(`  Skipped (converted):${results.skipped_converted}`);
  log(`  Failed:             ${results.failed}`);

  if (Object.keys(results.errors).length > 0) {
    log('  Errors by message:');
    for (const [msg, count] of Object.entries(results.errors)) {
      log(`    [${count}x] ${msg}`);
    }
  }

  log('');
  log('Tasks are now queued in agent_tasks with status=pending and priority=5.');
  log('The Railway worker will pick them up and run project_analysis for each candidate.');
  log('Bid items will be stored via replacePortalBidItemsForCandidate after each acquisition.');
  log('');
  log('Spot-check queries (run in Supabase SQL editor after worker completes):');
  log('');
  log("  -- Caltrans 11-431854 bid items:");
  log("  SELECT COUNT(*) FROM opportunity_bid_items obi");
  log("  JOIN opportunity_candidates oc ON oc.id = obi.opportunity_candidate_id");
  log("  WHERE oc.crawl_data->>'contract_number' = '11-431854'");
  log("    AND obi.extraction_method = 'portal_tab';");
  log('');
  log("  -- Polytechnic (bid 142261) non-portal rows (should be 0):");
  log("  SELECT COUNT(*) FROM opportunity_bid_items obi");
  log("  JOIN opportunity_candidates oc ON oc.id = obi.opportunity_candidate_id");
  log("  WHERE oc.source_url LIKE '%142261%'");
  log("    AND obi.extraction_method != 'portal_tab';");
  log('');
  log("  -- Backfill task statuses:");
  log("  SELECT status, COUNT(*) FROM agent_tasks");
  log("  WHERE payload->>'trigger_reason' = 'bid_item_backfill'");
  log("  GROUP BY status;");
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
