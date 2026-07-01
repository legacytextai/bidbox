'use strict';
/**
 * Requeue failed document_prefetch tasks.
 *
 * Usage: node scripts/requeue-failed-prefetch.js [--dry-run]
 *
 * Finds every agent_task where task_type = document_prefetch AND
 * status = failed, resets them to pending (priority 2), and clears
 * the error field.  Only tasks whose error message mentions the
 * concurrent-login failure are targeted by default; pass --all to
 * requeue every failed prefetch regardless of reason.
 *
 * Safe to run while the worker is live — tasks are atomic-claimed,
 * so a task reset to pending before a worker picks it up is fine.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const DRY_RUN = process.argv.includes('--dry-run');
const ALL = process.argv.includes('--all');

async function main() {
  console.log(`\nRequeue failed document_prefetch tasks${DRY_RUN ? ' [DRY RUN]' : ''}${ALL ? ' [ALL failures]' : ' [concurrent-login failures only]'}\n`);

  // Fetch all failed document_prefetch tasks
  const { data: tasks, error } = await sb
    .from('agent_tasks')
    .select('id, error, created_at, payload')
    .eq('task_type', 'document_prefetch')
    .eq('status', 'failed')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Query failed:', error.message);
    process.exit(1);
  }

  if (!tasks?.length) {
    console.log('No failed document_prefetch tasks found.');
    return;
  }

  console.log(`Found ${tasks.length} failed document_prefetch task(s).\n`);

  const CONCURRENT_LOGIN_PATTERN = /no planetbids bearer token|bearer token captured|concurrent|session.*invalid|login.*fail/i;

  const toRequeue = ALL
    ? tasks
    : tasks.filter((t) => CONCURRENT_LOGIN_PATTERN.test(t.error ?? ''));

  const skipped = tasks.length - toRequeue.length;
  if (skipped > 0) {
    console.log(`Skipping ${skipped} task(s) with unrelated errors (use --all to include):`);
    tasks
      .filter((t) => !CONCURRENT_LOGIN_PATTERN.test(t.error ?? ''))
      .forEach((t) => console.log(`  ${t.id.slice(0, 8)} error="${(t.error ?? '').slice(0, 80)}"`));
    console.log();
  }

  if (!toRequeue.length) {
    console.log('Nothing to requeue.');
    return;
  }

  console.log(`Requeueing ${toRequeue.length} task(s):`);
  toRequeue.forEach((t) => {
    const candidateId = t.payload?.candidate_id ?? 'unknown';
    console.log(`  ${t.id.slice(0, 8)} candidate=${candidateId.slice(0, 8)} error="${(t.error ?? '').slice(0, 70)}"`);
  });

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made.');
    return;
  }

  const ids = toRequeue.map((t) => t.id);
  const { error: updateError, count } = await sb
    .from('agent_tasks')
    .update({
      status: 'pending',
      started_at: null,
      completed_at: null,
      error: null,
      priority: 2,
    })
    .in('id', ids)
    .select('id', { count: 'exact', head: true });

  if (updateError) {
    console.error('Requeue failed:', updateError.message);
    process.exit(1);
  }

  console.log(`\nRequeued ${ids.length} tasks successfully.`);
  console.log('Workers will pick them up on the next poll cycle.\n');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
