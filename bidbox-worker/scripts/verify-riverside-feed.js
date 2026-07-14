#!/usr/bin/env node
// READ-ONLY: verifies the rendered Opportunities main feed for a user from
// ACTIVE production qualification rows, replicating the frontend visibility
// rules exactly (quarantine, global exclusion, legacy caltrans dedup, red
// filtered, pending-missing fail closed, converted exempt). Reports the
// validation matrix for the Riverside county-filtering fix.
// Usage: railway run --service bidbox node bidbox-worker/scripts/verify-riverside-feed.js <user_id>
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 1000;
async function allRows(table, select, configure = (q) => q, order = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await configure(supabase.from(table).select(select).order(order, { ascending: true })).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

const RIVERSIDE = /\briverside\b/i;
const isOpen = (c) => !c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now();
const isValid = (c) => c.ingestion_status === 'valid' && String(c.raw_title ?? '').trim().length > 0;

async function main() {
  const userId = process.argv[2];
  if (!userId) throw new Error('pass user_id');

  const { data: profile } = await supabase.from('gc_qualification_profiles').select('*').eq('profile_id', userId).maybeSingle();
  console.log(`profile version ${profile.profile_version} targets ${JSON.stringify(profile.target_counties)}`);

  const quals = await allRows(
    'user_opportunity_qualifications',
    'opportunity_candidate_id, status, primary_reason, reasons, profile_version',
    (q) => q.eq('user_id', userId).eq('active', true),
    'opportunity_candidate_id',
  );
  const byVersion = {};
  for (const r of quals) byVersion[r.profile_version] = (byVersion[r.profile_version] ?? 0) + 1;
  console.log(`active qualification rows: ${quals.length}; by version: ${JSON.stringify(byVersion)}`);
  const qualById = new Map(quals.map((r) => [r.opportunity_candidate_id, r]));

  const candidates = await allRows(
    'opportunity_candidates',
    'id, raw_title, agency, county, portal_type, bid_due_at, ingestion_status, status, global_exclusion_reason, crawl_data',
  );

  const matrix = {
    final_rendered_cards: 0,
    confirmed_riverside_visible: 0,
    probable_riverside_visible: 0, // no probable tier in the current strict policy
    confirmed_outside_visible: 0,
    probable_outside_visible: 0,
    unknown_county_visible: 0,
    missing_row_visible: 0,
    converted_visible: 0,
    filtered_out: 0,
  };
  const suspects = { 'County of Orange': 0, 'San Francisco Airport': 0, Alameda: 0, Pasadena: 0, 'Metropolitan Transportation Authority': 0, 'General Services': 0 };
  const visible = [];

  for (const c of candidates) {
    if (!isValid(c) || !isOpen(c)) continue;
    const q = qualById.get(c.id);
    if (c.global_exclusion_reason || c.crawl_data?.duplicate_of_caltrans === true) { matrix.filtered_out++; continue; }
    if (q?.status === 'red') { matrix.filtered_out++; continue; }
    // New frontend rule: pending candidate with no active row fails closed.
    if (!q && c.status === 'pending' && quals.length > 0) { matrix.filtered_out++; matrix.missing_row_visible += 0; continue; }

    matrix.final_rendered_cards++;
    visible.push({ ...c, __q: q ?? null });
    if (!q && c.status !== 'pending') matrix.converted_visible++;
    else if (!q) matrix.missing_row_visible++;

    const county = c.county;
    if (county == null || !String(county).trim()) matrix.unknown_county_visible++;
    else if (RIVERSIDE.test(String(county))) matrix.confirmed_riverside_visible++;
    else matrix.confirmed_outside_visible++;

    for (const s of Object.keys(suspects)) if (String(c.agency ?? '').includes(s)) suspects[s]++;
  }

  console.log('\nVALIDATION MATRIX:', JSON.stringify(matrix, null, 1));
  console.log('SCREENSHOT AGENCIES VISIBLE:', JSON.stringify(suspects, null, 1));

  console.log('\nALL VISIBLE CARDS:');
  for (const v of visible) {
    console.log(`  [${v.__q?.status ?? `no-row/${v.status}`}] county=${v.county ?? 'NULL'} | ${v.agency} | ${String(v.raw_title).slice(0, 58)}`);
  }

  console.log('\nEXCLUDED SAMPLE (20 county-related reds):');
  let shown = 0;
  for (const c of candidates) {
    if (!isValid(c) || !isOpen(c)) continue;
    const q = qualById.get(c.id);
    if (q?.status !== 'red' || !/count/i.test(q.primary_reason)) continue;
    console.log(`  county=${c.county ?? 'NULL'} | ${c.agency} | ${String(c.raw_title).slice(0, 40)} | ${q.primary_reason.slice(0, 55)}`);
    if (++shown >= 20) break;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
