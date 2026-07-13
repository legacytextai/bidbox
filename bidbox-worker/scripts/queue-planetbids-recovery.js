#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function main() {
  const write = process.argv.includes('--write');
  const dryRun = !write;
  const limit = Math.min(100, Math.max(1, Number(arg('limit', '10'))));
  const candidateIds = String(arg('candidate-ids', '')).split(',').map((id) => id.trim()).filter(Boolean);
  const trigger = arg('trigger', dryRun ? 'representative_dry_run' : 'controlled_backfill');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase service environment is required');
  if (write && !process.argv.includes('--confirm-existing-only')) {
    throw new Error('--write requires --confirm-existing-only');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  let query = supabase.from('opportunity_candidates')
    .select('id, source_id, source_url, portal_bid_id, agency, raw_title, bid_due_at, ingestion_status, recovery_attempt_count')
    .eq('portal_type', 'planetbids').is('raw_title', null).is('bid_due_at', null)
    .order('agency').order('id').limit(limit);
  if (candidateIds.length) query = query.in('id', candidateIds);
  const { data: candidates, error } = await query;
  if (error) throw error;
  if (!candidates?.length) throw new Error('No matching existing candidates');
  if (candidateIds.length && candidates.length !== candidateIds.length) throw new Error('One or more requested candidate IDs are outside the approved population');

  const rows = candidates.map((candidate) => ({
    task_type: 'planetbids_candidate_recovery', status: 'pending', priority: dryRun ? 10 : 9,
    trigger_reason: trigger,
    payload: {
      candidate_id: candidate.id, source_id: candidate.source_id, portal_bid_id: candidate.portal_bid_id,
      detail_url: candidate.source_url, recovery_trigger: trigger,
      attempt_number: Number(candidate.recovery_attempt_count ?? 0) + 1, dry_run: dryRun,
    },
  }));
  const { data: inserted, error: insertError } = await supabase.from('agent_tasks').insert(rows).select('id, payload');
  if (insertError) throw insertError;
  console.log(JSON.stringify({ mode: dryRun ? 'dry_run' : 'write', requested: rows.length, queued: inserted?.length ?? 0, tasks: inserted }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
