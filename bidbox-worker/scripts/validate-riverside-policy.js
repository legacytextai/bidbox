#!/usr/bin/env node
// READ-ONLY: simulates the corrected qualification policy against live
// production candidates for a given Bid Profile and replicates the frontend
// main-feed rules, reporting the validation matrix required for the
// Riverside county-filtering fix. Makes no writes.
// Usage: railway run --service bidbox node bidbox-worker/scripts/validate-riverside-policy.js <profile_row_id>
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { qualifyCandidate } = require('../lib/qualification');

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

const isOpen = (c) => !c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now();
const isValid = (c) => c.ingestion_status === 'valid' && String(c.raw_title ?? '').trim().length > 0;

async function main() {
  const profileRowId = process.argv[2];
  if (!profileRowId) throw new Error('pass gc_qualification_profiles.id');

  const { data: profile, error } = await supabase.from('gc_qualification_profiles').select('*').eq('id', profileRowId).maybeSingle();
  if (error || !profile) throw new Error(`profile: ${error?.message ?? 'not found'}`);
  console.log(`profile ${profile.id} user ${profile.profile_id} version ${profile.profile_version} targets ${JSON.stringify(profile.target_counties)}`);

  const candidates = await allRows(
    'opportunity_candidates',
    'id, source_id, portal_type, raw_title, agency, bid_due_at, scope_text, estimated_value, county, required_licenses, required_naics, ingestion_status, status, global_exclusion_reason, crawl_data',
  );

  const buckets = { visible: [], filtered: [], converted_visible: [], quarantined_or_closed: 0 };
  const visStatus = { green: 0, yellow: 0 };
  const visCounty = {};
  const suspects = ['County of Orange', 'San Francisco', 'Alameda', 'Pasadena', 'Metropolitan Transportation Authority', 'General Services'];
  const suspectHits = [];

  for (const c of candidates) {
    if (!isValid(c) || !isOpen(c)) { buckets.quarantined_or_closed++; continue; }
    if (c.global_exclusion_reason || c.crawl_data?.duplicate_of_caltrans === true) { buckets.filtered.push(c); continue; }
    if (c.status !== 'pending') {
      // converted / manually triaged: outside rebuild scope, stays visible (existing behavior)
      buckets.converted_visible.push(c);
      continue;
    }
    const q = qualifyCandidate(c, profile);
    if (q.status === 'red') { buckets.filtered.push({ ...c, __reason: q.primary_reason }); continue; }
    buckets.visible.push({ ...c, __q: q });
    visStatus[q.status]++;
    const key = c.county ?? '<NULL>';
    visCounty[key] = (visCounty[key] ?? 0) + 1;
    if (suspects.some((s) => String(c.agency ?? '').includes(s))) suspectHits.push(c);
  }

  console.log(`\nMAIN FEED (pending, qualified visible): ${buckets.visible.length}  [green=${visStatus.green} yellow=${visStatus.yellow}]`);
  console.log(`converted (user-tracked, always visible): ${buckets.converted_visible.length}`);
  console.log(`filtered out: ${buckets.filtered.length}; closed/quarantined skipped: ${buckets.quarantined_or_closed}`);
  console.log('\nVISIBLE BY COUNTY:');
  for (const [k, v] of Object.entries(visCounty).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`\nSCREENSHOT-SUSPECT AGENCIES STILL VISIBLE: ${suspectHits.length}`);
  for (const s of suspectHits) console.log(`  ${s.agency} | ${String(s.raw_title).slice(0, 60)}`);

  console.log('\nSAMPLE INCLUDED (up to 25):');
  for (const v of buckets.visible.slice(0, 25)) {
    console.log(`  [${v.__q.status}] county=${v.county} | ${v.agency} | ${String(v.raw_title).slice(0, 55)}`);
  }
  console.log('\nSAMPLE EXCLUDED (first 25 county-related):');
  let shown = 0;
  for (const f of buckets.filtered) {
    if (!f.__reason || !/county|counties/i.test(f.__reason)) continue;
    console.log(`  county=${f.county ?? 'NULL'} | ${f.agency} | ${String(f.raw_title).slice(0, 45)} | ${f.__reason.slice(0, 60)}`);
    if (++shown >= 25) break;
  }

  // Portal coverage of the excluded county set
  const portalDist = {};
  for (const f of buckets.filtered) if (f.__reason && /county|counties/i.test(f.__reason)) portalDist[f.portal_type] = (portalDist[f.portal_type] ?? 0) + 1;
  console.log('\nCOUNTY-EXCLUDED BY PORTAL:', portalDist);
  const visPortal = {};
  for (const v of buckets.visible) visPortal[v.portal_type] = (visPortal[v.portal_type] ?? 0) + 1;
  console.log('VISIBLE BY PORTAL:', visPortal);
}

main().catch((err) => { console.error(err); process.exit(1); });
