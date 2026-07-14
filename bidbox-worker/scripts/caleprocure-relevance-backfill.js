#!/usr/bin/env node
// Classify existing Cal eProcure candidates for construction relevance and
// (optionally) apply non_public_works global exclusions. Report-only by
// default; pass --apply to write.
//
// Safety: never touches candidates excluded for another reason
// (duplicate_of_caltrans), quarantined rows, or user-triaged candidates
// (status != 'pending'). Reversible: clears its own code when a record
// reclassifies as retained.
//
// Usage:
//   railway run --service bidbox node bidbox-worker/scripts/caleprocure-relevance-backfill.js [--apply] [--show=excluded|retained]
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { classifyCalEprocureRelevance, NON_PUBLIC_WORKS_EXCLUSION_CODE } = require('../lib/caleprocure-quality');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const show = args.find((a) => a.startsWith('--show='))?.split('=')[1] ?? 'excluded';

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

const isOpen = (c) => !c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now();

async function main() {
  const rows = await allRows(
    'opportunity_candidates',
    'id, portal_bid_id, raw_title, agency, bid_due_at, status, ingestion_status, global_exclusion_code, global_exclusion_reason, crawl_data',
    (q) => q.eq('portal_type', 'caleprocure'),
  );

  const counts = { reviewed: 0, excluded: 0, retained: 0, cleared: 0, skipped_other_exclusion: 0, skipped_non_pending: 0, skipped_quarantined: 0 };
  const byCategory = {};
  const changes = [];

  for (const c of rows) {
    if (c.ingestion_status !== 'valid') { counts.skipped_quarantined++; continue; }
    if (c.status !== 'pending') { counts.skipped_non_pending++; continue; }
    if (c.global_exclusion_code && c.global_exclusion_code !== NON_PUBLIC_WORKS_EXCLUSION_CODE) { counts.skipped_other_exclusion++; continue; }
    counts.reviewed++;

    const relevance = classifyCalEprocureRelevance({
      title: c.raw_title,
      description: c.crawl_data?.description ?? null,
    });

    if (relevance.verdict === 'excluded') {
      counts.excluded++;
      byCategory[relevance.category] = (byCategory[relevance.category] ?? 0) + 1;
      if (c.global_exclusion_code !== NON_PUBLIC_WORKS_EXCLUSION_CODE) {
        changes.push({
          id: c.id,
          patch: {
            global_exclusion_code: NON_PUBLIC_WORKS_EXCLUSION_CODE,
            global_exclusion_reason: relevance.reason,
            crawl_data: {
              ...(c.crawl_data ?? {}),
              relevance_category: relevance.category,
              relevance_evidence: relevance.evidence,
              relevance_classified_at: new Date().toISOString(),
              relevance_classified_by: 'caleprocure-relevance-backfill',
            },
          },
          label: `EXCLUDE [${relevance.category}] ${c.portal_bid_id} "${String(c.raw_title).slice(0, 70)}"`,
        });
      }
      if (show === 'excluded') console.log(`EXCLUDED [${relevance.category}] open=${isOpen(c)} ${c.portal_bid_id} | ${c.agency} | ${String(c.raw_title).slice(0, 80)}`);
    } else {
      counts.retained++;
      if (c.global_exclusion_code === NON_PUBLIC_WORKS_EXCLUSION_CODE) {
        counts.cleared++;
        changes.push({
          id: c.id,
          patch: { global_exclusion_code: null, global_exclusion_reason: null },
          label: `CLEAR ${c.portal_bid_id} "${String(c.raw_title).slice(0, 70)}"`,
        });
      }
      if (show === 'retained') console.log(`RETAINED ${c.portal_bid_id} | ${c.agency} | ${String(c.raw_title).slice(0, 80)} | evidence=${relevance.evidence ?? '-'}`);
    }
  }

  console.log('\nSUMMARY:', JSON.stringify(counts, null, 1));
  console.log('excluded by category:', byCategory);
  console.log(`pending writes: ${changes.length} ${apply ? '(applying)' : '(report only — pass --apply to write)'}`);

  if (apply) {
    let applied = 0;
    for (const change of changes) {
      const { error } = await supabase.from('opportunity_candidates').update(change.patch).eq('id', change.id);
      if (error) throw new Error(`update failed for ${change.id}: ${error.message}`);
      applied++;
    }
    console.log(`applied ${applied} updates`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
