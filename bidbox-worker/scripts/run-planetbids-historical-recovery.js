#!/usr/bin/env node
'use strict';

require('dotenv').config();
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');
const {
  buildRecoveryPlan,
  evaluateWaveGate,
  fieldRegressions,
  hashIds,
} = require('../lib/planetbids-historical-recovery');

const JOB_TYPE = 'planetbids_historical_recovery_coordinator';
const CHILD_TYPE = 'planetbids_candidate_recovery';
const TERMINAL = new Set(['complete', 'failed']);
const POLL_MS = Math.max(5000, Number(process.env.HISTORICAL_RECOVERY_POLL_MS || 15000));
const MAX_ACTIVE = Math.min(2, Math.max(1, Number(process.env.HISTORICAL_RECOVERY_MAX_ACTIVE || 2)));
const EXPECTED_MANIFEST_COUNT = 583;
const EXPECTED_MANIFEST_HASH = '19bac2090df2c8af7b054f3ad0365b31ed2cc17da54879c335de4e1859ad738f';
const EXPECTED_WAVE1_COUNT = 100;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(message, extra) {
  console.log(`[${new Date().toISOString()}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`);
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function decodeManifest() {
  const encoded = required('HISTORICAL_RECOVERY_MANIFEST_GZIP_B64');
  const parsed = JSON.parse(zlib.gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8'));
  const frozenIds = parsed.frozen_ids || [];
  const wave1Ids = parsed.wave1_ids || [];
  const authenticationExpiredIds = parsed.authentication_expired_ids || [];
  if (frozenIds.length !== EXPECTED_MANIFEST_COUNT || hashIds(frozenIds) !== EXPECTED_MANIFEST_HASH) throw new Error('frozen 583 manifest validation failed');
  if (wave1Ids.length !== EXPECTED_WAVE1_COUNT || new Set(wave1Ids).size !== EXPECTED_WAVE1_COUNT) throw new Error('Wave 1 exclusion validation failed');
  if (authenticationExpiredIds.length !== 2 || authenticationExpiredIds.some((id) => !wave1Ids.includes(id))) throw new Error('authentication-expired exclusion validation failed');
  return { frozenIds, wave1Ids, authenticationExpiredIds };
}

async function allRows(makeQuery, pageSize = 500) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function rowsForChunks(values, makeQuery, chunkSize = 100) {
  const rows = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    rows.push(...await allRows(() => makeQuery(values.slice(index, index + chunkSize))));
  }
  return rows;
}

async function automaticRecoverySetting(sb) {
  const { data, error } = await sb.from('app_settings').select('key,value,updated_at').eq('key', 'planetbids_recovery_automatic_enabled').maybeSingle();
  if (error) throw error;
  if (!data || data.value?.enabled !== false) throw new Error('automatic PlanetBids recovery is not explicitly disabled');
  return data;
}

async function persist(sb, job, patch) {
  const result = { ...(job.result || {}), ...patch, checkpointed_at: new Date().toISOString() };
  const { data, error } = await sb.from('agent_tasks').update({ result }).eq('id', job.id).select('*').single();
  if (error) throw error;
  Object.assign(job, data);
  return job;
}

async function loadOrCreateJob(sb, manifest) {
  const active = await allRows(() => sb.from('agent_tasks').select('*').eq('task_type', JOB_TYPE).in('status', ['pending', 'running', 'retrying']).order('created_at', { ascending: false }));
  if (active.length > 1) throw new Error('more than one active historical PlanetBids recovery job exists');
  if (active.length === 1) {
    const job = active[0];
    if (job.payload?.manifest_hash !== EXPECTED_MANIFEST_HASH) throw new Error('a different historical PlanetBids recovery job is already active');
    log('resuming persisted coordinator job', { job_id: job.id, completed: job.result?.completed_candidate_ids?.length || 0 });
    return job;
  }

  const activeChildren = await allRows(() => sb.from('agent_tasks').select('id,status,payload').eq('task_type', CHILD_TYPE).in('status', ['pending', 'running', 'retrying']));
  if (activeChildren.length) throw new Error(`refusing to start while ${activeChildren.length} PlanetBids recovery task(s) are active`);
  const candidates = await rowsForChunks(manifest.frozenIds, (ids) => sb.from('opportunity_candidates').select('id,portal_type').in('id', ids));
  if (candidates.length !== EXPECTED_MANIFEST_COUNT || candidates.some((row) => row.portal_type !== 'planetbids')) throw new Error('production candidate identity validation failed for frozen manifest');
  const audits = await rowsForChunks(manifest.frozenIds, (ids) => sb.from('opportunity_recovery_audits').select('opportunity_candidate_id,outcome').in('opportunity_candidate_id', ids));
  const recoveredIds = [...new Set(audits.filter((row) => row.outcome === 'recovered').map((row) => row.opportunity_candidate_id))];
  const plan = buildRecoveryPlan({ ...manifest, recoveredIds, waveSize: 100 });
  if (plan.remainingIds.some((id) => manifest.wave1Ids.includes(id))) throw new Error('Wave 1 UUID leaked into remaining plan');
  await automaticRecoverySetting(sb);
  const now = new Date().toISOString();
  const payload = {
    manifest_hash: EXPECTED_MANIFEST_HASH,
    manifest_count: EXPECTED_MANIFEST_COUNT,
    frozen_ids: manifest.frozenIds,
    wave1_ids: manifest.wave1Ids,
    authentication_expired_ids: manifest.authenticationExpiredIds,
    previously_recovered_ids: recoveredIds.filter((id) => !manifest.wave1Ids.includes(id)),
    remaining_ids: plan.remainingIds,
    wave_hashes: plan.waves.map(hashIds),
    wave_sizes: plan.waves.map((wave) => wave.length),
    max_active_tasks: MAX_ACTIVE,
  };
  const initialResult = {
    state: 'preflight_complete',
    preflight_completed_at: now,
    counts: plan.counts,
    current_wave: 0,
    completed_candidate_ids: [],
    candidate_results: [],
    waves: [],
    automatic_recovery_enabled: false,
    final_decision: null,
  };
  const { data: job, error } = await sb.from('agent_tasks').insert({
    task_type: JOB_TYPE,
    status: 'running',
    priority: 0,
    trigger_reason: 'approved_remaining_frozen_583_historical_recovery',
    payload,
    result: initialResult,
    started_at: now,
  }).select('*').single();
  if (error) throw error;
  log('created durable coordinator job', { job_id: job.id, remaining: plan.remainingIds.length, wave_sizes: payload.wave_sizes });
  return job;
}

async function candidateRows(sb, ids) {
  if (!ids.length) return [];
  return allRows(() => sb.from('opportunity_candidates').select('id,source_id,source_url,portal_bid_id,portal_type,agency,raw_title,bid_due_at,status,county,ingestion_status,recovery_attempt_count,recovery_last_error_code,recovery_last_task_id,updated_at').in('id', ids));
}

function snapshotById(rows) {
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}

async function queueCandidate(sb, job, candidate) {
  const attempt = Number(candidate.recovery_attempt_count || 0) + 1;
  const { data, error } = await sb.from('agent_tasks').insert({
    task_type: CHILD_TYPE,
    status: 'pending',
    priority: 9,
    trigger_reason: 'remaining_frozen_583_historical_recovery',
    payload: {
      candidate_id: candidate.id,
      source_id: candidate.source_id,
      portal_bid_id: candidate.portal_bid_id,
      detail_url: candidate.source_url,
      recovery_trigger: 'remaining_frozen_583_historical_recovery',
      attempt_number: attempt,
      dry_run: false,
      historical_recovery_job_id: job.id,
      suppress_qualification_fanout: true,
    },
  }).select('*').single();
  if (error) throw error;
  return data;
}

async function ensureAudit(sb, task, before, after) {
  const { data, error } = await sb.from('opportunity_recovery_audits').select('id').eq('agent_task_id', task.id).limit(1);
  if (error) throw error;
  if (data?.length) return { audit_id: data[0].id, fallback: false };
  const result = task.result || {};
  const fields = Object.keys(after || {}).filter((field) => JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field]));
  const { data: inserted, error: insertError } = await sb.from('opportunity_recovery_audits').insert({
    opportunity_candidate_id: task.payload.candidate_id,
    agent_task_id: task.id,
    attempt_number: Math.max(1, Number(task.payload.attempt_number || 1)),
    trigger: 'remaining_frozen_583_historical_recovery',
    extraction_source: null,
    before_values: before || {},
    after_values: after || before || {},
    fields_changed: fields,
    confidence: null,
    outcome: 'failed',
    error_code: result.error_code || 'worker_task_failed',
    error_reason: String(task.error || result.error_code || 'worker task ended without recovery audit').slice(0, 1000),
    diagnostics: { coordinator_fallback: true, historical_recovery_job_id: task.payload.historical_recovery_job_id },
  }).select('id').single();
  if (insertError) throw insertError;
  return { audit_id: inserted.id, fallback: true };
}

async function duplicateCounts(sb, rows) {
  const ids = new Set(rows.map((row) => row.id));
  const bidIds = [...new Set(rows.map((row) => row.portal_bid_id).filter(Boolean))];
  if (!bidIds.length) return {};
  const matches = await allRows(() => sb.from('opportunity_candidates').select('id,portal_bid_id').eq('portal_type', 'planetbids').in('portal_bid_id', bidIds));
  const counts = {};
  for (const row of matches) counts[row.portal_bid_id] = (counts[row.portal_bid_id] || 0) + 1;
  for (const row of rows) if (!ids.has(row.id)) throw new Error('duplicate baseline identity corruption');
  return counts;
}

async function runWave(sb, job, waveIndex, ids) {
  const waveHash = hashIds(ids);
  const resumingWave = job.result?.current_wave_hash === waveHash && job.result?.current_wave_before;
  const beforeRows = resumingWave ? Object.values(job.result.current_wave_before) : await candidateRows(sb, ids);
  if (beforeRows.length !== ids.length) throw new Error(`wave ${waveIndex + 1} candidate identity count mismatch`);
  const before = snapshotById(beforeRows);
  const duplicateBefore = resumingWave ? job.result.current_wave_duplicate_counts : await duplicateCounts(sb, beforeRows);
  await persist(sb, job, {
    state: 'wave_running',
    current_wave: waveIndex + 1,
    current_wave_ids: ids,
    current_wave_hash: waveHash,
    current_wave_started_at: job.result?.current_wave_started_at || new Date().toISOString(),
    current_wave_before: before,
    current_wave_duplicate_counts: duplicateBefore,
  });
  const existingTasks = await allRows(() => sb.from('agent_tasks').select('*').eq('task_type', CHILD_TYPE).contains('payload', { historical_recovery_job_id: job.id }));
  const tasks = existingTasks.filter((task) => ids.includes(task.payload?.candidate_id));
  if (new Set(tasks.map((task) => task.payload?.candidate_id)).size !== tasks.length) throw new Error(`wave ${waveIndex + 1} has duplicate persisted child tasks`);
  const alreadyQueued = new Set(tasks.map((task) => task.payload.candidate_id));
  const queueIds = ids.filter((id) => !alreadyQueued.has(id));
  let next = 0;
  while (next < queueIds.length || tasks.some((task) => !TERMINAL.has(task.status))) {
    const active = tasks.filter((task) => !TERMINAL.has(task.status));
    while (next < queueIds.length && active.length < MAX_ACTIVE) {
      const row = before[queueIds[next++]];
      const task = await queueCandidate(sb, job, row);
      tasks.push(task);
      active.push(task);
      await persist(sb, job, { state: 'wave_running', queued_in_wave: tasks.length, active_task_ids: active.map((item) => item.id), first_candidate_begun_at: job.result?.first_candidate_begun_at || new Date().toISOString() });
      log('queued recovery candidate', { job_id: job.id, wave: waveIndex + 1, ordinal: tasks.length, candidate_id: row.id, task_id: task.id });
    }
    if (!tasks.some((task) => !TERMINAL.has(task.status))) break;
    await sleep(POLL_MS);
    const taskIds = tasks.map((task) => task.id);
    const refreshed = await allRows(() => sb.from('agent_tasks').select('*').in('id', taskIds));
    const byId = new Map(refreshed.map((task) => [task.id, task]));
    for (let index = 0; index < tasks.length; index++) if (byId.has(tasks[index].id)) tasks[index] = byId.get(tasks[index].id);
    const completed = tasks.filter((task) => TERMINAL.has(task.status)).length;
    await persist(sb, job, { state: 'wave_running', queued_in_wave: tasks.length, completed_in_wave: completed, active_task_ids: tasks.filter((task) => !TERMINAL.has(task.status)).map((task) => task.id) });
  }

  const afterRows = await candidateRows(sb, ids);
  const after = snapshotById(afterRows);
  const audits = [];
  for (const task of tasks) audits.push(await ensureAudit(sb, task, before[task.payload.candidate_id], after[task.payload.candidate_id]));
  const identityFailures = ids.filter((id) => {
    const a = before[id]; const b = after[id];
    return !b || a.id !== b.id || a.source_id !== b.source_id || a.source_url !== b.source_url || a.portal_bid_id !== b.portal_bid_id || b.portal_type !== 'planetbids';
  });
  const regressions = ids.flatMap((id) => fieldRegressions(before[id], after[id]).map((field) => ({ candidate_id: id, field })));
  const duplicateAfter = await duplicateCounts(sb, afterRows);
  const duplicateCreations = Object.keys(duplicateAfter).reduce((sum, key) => sum + Math.max(0, duplicateAfter[key] - (duplicateBefore[key] || 0)), 0);
  const taskIds = new Set(tasks.map((task) => task.id));
  const collateral = await allRows(() => sb.from('opportunity_candidates').select('id,recovery_last_task_id').in('recovery_last_task_id', [...taskIds]));
  const unrelatedRowsModified = collateral.filter((row) => !ids.includes(row.id)).length;
  const setting = await automaticRecoverySetting(sb);
  const gate = evaluateWaveGate({ tasks, identityFailures, duplicateCreations, unrelatedRowsModified, regressions, automaticRecoveryEnabled: setting.value?.enabled === true, missingAudits: audits.filter((audit) => !audit.audit_id) });
  const candidateResults = tasks.map((task) => ({
    candidate_id: task.payload.candidate_id,
    task_id: task.id,
    task_status: task.status,
    recovered: Number(task.result?.recovered || 0),
    unresolved: Number(task.result?.unresolved || (task.status === 'failed' ? 1 : 0)),
    source: task.result?.source || null,
    error_code: task.result?.error_code || (task.status === 'failed' ? 'worker_task_failed' : null),
    browserbase_sessions: Number(task.result?.browserbase_sessions || 0),
    runtime_ms: Number(task.result?.runtime_ms || 0),
  }));
  const wave = {
    wave: waveIndex + 1,
    manifest_hash: hashIds(ids),
    attempted: tasks.length,
    recovered: candidateResults.reduce((sum, row) => sum + row.recovered, 0),
    unresolved: candidateResults.reduce((sum, row) => sum + row.unresolved, 0),
    browserbase_sessions: candidateResults.reduce((sum, row) => sum + row.browserbase_sessions, 0),
    fallback_audits: audits.filter((audit) => audit.fallback).length,
    gate,
    completed_at: new Date().toISOString(),
  };
  return { wave, candidateResults };
}

async function finish(sb, job, status, finalDecision, stopReason = null) {
  const results = job.result?.candidate_results || [];
  const errorClassifications = {};
  for (const row of results.filter((item) => item.error_code)) errorClassifications[row.error_code] = (errorClassifications[row.error_code] || 0) + 1;
  const { data: automaticSetting } = await sb.from('app_settings').select('value').eq('key', 'planetbids_recovery_automatic_enabled').maybeSingle();
  const automaticRecoveryDisabled = automaticSetting?.value?.enabled === false;
  const finalReport = {
    original_frozen_manifest_count: job.payload.manifest_count,
    wave1_excluded_count: job.payload.wave1_ids.length,
    previously_recovered_count: job.payload.previously_recovered_ids.length,
    authentication_expired_exclusions: job.payload.authentication_expired_ids.length,
    remaining_attempted_count: results.length,
    recovered_count: results.reduce((sum, row) => sum + row.recovered, 0),
    unresolved_count: results.reduce((sum, row) => sum + row.unresolved, 0),
    error_classifications: errorClassifications,
    results_by_wave: job.result.waves,
    runtime_ms: Date.now() - new Date(job.started_at).getTime(),
    browserbase_session_usage: results.reduce((sum, row) => sum + row.browserbase_sessions, 0),
    duplicate_check: job.result.waves.reduce((sum, wave) => sum + wave.gate.duplicate_creations, 0),
    unrelated_row_change_check: job.result.waves.reduce((sum, wave) => sum + wave.gate.unrelated_rows_modified, 0),
    null_overwrite_check: job.result.waves.reduce((sum, wave) => sum + wave.gate.null_or_blank_overwrites, 0),
    timezone_validation: job.result.waves.reduce((sum, wave) => sum + wave.gate.timezone_validation_failures, 0),
    final_gate_result: finalDecision,
    remaining_unrecovered_uuid_count: job.payload.remaining_ids.length - results.reduce((sum, row) => sum + row.recovered, 0),
    railway_deployment_id: process.env.RAILWAY_DEPLOYMENT_ID || null,
    automatic_recovery_remains_disabled: automaticRecoveryDisabled,
    stop_reason: stopReason,
  };
  const now = new Date().toISOString();
  const { error } = await sb.from('agent_tasks').update({
    status,
    result: { ...job.result, state: status === 'complete' ? 'complete' : 'stopped', final_decision: finalDecision, final_report: finalReport, checkpointed_at: now },
    error: stopReason,
    completed_at: now,
  }).eq('id', job.id);
  if (error) throw error;
  log('historical recovery coordinator finished', { job_id: job.id, final_decision: finalDecision, report: finalReport });
}

async function main() {
  const sb = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
  const manifest = decodeManifest();
  const job = await loadOrCreateJob(sb, manifest);
  const completed = new Set(job.result?.completed_candidate_ids || []);
  const waves = [];
  for (let index = 0; index < job.payload.remaining_ids.length; index += 100) waves.push(job.payload.remaining_ids.slice(index, index + 100));
  try {
    for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
      const pendingIds = waves[waveIndex].filter((id) => !completed.has(id));
      if (!pendingIds.length) continue;
      const { wave, candidateResults } = await runWave(sb, job, waveIndex, pendingIds);
      for (const row of candidateResults) completed.add(row.candidate_id);
      await persist(sb, job, {
        state: wave.gate.passed ? 'wave_complete' : 'stopped_by_safety_gate',
        completed_candidate_ids: [...completed],
        candidate_results: [...(job.result?.candidate_results || []), ...candidateResults],
        waves: [...(job.result?.waves || []), wave],
        active_task_ids: [],
      });
      log('wave complete', { job_id: job.id, wave: wave.wave, attempted: wave.attempted, recovered: wave.recovered, gate: wave.gate });
      if (!wave.gate.passed) {
        await finish(sb, job, 'failed', 'REMAINING PLANETBIDS RECOVERY STOPPED BY SAFETY GATE', wave.gate.reasons.join(','));
        return;
      }
    }
    await automaticRecoverySetting(sb);
    await finish(sb, job, 'complete', 'REMAINING PLANETBIDS RECOVERY PASSED');
  } catch (error) {
    await persist(sb, job, { state: 'failed', fatal_error: error.message, active_task_ids: [] }).catch(() => {});
    await finish(sb, job, 'failed', 'REMAINING PLANETBIDS RECOVERY FAILED', error.message).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  console.error(JSON.stringify({ name: error.name, message: error.message, details: error.details, hint: error.hint, code: error.code, cause: error.cause?.message || error.cause || null }));
  process.exit(1);
});
