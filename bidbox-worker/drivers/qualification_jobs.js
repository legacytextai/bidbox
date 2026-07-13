'use strict';

const { fetchAllCandidates, qualifyCandidate } = require('../lib/qualification');

const BATCH_SIZE = 300;
const PROFILE_PAGE_SIZE = 250;

function elapsedMs(start) {
  return Math.max(0, Math.round(Number(process.hrtime.bigint() - start) / 1e6));
}

async function loadJobAndProfile(supabase, jobId) {
  const { data: job, error: jobError } = await supabase.from('qualification_jobs').select('*').eq('id', jobId).maybeSingle();
  if (jobError) throw new Error(`qualification job lookup failed: ${jobError.message}`);
  if (!job) throw new Error('qualification job not found');
  const { data: profile, error: profileError } = await supabase.from('gc_qualification_profiles').select('*').eq('id', job.bid_profile_id).maybeSingle();
  if (profileError || !profile) throw new Error(`qualification profile lookup failed: ${profileError?.message ?? 'not found'}`);
  return { job, profile };
}

async function runQualificationRebuild({ task, supabase, log = console.log }) {
  const jobId = task.payload?.qualification_job_id;
  if (!jobId) throw new Error('qualification_rebuild task missing qualification_job_id');
  const { job, profile } = await loadJobAndProfile(supabase, jobId);
  if (job.status === 'superseded' || profile.profile_version !== job.profile_version) {
    log(`qualification job ${jobId} is stale; skipping`);
    return { job_id: jobId, status: 'superseded', processed_candidates: 0 };
  }

  const started = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  await supabase.from('qualification_jobs').update({ status: 'running', started_at: startedAt, updated_at: startedAt }).eq('id', jobId).eq('status', 'queued');

  try {
    const queryStart = process.hrtime.bigint();
    const candidates = await fetchAllCandidates(supabase, { pageSize: 500 });
    const queryTimeMs = elapsedMs(queryStart);
    await supabase.from('qualification_jobs').update({ total_candidates: candidates.length, query_time_ms: queryTimeMs, updated_at: new Date().toISOString() }).eq('id', jobId);

    let processed = 0;
    let green = 0;
    let yellow = 0;
    let red = 0;
    let evaluationTimeMs = 0;
    let upsertTimeMs = 0;
    let batchCount = 0;

    for (let offset = 0; offset < candidates.length; offset += BATCH_SIZE) {
      const { data: current } = await supabase.from('qualification_jobs').select('status').eq('id', jobId).single();
      if (current?.status !== 'running') return { job_id: jobId, status: current?.status ?? 'superseded', processed_candidates: processed };

      const evaluationStart = process.hrtime.bigint();
      const qualifiedAt = new Date().toISOString();
      const rows = candidates.slice(offset, offset + BATCH_SIZE).map((candidate) => {
        const qualified = qualifyCandidate(candidate, profile);
        if (qualified.status === 'green') green++;
        else if (qualified.status === 'yellow') yellow++;
        else red++;
        return {
          ...qualified,
          user_id: job.user_id,
          bid_profile_id: job.bid_profile_id,
          profile_version: job.profile_version,
          qualification_job_id: jobId,
          active: false,
          qualified_at: qualifiedAt,
          updated_at: qualifiedAt,
        };
      });
      evaluationTimeMs += elapsedMs(evaluationStart);

      const upsertStart = process.hrtime.bigint();
      const { error: upsertError } = await supabase.from('user_opportunity_qualifications')
        .upsert(rows, { onConflict: 'user_id,opportunity_candidate_id,profile_version' });
      if (upsertError) throw new Error(`qualification batch upsert failed: ${upsertError.message}`);
      upsertTimeMs += elapsedMs(upsertStart);
      processed += rows.length;
      batchCount++;

      await supabase.from('qualification_jobs').update({
        processed_candidates: processed,
        green_count: green,
        yellow_count: yellow,
        red_count: red,
        batch_count: batchCount,
        evaluation_time_ms: evaluationTimeMs,
        upsert_time_ms: upsertTimeMs,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId).eq('status', 'running');
      log(`qualification job ${jobId}: ${processed}/${candidates.length}`);
    }

    const { data: activated, error: activationError } = await supabase.rpc('activate_qualification_job', { p_job_id: jobId });
    if (activationError) throw new Error(`qualification activation failed: ${activationError.message}`);
    const status = activated ? 'complete' : 'superseded';
    return {
      job_id: jobId,
      status,
      total_candidates: candidates.length,
      processed_candidates: processed,
      green_count: green,
      yellow_count: yellow,
      red_count: red,
      batch_count: batchCount,
      query_time_ms: queryTimeMs,
      evaluation_time_ms: evaluationTimeMs,
      upsert_time_ms: upsertTimeMs,
      total_runtime_ms: elapsedMs(started),
    };
  } catch (error) {
    await supabase.from('qualification_jobs').update({
      status: 'failed',
      error_code: 'qualification_rebuild_failed',
      error_message: String(error.message ?? error).substring(0, 1000),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', jobId).eq('status', 'running');
    throw error;
  }
}

async function loadActiveProfiles(supabase) {
  const profiles = [];
  for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
    const { data, error } = await supabase.from('gc_qualification_profiles').select('*').order('id').range(from, from + PROFILE_PAGE_SIZE - 1);
    if (error) throw new Error(`fanout profile query failed: ${error.message}`);
    profiles.push(...(data ?? []));
    if ((data ?? []).length < PROFILE_PAGE_SIZE) break;
  }
  return profiles;
}

async function runQualificationCandidateFanout({ task, supabase, log = console.log }) {
  const candidateId = task.payload?.candidate_id;
  if (!candidateId) throw new Error('qualification_candidate_fanout task missing candidate_id');
  const candidates = await fetchAllCandidates(supabase, { candidateId });
  if (!candidates.length) return { candidate_id: candidateId, skipped: true, reason: 'candidate_not_globally_valid', profiles_evaluated: 0 };
  const candidate = candidates[0];
  const profiles = await loadActiveProfiles(supabase);
  const rows = [];
  for (const profile of profiles) {
    const { data: completeJob } = await supabase.from('qualification_jobs')
      .select('id, profile_version').eq('bid_profile_id', profile.id).eq('status', 'complete')
      .order('profile_version', { ascending: false }).limit(1).maybeSingle();
    if (!completeJob) continue;
    rows.push({
      ...qualifyCandidate(candidate, profile),
      user_id: profile.profile_id,
      bid_profile_id: profile.id,
      profile_version: completeJob.profile_version,
      qualification_job_id: completeJob.id,
      active: true,
      qualified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const { error } = await supabase.from('user_opportunity_qualifications')
      .upsert(rows.slice(offset, offset + BATCH_SIZE), { onConflict: 'user_id,opportunity_candidate_id,profile_version' });
    if (error) throw new Error(`fanout upsert failed: ${error.message}`);
  }
  log(`qualification fanout candidate=${candidateId} profiles=${rows.length}`);
  return { candidate_id: candidateId, profiles_evaluated: rows.length, skipped: false };
}

module.exports = { BATCH_SIZE, runQualificationCandidateFanout, runQualificationRebuild };
