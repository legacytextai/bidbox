require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePlanetBids } = require('./drivers/planetbids');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function ts() {
  return new Date().toISOString();
}

async function runPlanetBidsScan(task, supabase) {
  const { source_id, source_name, listing_url, portal_type } = task.payload;
  const log = (msg) => console.log(`[${ts()}] ${msg}`);

  const { candidates, errors: driverErrors } = await scrapePlanetBids(
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
      errors++;
    }
  }

  await supabase
    .from('opportunity_sources')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('id', source_id);

  return { found, new: newCount, errors };
}

async function pollOnce() {
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
    return;
  }

  if (!task) return;

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
    return;
  }

  console.log(`[${ts()}] Claimed task ${task.id} (${task.task_type}) source=${task.payload?.source_name}`);

  try {
    const result = await runPlanetBidsScan(task, supabase);

    await supabase
      .from('agent_tasks')
      .update({
        status: 'complete',
        result: { found: result.found, new: result.new, errors: result.errors },
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    console.log(`[${ts()}] Task ${task.id} complete: found=${result.found} new=${result.new} errors=${result.errors}`);

    const qualifyUrl = process.env.QUALIFY_CANDIDATES_URL;
    if (qualifyUrl) {
      try {
        const qualifyRes = await fetch(qualifyUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
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
  console.log(`[${ts()}] BidBox worker started — polling every 30s`);
  while (true) {
    await pollOnce();
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
}

main().catch((e) => {
  console.error(`[${ts()}] Fatal:`, e);
  process.exit(1);
});
