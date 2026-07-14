#!/usr/bin/env node
// READ-ONLY production investigation for the Riverside county-filtering bug.
// Usage: railway run --service bidbox node bidbox-worker/scripts/investigate-riverside-visibility.js
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const JOB_ID = 'fde1e0a2-7134-4614-a083-2b711261233d';
const PAGE = 1000;

async function allRows(table, select, configure = (q) => q, orderColumn = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await configure(
      supabase.from(table).select(select).order(orderColumn, { ascending: true }),
    ).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

function isClosed(c) {
  if (!c.bid_due_at) return false;
  const t = new Date(c.bid_due_at).getTime();
  return Number.isFinite(t) && t < Date.now();
}

async function main() {
  // 1. The job and its profile/user
  const { data: job, error: jobErr } = await supabase.from('qualification_jobs').select('*').eq('id', JOB_ID).maybeSingle();
  if (jobErr) throw jobErr;
  console.log('=== JOB ===');
  console.log(JSON.stringify(job, null, 1));

  const { data: profile } = await supabase.from('gc_qualification_profiles').select('*').eq('id', job.bid_profile_id).maybeSingle();
  console.log('=== ACTIVE PROFILE ===');
  console.log(JSON.stringify(profile, null, 1));

  const userId = job.user_id;

  // 2. Active qualification rows for this user, by status / profile_version
  const quals = await allRows(
    'user_opportunity_qualifications',
    'opportunity_candidate_id, status, primary_reason, reasons, profile_version, active, qualification_job_id',
    (q) => q.eq('user_id', userId).eq('active', true),
    'opportunity_candidate_id',
  );
  console.log(`=== ACTIVE QUAL ROWS: ${quals.length} ===`);
  const byStatus = {};
  const byVersion = {};
  for (const r of quals) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byVersion[r.profile_version] = (byVersion[r.profile_version] ?? 0) + 1;
  }
  console.log('by status:', byStatus, 'by profile_version:', byVersion);

  // Reason histogram for non-red rows
  const reasonCounts = {};
  for (const r of quals) {
    if (r.status === 'red') continue;
    for (const reason of r.reasons ?? []) {
      const key = reason.replace(/\(.*\)/, '(…)').replace(/in -?\d+ days?/, 'in N days');
      reasonCounts[`${r.status}: ${key}`] = (reasonCounts[`${r.status}: ${key}`] ?? 0) + 1;
    }
    if ((r.reasons ?? []).length === 0) reasonCounts[`${r.status}: <no reasons>`] = (reasonCounts[`${r.status}: <no reasons>`] ?? 0) + 1;
  }
  console.log('=== NON-RED REASON HISTOGRAM ===');
  for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) console.log(`${String(v).padStart(5)}  ${k}`);

  // 3. Candidates (valid only) to replicate frontend visibility
  const candidates = await allRows(
    'opportunity_candidates',
    'id, raw_title, agency, county, portal_type, bid_due_at, ingestion_status, global_exclusion_reason, canonical_candidate_id, crawl_data',
  );
  console.log(`=== CANDIDATES TOTAL: ${candidates.length} ===`);
  const qualById = new Map(quals.map((r) => [r.opportunity_candidate_id, r]));

  // Replicate current frontend main-feed logic (All tab, open only):
  // quarantined out; global_exclusion_reason -> filtered; duplicate_of_caltrans -> filtered; red -> filtered; else visible.
  const visible = [];
  const filteredOut = [];
  for (const c of candidates) {
    if (c.ingestion_status === 'quarantined' || !String(c.raw_title ?? '').trim()) continue;
    if (isClosed(c)) continue;
    const q = qualById.get(c.id);
    const legacyGlobal = c.global_exclusion_reason || (c.crawl_data?.duplicate_of_caltrans === true);
    if (legacyGlobal) { filteredOut.push(c); continue; }
    if (q?.status === 'red') { filteredOut.push(c); continue; }
    visible.push({ ...c, __qual: q ?? null });
  }
  console.log(`=== REPLICATED VISIBLE (main feed): ${visible.length} | filteredOut: ${filteredOut.length} ===`);

  const visStatus = { green: 0, yellow: 0, missing: 0 };
  for (const v of visible) visStatus[v.__qual?.status ?? 'missing']++;
  console.log('visible by qualification status:', visStatus);

  // County breakdown of visible rows
  const visCounty = {};
  for (const v of visible) {
    const key = v.county ?? '<NULL>';
    visCounty[key] = (visCounty[key] ?? 0) + 1;
  }
  console.log('=== VISIBLE BY county COLUMN ===');
  for (const [k, val] of Object.entries(visCounty).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${String(val).padStart(5)}  ${k}`);

  // 4. Specific screenshot examples
  console.log('=== SCREENSHOT EXAMPLES (visible non-Riverside agencies) ===');
  const suspects = ['County of Orange', 'San Francisco', 'Alameda', 'Pasadena', 'Metropolitan Transportation Authority', 'General Services'];
  for (const v of visible) {
    if (suspects.some((s) => String(v.agency ?? '').includes(s))) {
      console.log(JSON.stringify({
        id: v.id, title: String(v.raw_title).slice(0, 70), agency: v.agency, county: v.county,
        portal: v.portal_type, qual_status: v.__qual?.status ?? 'MISSING ROW',
        reasons: v.__qual?.reasons,
      }));
    }
  }

  // 5. All users with Riverside profiles (both affected users)
  const { data: riversideProfiles } = await supabase
    .from('gc_qualification_profiles')
    .select('id, profile_id, target_counties, profile_version, updated_at')
    .contains('target_counties', ['Riverside']);
  console.log('=== RIVERSIDE PROFILES ===');
  console.log(JSON.stringify(riversideProfiles, null, 1));
}

main().catch((err) => { console.error(err); process.exit(1); });
