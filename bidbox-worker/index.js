require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePlanetBids } = require('./drivers/planetbids');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const IDLE_POLL_INTERVAL_MS = 30000;
const QUALIFY_MIN_INTERVAL_MS = 2 * 60 * 1000;
const CLAIM_RETRY = Symbol('claim-retry');
let lastQualifyAt = 0;

function ts() {
  return new Date().toISOString();
}

async function maybeQualifyCandidates() {
  const qualifyUrl = process.env.QUALIFY_CANDIDATES_URL;
  if (!qualifyUrl) return;

  const now = Date.now();
  if (now - lastQualifyAt < QUALIFY_MIN_INTERVAL_MS) {
    return;
  }

  lastQualifyAt = now;
  try {
    const qualifyRes = await fetch(qualifyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ profile_id: '324e7848-6c4d-4fe5-a826-91427265a76e' }),
    });
    if (qualifyRes.ok) {
      const q = await qualifyRes.json();
      console.log(`[${ts()}] qualify-candidates: evaluated=${q.evaluated} green=${q.auto_green} yellow=${q.auto_yellow} red=${q.auto_red}`);
    } else {
      console.warn(`[${ts()}] qualify-candidates returned ${qualifyRes.status}`);
    }
  } catch (e) {
    console.warn(`[${ts()}] qualify-candidates error: ${e.message}`);
  }
}

async function runPlanetBidsScan(task, supabase) {
  const { source_id, source_name, listing_url, portal_type } = task.payload;
  const logs = [];
  const log = (msg) => {
    const line = `[${ts()}] ${msg}`;
    logs.push(line);
    console.log(line);
  };

  let runLogId = null;
  try {
    const { data: runLog, error: runLogError } = await supabase
      .from('agent_run_logs')
      .insert({
        task_id: task.id,
        status: 'running',
        logs: logs.join('\n'),
      })
      .select('id')
      .single();
    if (runLogError) {
      console.warn(`[${ts()}] agent_run_logs insert failed: ${runLogError.message}`);
    } else {
      runLogId = runLog.id;
    }
  } catch (e) {
    console.warn(`[${ts()}] agent_run_logs insert threw: ${e.message}`);
  }

  const {
    candidates,
    errors: driverErrors,
    errorMessages = [],
  } = await scrapePlanetBids(
    { source_id, source_name, listing_url, portal_type },
    log
  );

  let errors = driverErrors;
  const found = candidates.length;
  let newCount = 0;

  for (const candidate of candidates) {
    try {
      const { error: insertError } = await supabase
        .from('opportunity_candidates')
        .insert({
          source_id,
          source_url: candidate.source_url,
          portal_type,
          raw_title: candidate.raw_title,
          agency: source_name,
          bid_due_at: candidate.bid_due_at,
          crawl_data: candidate.crawl_data ?? null,
        });

      if (insertError) {
        if (insertError.code === '23505') {
          log(`[${source_name}] Already known: ${candidate.source_url}`);
        } else {
          log(`[${source_name}] Insert error: ${insertError.message}`);
          errors++;
        }
      } else {
        newCount++;
        log(`[${source_name}] New candidate: ${candidate.raw_title}`);
      }
    } catch (e) {
      log(`[${source_name}] Candidate insert threw: ${e.message}`);
      errorMessages.push(`Candidate insert threw: ${e.message}`);
      errors++;
    }
  }

  await supabase
    .from('opportunity_sources')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('id', source_id);

  const errorSummary = errorMessages.length > 0
    ? [...new Set(errorMessages)].slice(0, 5).join(' | ')
    : null;

  if (runLogId) {
    try {
      await supabase
        .from('agent_run_logs')
        .update({
          status: errors > 0 ? 'complete_with_errors' : 'complete',
          logs: logs.join('\n'),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runLogId);
    } catch (e) {
      console.warn(`[${ts()}] agent_run_logs update threw: ${e.message}`);
    }
  }

  return { found, new: newCount, errors, errorSummary, logs };
}

async function claimNextTask() {
  const { data: task, error: pollError } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('status', 'pending')
    .eq('task_type', 'planetbids_scan')
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (pollError) {
    console.error(`[${ts()}] Poll error: ${pollError.message}`);
    return null;
  }

  if (!task) return null;

  // Atomic claim — guard against concurrent workers
  const { data: claimed, error: claimError } = await supabase
    .from('agent_tasks')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', task.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (claimError || !claimed) {
    console.log(`[${ts()}] Task ${task.id} already claimed — skipping`);
    return CLAIM_RETRY;
  }

  console.log(`[${ts()}] Claimed task ${task.id} (${task.task_type}) source=${task.payload?.source_name}`);
  return task;
}

async function processTask(task) {
  try {
    const result = await runPlanetBidsScan(task, supabase);

    await supabase
      .from('agent_tasks')
      .update({
        status: 'complete',
        result: {
          found: result.found,
          new: result.new,
          errors: result.errors,
          error_summary: result.errorSummary,
        },
        error: result.errorSummary,
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    console.log(`[${ts()}] Task ${task.id} complete: found=${result.found} new=${result.new} errors=${result.errors}`);
    await maybeQualifyCandidates();
  } catch (e) {
    console.error(`[${ts()}] Task ${task.id} failed: ${e.message}`);
    await supabase
      .from('agent_tasks')
      .update({
        status: 'failed',
        error: e.message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);
  }
}

async function main() {
  console.log(`[${ts()}] BidBox worker started — polling every ${IDLE_POLL_INTERVAL_MS / 1000}s when idle`);
  while (true) {
    const task = await claimNextTask();
    if (task === CLAIM_RETRY) {
      continue;
    }

    if (task) {
      await processTask(task);
      continue;
    }

    await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(`[${ts()}] Fatal:`, e);
  process.exit(1);
});
