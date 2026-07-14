#!/usr/bin/env node
// Controlled-validation runner: executes the Cal eProcure title-recovery
// driver inline (same code path the queued agent task uses) for a small
// batch of placeholder-title candidates. Verifies in-place update, no
// duplicates, and no unrelated field changes.
//
// Usage:
//   railway run --service bidbox node bidbox-worker/scripts/run-caleprocure-title-recovery-batch.js --limit=10 [--include-event=0000039519] [--dry-run]
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { isPlaceholderEventTitle } = require('../lib/caleprocure-quality');
const { runCaleprocureTitleRecovery } = require('../drivers/caleprocure_title_recovery');

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

async function main() {
  const dryRun = flag('dry-run');
  const limit = Number(opt('limit') ?? 10);
  const includeEvent = opt('include-event');

  const rows = await allRows(
    'opportunity_candidates',
    'id, portal_bid_id, raw_title, agency, bid_due_at, county, estimated_value, source_url, recovery_attempt_count, recovery_exhausted_at',
    (q) => q.eq('portal_type', 'caleprocure'),
  );
  const totalBefore = rows.length;

  const invalid = rows.filter((c) =>
    isPlaceholderEventTitle(c.raw_title, c.portal_bid_id)
    && !c.recovery_exhausted_at
    && (c.recovery_attempt_count ?? 0) < 3
    && (!c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now()));
  invalid.sort((a, b) => a.id.localeCompare(b.id));
  const front = includeEvent ? invalid.filter((c) => String(c.portal_bid_id).includes(includeEvent)) : [];
  const rest = invalid.filter((c) => !front.includes(c));
  // Diversify agencies within the batch.
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
  const batch = [...front, ...interleaved].slice(0, limit);
  console.log(`batch of ${batch.length} (from ${invalid.length} open invalid titles)${dryRun ? ' [dry run]' : ''}`);

  const results = [];
  for (const candidate of batch) {
    const task = {
      id: null,
      trigger_reason: 'controlled_validation_batch',
      payload: { candidate_id: candidate.id, dry_run: dryRun, recovery_trigger: 'controlled_validation_batch' },
    };
    try {
      const result = await runCaleprocureTitleRecovery({ task, supabase, log: (msg) => console.log(`  ${msg}`) });
      // Post-checks: in-place update, no unrelated field drift.
      const { data: after } = await supabase.from('opportunity_candidates')
        .select('id, raw_title, agency, bid_due_at, county, estimated_value, source_url')
        .eq('id', candidate.id).single();
      const unrelatedChanged = ['agency', 'bid_due_at', 'county', 'estimated_value', 'source_url']
        .filter((f) => JSON.stringify(after?.[f] ?? null) !== JSON.stringify(candidate[f] ?? null));
      results.push({ ...result, unrelated_changed: unrelatedChanged });
      console.log(`RESULT ${candidate.id} event=${candidate.portal_bid_id} recovered=${result.recovered} "${candidate.raw_title}" -> "${after?.raw_title}" unrelated_changed=${JSON.stringify(unrelatedChanged)}`);
    } catch (err) {
      results.push({ candidate_id: candidate.id, error: err.message });
      console.log(`ERROR ${candidate.id}: ${err.message}`);
    }
  }

  const { count: totalAfter } = await supabase.from('opportunity_candidates')
    .select('id', { count: 'exact', head: true }).eq('portal_type', 'caleprocure');
  const recovered = results.filter((r) => r.recovered).length;
  const failed = results.filter((r) => !r.recovered && !r.skipped).length;
  console.log(`\nSUMMARY: batch=${batch.length} recovered=${recovered} failed=${failed} candidates_before=${totalBefore} candidates_after=${totalAfter} duplicates_created=${(totalAfter ?? totalBefore) - totalBefore}`);
  const unrelated = results.flatMap((r) => r.unrelated_changed ?? []);
  console.log(`unrelated fields changed: ${unrelated.length === 0 ? '0' : JSON.stringify(unrelated)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
