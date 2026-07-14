#!/usr/bin/env node
// Queue caleprocure_title_recovery tasks for candidates stored with
// placeholder titles. Controlled-batch tool: nothing runs automatically —
// the Railway worker picks up the queued tasks.
//
// Usage:
//   railway run --service bidbox node bidbox-worker/scripts/queue-caleprocure-title-recovery.js --limit=10 [--include-event=0000039519] [--open-only] [--dry-run]
//   railway run --service bidbox node bidbox-worker/scripts/queue-caleprocure-title-recovery.js --candidate-id=<uuid>
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { isPlaceholderEventTitle } = require('../lib/caleprocure-quality');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null;

const PAGE = 1000;
async function allRows(table, select, configure = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await configure(supabase.from(table).select(select).order('id', { ascending: true })).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

async function hasActiveTask(candidateId) {
  const { data } = await supabase.from('agent_tasks')
    .select('id')
    .eq('task_type', 'caleprocure_title_recovery')
    .in('status', ['pending', 'running', 'retrying'])
    .eq('payload->>candidate_id', candidateId)
    .limit(1);
  return Boolean(data && data.length > 0);
}

async function queueOne(candidate, trigger, dryRun) {
  if (await hasActiveTask(candidate.id)) return { queued: false, reason: 'already_queued' };
  if (dryRun) return { queued: false, reason: 'dry_run' };
  const { error } = await supabase.from('agent_tasks').insert({
    task_type: 'caleprocure_title_recovery',
    status: 'pending',
    priority: 4,
    trigger_reason: trigger,
    payload: {
      candidate_id: candidate.id,
      event_id: candidate.portal_bid_id ?? null,
      attempt_number: (candidate.recovery_attempt_count ?? 0) + 1,
      recovery_trigger: trigger,
    },
  });
  if (error) {
    if (String(error.code) === '23505') return { queued: false, reason: 'already_queued' };
    throw new Error(`task insert failed for ${candidate.id}: ${error.message}`);
  }
  return { queued: true };
}

async function main() {
  const dryRun = flag('dry-run');
  const trigger = opt('trigger') ?? 'controlled_validation_batch';
  const candidateId = opt('candidate-id');
  const limit = Number(opt('limit') ?? 10);
  const includeEvent = opt('include-event');
  const openOnly = flag('open-only') || !flag('include-closed');

  const rows = await allRows(
    'opportunity_candidates',
    'id, portal_bid_id, raw_title, agency, bid_due_at, ingestion_status, recovery_attempt_count, recovery_exhausted_at',
    (q) => q.eq('portal_type', 'caleprocure'),
  );

  let targets;
  if (candidateId) {
    targets = rows.filter((c) => c.id === candidateId);
  } else {
    const invalid = rows.filter((c) =>
      isPlaceholderEventTitle(c.raw_title, c.portal_bid_id)
      && !c.recovery_exhausted_at
      && (c.recovery_attempt_count ?? 0) < 3
      && (!openOnly || !c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now()));
    // Deterministic order, but pull the explicitly requested event to the front
    // and diversify agencies within the batch.
    invalid.sort((a, b) => a.id.localeCompare(b.id));
    const front = includeEvent ? invalid.filter((c) => String(c.portal_bid_id).includes(includeEvent)) : [];
    const rest = invalid.filter((c) => !front.includes(c));
    const byAgency = new Map();
    for (const c of rest) {
      const list = byAgency.get(c.agency) ?? [];
      list.push(c);
      byAgency.set(c.agency, list);
    }
    const interleaved = [];
    while (interleaved.length < rest.length) {
      for (const list of byAgency.values()) {
        const next = list.shift();
        if (next) interleaved.push(next);
      }
    }
    targets = [...front, ...interleaved].slice(0, limit);
  }

  console.log(`selected ${targets.length} candidate(s)${dryRun ? ' [dry run]' : ''}`);
  for (const c of targets) {
    const outcome = await queueOne(c, trigger, dryRun);
    console.log(`${outcome.queued ? 'QUEUED ' : `skip(${outcome.reason})`} ${c.id} event=${c.portal_bid_id} agency="${c.agency}" title="${c.raw_title}"`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
