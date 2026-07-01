'use strict';
/**
 * Refresh portal intelligence for a specific candidate.
 *
 * Finds the candidate by partial title or agency match, then either:
 *   - Queues a portal_intelligence worker task (default), or
 *   - Runs the driver inline with --inline flag
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/refresh-portal-intelligence.js --title "IFB 2026-08" [--agency "City of Pomona"] [--inline]
 *
 * --inline: run the portal intelligence driver in this process instead of
 *           queuing a worker task (slower, but shows the new summary immediately)
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

const args = process.argv.slice(2);
const INLINE = args.includes('--inline');
const titleArg = args[args.indexOf('--title') + 1] ?? null;
const agencyArg = args[args.indexOf('--agency') + 1] ?? null;

if (!titleArg) {
  console.error('ERROR: --title <partial-title> is required.');
  process.exit(1);
}

async function main() {
  console.log(`\nRefresh portal intelligence — title contains: "${titleArg}"${agencyArg ? `, agency contains: "${agencyArg}"` : ''}\n`);

  let query = sb
    .from('opportunity_candidates')
    .select('id, raw_title, agency, portal_summary, portal_summary_at')
    .ilike('raw_title', `%${titleArg}%`);

  if (agencyArg) query = query.ilike('agency', `%${agencyArg}%`);

  const { data: candidates, error } = await query.limit(5);
  if (error) { console.error('Query failed:', error.message); process.exit(1); }
  if (!candidates?.length) { console.log('No matching candidates found.'); return; }

  if (candidates.length > 1) {
    console.log('Multiple matches:');
    candidates.forEach((c, i) => console.log(`  ${i + 1}. [${c.id.slice(0, 8)}] ${c.agency} — ${c.raw_title?.slice(0, 80)}`));
    console.log('\nRefine with --agency or a longer --title string.');
    return;
  }

  const candidate = candidates[0];
  console.log(`Found: [${candidate.id}]`);
  console.log(`  Agency:  ${candidate.agency}`);
  console.log(`  Title:   ${candidate.raw_title}`);
  if (candidate.portal_summary_at) {
    console.log(`  Current summary (${new Date(candidate.portal_summary_at).toLocaleString()}):`);
    console.log(`  ${candidate.portal_summary?.slice(0, 200) ?? '(none)'}...\n`);
  }

  if (INLINE) {
    // Run inline — requires OPENAI_API_KEY + BROWSERBASE_API_KEY to be set.
    const { runPortalIntelligence } = require('../drivers/portal_intelligence');
    console.log('Running portal intelligence inline...\n');
    const result = await runPortalIntelligence({
      supabase: sb,
      candidateId: candidate.id,
      log: (msg) => console.log(`  [log] ${msg}`),
    });
    console.log('\nNew summary:');
    console.log(result.summary);
  } else {
    // Queue a worker task.
    const requestedAt = new Date().toISOString();
    const { data: task, error: taskError } = await sb
      .from('agent_tasks')
      .insert({
        task_type: 'portal_intelligence',
        status: 'pending',
        priority: 0,
        trigger_reason: 'manual_refresh',
        refresh_window: requestedAt.slice(0, 13),
        payload: { candidate_id: candidate.id },
      })
      .select('id')
      .single();

    if (taskError) { console.error('Task insert failed:', taskError.message); process.exit(1); }
    console.log(`\nQueued portal_intelligence task: ${task.id}`);
    console.log('The worker will pick it up on the next poll cycle.');
    console.log('Check opportunity_candidates.portal_summary once it completes.\n');
  }
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
