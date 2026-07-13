#!/usr/bin/env node
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { recoverFromListingApi } = require('../drivers/planetbids_recovery');
const { parsePlanetBidsDate, PLANETBIDS_TIME_ZONE } = require('../lib/planetbids-date');

const MODE = 'timezone-correction-controlled-10';
const TRIGGER = 'timezone_correction_controlled_10';
const APPROVED = Object.freeze({
  'a54c998c-8805-46b2-8d8d-0930781f4e47': {
    agency: 'City of Diamond Bar',
    title: 'Diamond Bar Facilities Private Event Security',
    before: '2025-04-24T18:00:00.000Z', expected: '2025-04-25T01:00:00.000Z',
  },
  'bd7975a1-ec44-4776-8725-8fb7ce13fdc8': {
    agency: 'Burbank-Glendale-Pasadena Airport Authority',
    title: 'Self-Park Management, Valet Parking, and Courtesy Shuttle Services',
    before: '2023-05-22T16:00:00.000Z', expected: '2023-05-22T23:00:00.000Z',
  },
  'b6ca4405-ac66-4460-9dea-d667316a4a38': {
    agency: 'Orange Unified School District',
    title: 'Install OFCI Door Entry Access Control at Multiple Sites.',
    before: '2025-12-22T14:00:00.000Z', expected: '2025-12-22T22:00:00.000Z',
  },
  '41d7afd6-1c88-4602-a882-34aed29f05d6': {
    agency: 'Santa Clarita Community College District',
    title: 'Compact CNC Turning Centers',
    before: '2022-07-07T15:00:00.000Z', expected: '2022-07-07T22:00:00.000Z',
  },
  'a6cff9c3-b260-4fa3-ac55-837ed066f397': {
    agency: 'City of National City',
    title: 'Bayshore Bikeway Segment 5 and Connections (PLA project)',
    before: '2025-07-22T17:00:00.000Z', expected: '2025-07-23T00:00:00.000Z',
  },
  '502200ab-bde8-4f4b-96bf-ef20168fd72c': {
    agency: 'City of Anaheim',
    title: 'TREE TRIMMING, CARE, AND MAINTENANCE SERVICES FOR ARMD EAST',
    before: '2024-12-17T14:00:00.000Z', expected: '2024-12-17T22:00:00.000Z',
  },
  'feb2828a-1a45-416a-9b71-c25eecac254a': {
    agency: 'Orange County Sanitation District',
    title: 'P1-138, INDUSTRIAL CONTROL SYSTEM AND IT DATA CENTER RELOCATION AT PLANT NO. 1',
    before: '2024-11-21T11:00:00.000Z', expected: '2024-11-21T19:00:00.000Z',
  },
  '8af9049a-cbec-40e7-82c8-d8cd3a312d59': {
    agency: 'MiraCosta Community College District',
    title: 'College for Kids Mailer 2023',
    before: '2022-12-15T10:00:00.000Z', expected: '2022-12-15T18:00:00.000Z',
  },
  '4671ee56-d809-499c-95cd-458cfd6cf026': {
    agency: 'Downey Unified School District',
    title: 'Downey USD Food Services Asian Inspired Food products',
    before: '2025-07-11T12:00:00.000Z', expected: '2025-07-11T19:00:00.000Z',
  },
  '82bbf99e-9ae5-4780-9f10-c86e64c71fb4': {
    agency: 'Chaffey College',
    title: 'BID NO. 2025CS593 MOBILE DIGITAL X-RAY SYSTEM',
    before: '2025-05-01T14:00:00.000Z', expected: '2025-05-01T21:00:00.000Z',
  },
});
const APPROVED_IDS = Object.freeze(Object.keys(APPROVED));
const CANDIDATE_SELECT = 'id,agency,portal_type,portal_bid_id,source_id,source_url,raw_title,bid_due_at,status,county,ingestion_status,ingestion_issue_code,ingestion_issue_reason,recovery_attempt_count,recovery_last_task_id,metadata_version,converted_project_id,last_metadata_refreshed_at,metadata_refresh_source,metadata_refresh_trigger,created_at,updated_at';

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function normalizeTimestamp(value) {
  const epoch = Date.parse(String(value ?? ''));
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : null;
}

function validateScope(candidateIds, mode, confirmed) {
  const unique = [...new Set(candidateIds)];
  const approved = new Set(APPROVED_IDS);
  if (mode !== MODE) throw new Error(`--mode must equal ${MODE}`);
  if (!confirmed) throw new Error('--confirm-exact-allowlist is required');
  if (candidateIds.length !== APPROVED_IDS.length || unique.length !== APPROVED_IDS.length) {
    throw new Error('candidate list must contain each of the exact 10 approved UUIDs once');
  }
  if (unique.some((id) => !approved.has(id)) || APPROVED_IDS.some((id) => !unique.includes(id))) {
    throw new Error('candidate list differs from the exact timezone-correction allowlist');
  }
  return APPROVED_IDS;
}

function stableCandidateState(candidate) {
  return {
    id: candidate.id,
    raw_title: candidate.raw_title,
    agency: candidate.agency,
    source_id: candidate.source_id,
    source_url: candidate.source_url,
    portal_bid_id: candidate.portal_bid_id,
    status: candidate.status,
    county: candidate.county,
    ingestion_status: candidate.ingestion_status,
    ingestion_issue_code: candidate.ingestion_issue_code,
    ingestion_issue_reason: candidate.ingestion_issue_reason,
    recovery_attempt_count: candidate.recovery_attempt_count,
    recovery_last_task_id: candidate.recovery_last_task_id,
    converted_project_id: candidate.converted_project_id,
    metadata_version: candidate.metadata_version,
    bid_due_at: candidate.bid_due_at,
    last_metadata_refreshed_at: candidate.last_metadata_refreshed_at,
    metadata_refresh_source: candidate.metadata_refresh_source,
    metadata_refresh_trigger: candidate.metadata_refresh_trigger,
  };
}

async function fetchCorrectionEvidence(supabase, candidate, log) {
  const expected = APPROVED[candidate.id];
  const recovered = await recoverFromListingApi(supabase, candidate, log);
  if (!recovered?.raw_title || !recovered?.due_date_raw) {
    throw new Error(`authoritative listing metadata unavailable for ${candidate.id}`);
  }
  const parsed = parsePlanetBidsDate(recovered.due_date_raw);
  return {
    candidate_id: candidate.id,
    agency: candidate.agency,
    authoritative_title: recovered.raw_title,
    existing_title: candidate.raw_title,
    title_match: recovered.raw_title === candidate.raw_title && recovered.raw_title === expected.title,
    raw_local_value: recovered.due_date_raw,
    interpreted_timezone: parsed.source_timezone,
    parse_classification: parsed.classification,
    parse_error_code: parsed.error_code,
    parsed_utc: parsed.value,
    expected_utc: expected.expected,
    exact_match: parsed.ok && parsed.value === expected.expected,
    evidence_source: recovered.extraction_source,
    confidence: recovered.extraction_confidence,
    diagnostics: recovered.diagnostics,
  };
}

async function main() {
  const write = process.argv.includes('--write');
  const candidateIds = String(arg('candidate-ids', '')).split(',').map((id) => id.trim()).filter(Boolean);
  validateScope(candidateIds, arg('mode'), process.argv.includes('--confirm-exact-allowlist'));
  if (write && !process.argv.includes('--confirm-production-write')) {
    throw new Error('--write requires --confirm-production-write');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service environment is required');
  }
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const candidateResult = await supabase.from('opportunity_candidates').select(CANDIDATE_SELECT).in('id', APPROVED_IDS);
  if (candidateResult.error) throw candidateResult.error;
  const candidates = candidateResult.data ?? [];
  if (candidates.length !== APPROVED_IDS.length) throw new Error('one or more approved candidates no longer exists');
  candidates.sort((a, b) => APPROVED_IDS.indexOf(a.id) - APPROVED_IDS.indexOf(b.id));
  for (const candidate of candidates) {
    const approved = APPROVED[candidate.id];
    if (candidate.portal_type !== 'planetbids') throw new Error(`${candidate.id} is not PlanetBids`);
    if (candidate.agency !== approved.agency || candidate.raw_title !== approved.title) {
      throw new Error(`${candidate.id} identity/title changed since approval`);
    }
    if (normalizeTimestamp(candidate.bid_due_at) !== approved.before) {
      throw new Error(`${candidate.id} current due date differs from the approved incorrect before-state`);
    }
  }

  const originalAuditResult = await supabase.from('opportunity_recovery_audits')
    .select('id,opportunity_candidate_id,agent_task_id,attempt_number,trigger,created_at')
    .in('opportunity_candidate_id', APPROVED_IDS).eq('trigger', 'controlled_write_10');
  if (originalAuditResult.error) throw originalAuditResult.error;
  const originalAudits = originalAuditResult.data ?? [];
  if (APPROVED_IDS.some((id) => originalAudits.filter((audit) => audit.opportunity_candidate_id === id).length !== 1)) {
    throw new Error('expected exactly one original controlled_write_10 audit per candidate');
  }

  const evidence = [];
  for (const candidate of candidates) {
    const started = Date.now();
    const item = await fetchCorrectionEvidence(supabase, candidate, (message) => console.error(`[${candidate.id}] ${message}`));
    item.runtime_ms = Date.now() - started;
    evidence.push(item);
  }
  if (evidence.some((item) => !item.exact_match || !item.title_match || item.evidence_source !== 'listing_api' || item.confidence !== 'authoritative')) {
    console.log(JSON.stringify({ mode: write ? 'write_blocked' : 'dry_run_failed', trigger: TRIGGER, evidence }, null, 2));
    throw new Error('one or more candidates failed exact authoritative correction validation');
  }

  if (!write) {
    console.log(JSON.stringify({ mode: 'dry_run', trigger: TRIGGER, attempted: evidence.length, exact_matches: evidence.length, writes: 0, evidence }, null, 2));
    return;
  }

  const repairs = [];
  for (const candidate of candidates) {
    const approved = APPROVED[candidate.id];
    const item = evidence.find((row) => row.candidate_id === candidate.id);
    const originalAudit = originalAudits.find((audit) => audit.opportunity_candidate_id === candidate.id);
    const before = stableCandidateState(candidate);
    const now = new Date().toISOString();
    const updateResult = await supabase.from('opportunity_candidates').update({
      bid_due_at: approved.expected,
      last_metadata_refreshed_at: now,
      metadata_refresh_source: 'timezone_correction',
      metadata_refresh_trigger: TRIGGER,
    }).eq('id', candidate.id).eq('updated_at', candidate.updated_at).select(CANDIDATE_SELECT).single();
    if (updateResult.error) throw new Error(`candidate ${candidate.id} correction failed: ${updateResult.error.message}`);
    const updated = updateResult.data;
    const after = stableCandidateState(updated);
    const stableFields = ['id', 'raw_title', 'agency', 'source_id', 'source_url', 'portal_bid_id', 'status', 'county',
      'ingestion_status', 'ingestion_issue_code', 'ingestion_issue_reason', 'recovery_attempt_count', 'recovery_last_task_id', 'converted_project_id'];
    if (stableFields.some((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])) || normalizeTimestamp(updated.bid_due_at) !== approved.expected) {
      throw new Error(`candidate ${candidate.id} post-update safety assertion failed`);
    }
    const fieldsChanged = Object.keys(after).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
    const auditResult = await supabase.from('opportunity_recovery_audits').insert({
      opportunity_candidate_id: candidate.id,
      agent_task_id: null,
      attempt_number: Math.max(1, Number(candidate.recovery_attempt_count ?? 1)),
      trigger: TRIGGER,
      extraction_source: 'listing_api',
      before_values: before,
      after_values: after,
      fields_changed: fieldsChanged,
      confidence: 'authoritative',
      outcome: 'recovered',
      error_code: null,
      error_reason: null,
      diagnostics: {
        correction_reason: 'planetbids_timezone_naive_local_interpreted_as_utc',
        original_recovery_audit_id: originalAudit.id,
        original_recovery_task_id: originalAudit.agent_task_id,
        raw_local_value: item.raw_local_value,
        interpreted_timezone: PLANETBIDS_TIME_ZONE,
        parser_classification: item.parse_classification,
        expected_utc: approved.expected,
        previous_incorrect_utc: approved.before,
        evidence: item.diagnostics,
      },
    }).select('id,created_at').single();
    if (auditResult.error) throw new Error(`candidate ${candidate.id} corrective audit failed: ${auditResult.error.message}`);
    repairs.push({
      candidate_id: candidate.id,
      before_bid_due_at: before.bid_due_at,
      after_bid_due_at: updated.bid_due_at,
      corrective_audit_id: auditResult.data.id,
      fields_changed: fieldsChanged,
      recovery_attempt_count_before: before.recovery_attempt_count,
      recovery_attempt_count_after: after.recovery_attempt_count,
      error: null,
    });
  }
  console.log(JSON.stringify({ mode: 'write', trigger: TRIGGER, attempted: repairs.length, repaired: repairs.length, evidence, repairs }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = { APPROVED, APPROVED_IDS, MODE, TRIGGER, normalizeTimestamp, stableCandidateState, validateScope };
