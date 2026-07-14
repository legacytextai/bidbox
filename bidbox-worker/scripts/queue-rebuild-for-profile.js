#!/usr/bin/env node
// Queue a qualification rebuild for a Bid Profile with the service role,
// mirroring public.queue_qualification_rebuild exactly (supersede running
// jobs -> bump profile_version -> insert qualification_jobs row -> insert
// qualification_rebuild agent task). Used for operational re-runs after a
// qualification-policy deploy; end users trigger the same path by saving
// their Bid Profile.
// Usage: railway run --service bidbox node bidbox-worker/scripts/queue-rebuild-for-profile.js <gc_qualification_profiles.id>
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const profileRowId = process.argv[2];
  if (!profileRowId) throw new Error('pass gc_qualification_profiles.id');

  const { data: profile, error: profileError } = await supabase
    .from('gc_qualification_profiles').select('*').eq('id', profileRowId).maybeSingle();
  if (profileError || !profile) throw new Error(`profile: ${profileError?.message ?? 'not found'}`);

  const now = new Date().toISOString();
  const { error: supersedeError } = await supabase.from('qualification_jobs')
    .update({ status: 'superseded', completed_at: now, updated_at: now })
    .eq('bid_profile_id', profile.id).in('status', ['queued', 'running']);
  if (supersedeError) throw new Error(`supersede: ${supersedeError.message}`);

  const nextVersion = profile.profile_version + 1;
  const { error: bumpError } = await supabase.from('gc_qualification_profiles')
    .update({ profile_version: nextVersion, updated_at: now })
    .eq('id', profile.id).eq('profile_version', profile.profile_version);
  if (bumpError) throw new Error(`version bump: ${bumpError.message}`);

  const { data: job, error: jobError } = await supabase.from('qualification_jobs')
    .insert({ user_id: profile.profile_id, bid_profile_id: profile.id, profile_version: nextVersion })
    .select().single();
  if (jobError) throw new Error(`job insert: ${jobError.message}`);

  const { error: taskError } = await supabase.from('agent_tasks').insert({
    task_type: 'qualification_rebuild',
    status: 'pending',
    priority: 8,
    trigger_reason: 'qualification_policy_redeploy',
    payload: {
      qualification_job_id: job.id,
      user_id: profile.profile_id,
      bid_profile_id: profile.id,
      profile_version: nextVersion,
    },
  });
  if (taskError) throw new Error(`task insert: ${taskError.message}`);

  console.log(`queued qualification_rebuild job ${job.id} for profile ${profile.id} (user ${profile.profile_id}) version ${nextVersion}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
