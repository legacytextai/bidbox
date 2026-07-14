#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { agencyRegistryFromRows, classifyGeographyMatch, COUNTY_FIPS, DEFAULT_AGENCIES, extractDocumentGeographyEvidence, resolveCandidateGeography, RESOLVER_VERSION } = require('../lib/geography');

const PAGE_SIZE = 1000;
const args = new Set(process.argv.slice(2));
const writeShadow = args.has('--write-shadow');
const userArg = process.argv.find((arg) => arg.startsWith('--user-id='));
const userId = userArg?.slice('--user-id='.length) || process.env.GEOGRAPHY_SHADOW_USER_ID;
const sampleArg = process.argv.find((arg) => arg.startsWith('--sample-size='));
const sampleSize = Number(sampleArg?.slice('--sample-size='.length) ?? 0);
if (!userId) throw new Error('Pass --user-id=<uuid> or GEOGRAPHY_SHADOW_USER_ID');
if (args.has('--activate')) throw new Error('Activation is intentionally unsupported by the shadow backfill');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth:{ persistSession:false, autoRefreshToken:false },
});

async function allRows(table, select, configure = (query) => query, orderColumn = 'id') {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await configure(supabase.from(table).select(select).order(orderColumn, { ascending:true })).range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) return rows;
  }
}

function increment(record, key) { record[key] = (record[key] ?? 0) + 1; }
const LEGACY_GLOBAL_REASONS = [/^Duplicate of Caltrans(?:-native)? opportunity/i, /^Bid closed$/i, /^Non-public-works /i, /^Municipal operations outside construction scope$/i, /^Unsupported opportunity type$/i, /^Archived opportunity$/i];
function isGloballyHidden(candidate) {
  // Mirrors the frontend's compatibility quarantine for pre-migration rows.
  if (!String(candidate.raw_title ?? '').trim()) return true;
  if (candidate.global_exclusion_reason) return true;
  if (candidate.crawl_data?.duplicate_of_caltrans === true && candidate.auto_status_reason) return true;
  return candidate.auto_status === 'red' && candidate.auto_status_reason
    && LEGACY_GLOBAL_REASONS.some((pattern) => pattern.test(candidate.auto_status_reason));
}
function isOpen(candidate, now = Date.now()) {
  if (!candidate.bid_due_at) return true;
  const due = new Date(candidate.bid_due_at).getTime();
  return !Number.isFinite(due) || due >= now;
}

async function main() {
  const { data: profile, error: profileError } = await supabase.from('gc_qualification_profiles')
    .select('id, profile_id, profile_version, target_counties').eq('profile_id', userId).single();
  if (profileError) throw new Error(`profile: ${profileError.message}`);

  const candidates = await allRows('opportunity_candidates',
    'id, portal_type, raw_title, agency, county, project_address, scope_text, crawl_data, status, ingestion_status, bid_due_at, auto_status, auto_status_reason, global_exclusion_reason');
  const qualifications = await allRows('user_opportunity_qualifications',
    'opportunity_candidate_id, status, active',
    (query) => query.eq('user_id', userId).eq('active', true), 'opportunity_candidate_id');
  const qualificationByCandidate = new Map(qualifications.map((row) => [row.opportunity_candidate_id, row]));
  let agencyRegistry = DEFAULT_AGENCIES;
  const agencyResult = await supabase.from('agency_jurisdictions')
    .select('normalized_agency_name, aliases, county_fips, jurisdiction_scope, confidence, active').eq('active', true);
  if (!agencyResult.error) {
    const countyNamesByFips = Object.fromEntries(Object.entries(COUNTY_FIPS).map(([name, fips]) => [`06${fips}`, name]));
    agencyRegistry = agencyRegistryFromRows((agencyResult.data ?? []).map((row) => ({
      ...row, county_names:(row.county_fips ?? []).map((fips) => countyNamesByFips[fips]).filter(Boolean),
    })));
  }
  const documentChunks = await allRows('opportunity_document_chunks', 'id, opportunity_candidate_id, text');
  const chunksByCandidate = new Map();
  for (const chunk of documentChunks) {
    if (!chunksByCandidate.has(chunk.opportunity_candidate_id)) chunksByCandidate.set(chunk.opportunity_candidate_id, []);
    chunksByCandidate.get(chunk.opportunity_candidate_id).push(chunk);
  }
  const counts = {};
  const byPortal = {};
  const openCounts = {};
  const openByPortal = {};
  let currentVisible = 0;
  const rows = [];
  for (const candidate of candidates) {
    if (candidate.ingestion_status !== 'valid') continue;
    const qualification = qualificationByCandidate.get(candidate.id);
    const resolution = resolveCandidateGeography(candidate, {
      agencyRegistry,
      documentEvidence:extractDocumentGeographyEvidence(chunksByCandidate.get(candidate.id)),
    });
    // A resolver result does not substitute for a completed user-specific
    // qualification. Missing rows belong in the uncertain population.
    const state = qualification
      ? classifyGeographyMatch(resolution, profile.target_counties)
      : 'unresolved';
    increment(counts, state);
    byPortal[candidate.portal_type ?? 'unknown'] ??= {};
    increment(byPortal[candidate.portal_type ?? 'unknown'], state);
    if (isOpen(candidate) && !isGloballyHidden(candidate)) {
      if (!qualification || qualification.status !== 'red') currentVisible += 1;
      increment(openCounts, state);
      openByPortal[candidate.portal_type ?? 'unknown'] ??= {};
      increment(openByPortal[candidate.portal_type ?? 'unknown'], state);
    }
    rows.push({ candidate, resolution, state });
  }

  if (writeShadow) {
    for (let offset = 0; offset < rows.length; offset += 200) {
      const batch = rows.slice(offset, offset + 200);
      await Promise.all(batch.map(async ({ candidate, resolution }) => {
        const { error } = await supabase.from('opportunity_candidates').update({
          resolved_county_fips:resolution.counties.map((county) => county.fips),
          geography_resolution_status:resolution.status, geography_confidence:resolution.confidence,
          geography_primary_source:resolution.primary_source, geography_resolution_version:resolution.version,
          geography_resolved_at:new Date().toISOString(), geography_shadow:true,
        }).eq('id', candidate.id);
        if (error) throw new Error(`candidate shadow write ${candidate.id}: ${error.message}`);
      }));
      const shadowRows = batch.map(({ candidate, resolution, state }) => ({
        user_id:userId, opportunity_candidate_id:candidate.id, profile_version:profile.profile_version,
        resolver_version:RESOLVER_VERSION, geography_status:state,
        resolved_county_fips:resolution.counties.map((county) => county.fips), confidence:resolution.confidence, shadow:true,
      }));
      const { error: shadowError } = await supabase.from('user_opportunity_geography_shadow')
        .upsert(shadowRows, { onConflict:'user_id,opportunity_candidate_id,profile_version,resolver_version' });
      if (shadowError) throw new Error(`user shadow write: ${shadowError.message}`);
      const evidenceRows = batch.flatMap(({ candidate, resolution }) => resolution.evidence.map((item) => ({
        opportunity_candidate_id:candidate.id, resolver_version:resolution.version, evidence_source:item.source,
        source_priority:item.priority, county_fips:item.counties.map((county) => county.fips), confidence:item.confidence,
        authoritative:item.authoritative, project_specific:item.project_specific, raw_value:item.raw_value == null ? null : { value:item.raw_value },
      })));
      if (evidenceRows.length) {
        const { error: evidenceError } = await supabase.from('opportunity_geography_evidence')
          .upsert(evidenceRows, { onConflict:'opportunity_candidate_id,resolver_version,evidence_source,source_priority,county_fips' });
        if (evidenceError) throw new Error(`evidence shadow write: ${evidenceError.message}`);
      }
    }
  }

  const validationSample = [];
  if (sampleSize > 0) {
    const seenBuckets = new Set();
    const eligible = rows.filter(({ candidate, state }) => isOpen(candidate) && !isGloballyHidden(candidate) && state !== 'unresolved');
    for (const row of eligible) {
      const bucket = `${row.candidate.portal_type}:${row.state}`;
      if (seenBuckets.has(bucket) && validationSample.length < Math.ceil(sampleSize / 2)) continue;
      seenBuckets.add(bucket);
      validationSample.push({ id:row.candidate.id, portal:row.candidate.portal_type, title:row.candidate.raw_title,
        agency:row.candidate.agency, stored_county:row.candidate.county, proposed_state:row.state,
        proposed_counties:row.resolution.counties.map((county) => county.name), confidence:row.resolution.confidence,
        primary_source:row.resolution.primary_source,
        leading_evidence:row.resolution.evidence.slice(0, 2).map((item) => ({ source:item.source, counties:item.counties.map((county) => county.name), raw_value:item.raw_value })),
      });
      if (validationSample.length >= sampleSize) break;
    }
  }

  console.log(JSON.stringify({ mode:writeShadow ? 'shadow-write' : 'dry-run', resolver_version:RESOLVER_VERSION,
    profile:{ id:profile.id, version:profile.profile_version, target_counties:profile.target_counties },
    candidate_count:rows.length, active_qualification_count:qualifications.length, current_visible:currentVisible,
    proposed_main:(openCounts.confirmed_match ?? 0) + (openCounts.probable_match ?? 0),
    proposed_location_uncertain:(openCounts.conflict ?? 0) + (openCounts.unresolved ?? 0),
    open_counts:openCounts, open_by_portal:openByPortal, all_valid_counts:counts, all_valid_by_portal:byPortal,
    validation_sample:validationSample,
  }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
