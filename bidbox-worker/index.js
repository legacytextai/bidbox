require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePlanetBids } = require('./drivers/planetbids');
const { scrapeCaltrans } = require('./drivers/caltrans');
const { acquirePlanetBidsDocuments, runPlanetBidsBidItemScan } = require('./drivers/planetbids_documents');
const { runPortalIntelligence } = require('./drivers/portal_intelligence');
const { acquireCaltransDocuments } = require('./drivers/caltrans_documents');
const {
  queueDocumentProcessingForCandidate,
  runDocumentProcessing,
} = require('./drivers/document_processing');
const {
  queueProjectIntelligenceForCandidate,
  runProjectIntelligence,
} = require('./drivers/project_intelligence');

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

function userFacingDocumentAcquisitionFailureMessage() {
  return 'Document acquisition failed. BidBox could not acquire source documents for this opportunity.';
}

function normalizeJson(value) {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = normalizeJson(value[key]);
        return acc;
      }, {});
  }
  return value ?? null;
}

function changedPortalMetadata(existing, next) {
  return (
    (existing.raw_title ?? null) !== (next.raw_title ?? null) ||
    (existing.agency ?? null) !== (next.agency ?? null) ||
    (existing.bid_due_at ?? null) !== (next.bid_due_at ?? null) ||
    JSON.stringify(normalizeJson(existing.crawl_data)) !== JSON.stringify(normalizeJson(next.crawl_data))
  );
}

function portalOwnedCandidateFields({ source_id, source_name, portal_type, candidate }) {
  return {
    source_id,
    source_url: candidate.source_url,
    portal_type,
    raw_title: candidate.raw_title,
    agency: source_name,
    bid_due_at: candidate.bid_due_at,
    // OML normalized columns — typed counterparts to crawl_data overflow blob
    estimated_value:      candidate.estimated_value      ?? null,
    estimated_value_low:  candidate.estimated_value_low  ?? null,
    estimated_value_high: candidate.estimated_value_high ?? null,
    county:               candidate.county               ?? null,
    project_address:      candidate.project_address      ?? null,
    required_licenses:    candidate.required_licenses    ?? null,
    required_naics:       candidate.required_naics       ?? null,
    portal_bid_id:        candidate.portal_bid_id        ?? null,
    portal_department:    candidate.portal_department    ?? null,
    crawl_data: candidate.crawl_data ?? null,
  };
}

// ── PRE-BID FORENSIC DEBUG REPORT ────────────────────────────────────────────
// Persists DOM inspection + pipeline stages to agent_tasks.payload._debug_prebid.
// Fires only for candidates with _debugPreBid or _domInspection set (bid 142972).
// Remove after root-cause is confirmed. No pipeline logic is changed here.
async function emitPreBidDebugReport(candidate, persistedRow, path, supabase, sourceTaskId) {
  const dbg = candidate?._debugPreBid;
  const dom = candidate?._domInspection;
  if (!dbg && !dom) return;

  const PRE_BID_KEYS = [
    'pre_bid_exists','pre_bid_meeting','pre_bid_meeting_at','meeting_datetime',
    'meeting_type','meeting_link','meeting_location','pre_bid_location',
    'pre_bid_meeting_link','pre_bid_notes','attendance_required',
    'job_walk_exists','job_walk_mandatory','job_walk_at',
    'job_walk_details','job_walk_location','additional_details',
  ];
  const pickKeys = (obj) =>
    Object.fromEntries(PRE_BID_KEYS.map(k => [k, (obj ?? {})[k] ?? null]));

  const stage6 = pickKeys(persistedRow?.crawl_data);
  const stage5 = dbg?.stage5_crawlData ?? null;
  const s2 = dbg?.stage2_parserOutput ?? {};
  const s4 = dbg?.stage4_normOutput ?? {};

  let firstDivergence = 'None detected — all stages consistent';
  const check = (label, a, b) => {
    for (const k of PRE_BID_KEYS) {
      const va = JSON.stringify((a ?? {})[k] ?? null);
      const vb = JSON.stringify((b ?? {})[k] ?? null);
      if (va !== vb) return `${label} — field "${k}": was ${va}, became ${vb}`;
    }
    return null;
  };
  firstDivergence =
    check('Stage 2→3', s2, dbg?.stage3_normInput) ||
    check('Stage 3→4', dbg?.stage3_normInput, s4) ||
    check('Stage 4→5', s4, stage5) ||
    check('Stage 5→6', stage5, stage6) ||
    firstDivergence;

  const debugPayload = {
    _debug_prebid: {
      recorded_at: new Date().toISOString(),
      project: candidate.raw_title,
      candidate_id: persistedRow?.id ?? null,
      bid_id: candidate.crawl_data?.bid_id ?? null,
      persist_path: path,
      dom_inspection: dom ?? null,
      stage1_raw_body_excerpt: dbg?.stage1_rawBodyExcerpt ?? null,
      stage2_parser_output: dbg?.stage2_parserOutput ?? null,
      stage3_norm_input: dbg?.stage3_normInput ?? null,
      stage4_norm_output: dbg?.stage4_normOutput ?? null,
      stage5_crawl_data: stage5,
      stage6_stored_crawl_data: stage6,
      summary: {
        parser:     { pre_bid_meeting: s2?.pre_bid_meeting, pre_bid_meeting_at: s2?.pre_bid_meeting_at, attendance_required: s2?.attendance_required },
        normalized: { pre_bid_exists: s4?.pre_bid_exists, meeting_datetime: s4?.meeting_datetime, attendance_required: s4?.attendance_required },
        stored:     { pre_bid_exists: stage6.pre_bid_exists, meeting_datetime: stage6.meeting_datetime, attendance_required: stage6.attendance_required },
        first_divergence: firstDivergence,
      },
    },
  };

  if (!sourceTaskId) return;
  try {
    const { data: taskRow } = await supabase
      .from('agent_tasks')
      .select('payload')
      .eq('id', sourceTaskId)
      .single();
    await supabase
      .from('agent_tasks')
      .update({ payload: { ...(taskRow?.payload ?? {}), ...debugPayload } })
      .eq('id', sourceTaskId);
  } catch (e) {
    // Debug write failure is non-fatal — swallow silently.
  }
}
// ─────────────────────────────────────────────────────────────────────────────

async function persistScannedCandidate({ supabase, source_id, source_name, portal_type, candidate, triggerReason, sourceTaskId, log }) {
  const portalFields = portalOwnedCandidateFields({ source_id, source_name, portal_type, candidate });
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabase
    .from('opportunity_candidates')
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
    .eq('source_url', candidate.source_url)
    .maybeSingle();
  if (lookupError) throw new Error(`Candidate lookup failed: ${lookupError.message}`);

  if (!existing) {
    const { data: inserted, error: insertError } = await supabase
      .from('opportunity_candidates')
      .insert({
        ...portalFields,
        last_metadata_refreshed_at: now,
        last_metadata_changed_at: now,
        metadata_refresh_count: 1,
        metadata_refresh_source: 'scan',
        metadata_refresh_trigger: triggerReason,
        opportunity_lifecycle_status: 'discovered',
        opportunity_intelligence_status: 'not_requested',
      })
      .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
      .single();
    if (insertError) throw new Error(`Candidate insert failed: ${insertError.message}`);
    await emitPreBidDebugReport(candidate, inserted, 'INSERT', supabase, sourceTaskId);
    // OML: F2/F3/F4 stays user-triggered. But bid items are portal-native metadata
    // (visible on the portal page without downloading documents), so we queue a
    // lightweight bid_item_scan task for PlanetBids candidates immediately.
    let bidItemTask = { queued: false, reason: 'not_supported_for_portal_type' };
    if (portal_type === 'planetbids') {
      const { error: bitError } = await supabase.from('agent_tasks').insert({
        task_type: 'bid_item_scan',
        status: 'pending',
        priority: 4,
        trigger_reason: triggerReason,
        payload: {
          candidate_id: inserted.id,
          source_url: inserted.source_url,
          portal_type: inserted.portal_type,
          source_name: source_name,
        },
      });
      bidItemTask = bitError
        ? { queued: false, reason: bitError.message }
        : { queued: true };
    }

    // Queue portal_intelligence for all new candidates — it runs on OML metadata
    // only (no document download) so it's cheap and fast for any portal type.
    const { error: piError } = await supabase.from('agent_tasks').insert({
      task_type: 'portal_intelligence',
      status: 'pending',
      priority: 3,
      trigger_reason: triggerReason,
      payload: {
        candidate_id: inserted.id,
        source_url: inserted.source_url,
        portal_type: inserted.portal_type,
        source_name: source_name,
      },
    });
    const portalIntelligenceTask = piError
      ? { queued: false, reason: piError.message }
      : { queued: true };

    // Queue document_prefetch — downloads original portal documents immediately
    // after discovery so they're in storage before the user clicks Prepare Intelligence.
    // Priority 2 (lower than bid_item_scan/portal_intelligence). Does NOT trigger F3.
    const { error: dpError } = await supabase.from('agent_tasks').insert({
      task_type: 'document_prefetch',
      status: 'pending',
      priority: 2,
      trigger_reason: triggerReason,
      payload: {
        candidate_id: inserted.id,
        source_url: inserted.source_url,
        portal_type: inserted.portal_type,
        source_name: source_name,
      },
    });
    const documentPrefetchTask = dpError
      ? { queued: false, reason: dpError.message }
      : { queued: true };

    return { state: 'new', candidate: inserted, metadataChanged: true, preparation: { queued: false, duplicate: false, skipped: true, reason: 'oml_scan_no_auto_trigger' }, bidItemTask, portalIntelligenceTask, documentPrefetchTask };
  }

  const metadataChanged = changedPortalMetadata(existing, portalFields);
  const updatePayload = {
    ...portalFields,
    last_metadata_refreshed_at: now,
    last_metadata_changed_at: metadataChanged ? now : existing.last_metadata_changed_at,
    metadata_refresh_count: (existing.metadata_refresh_count ?? 0) + 1,
    metadata_refresh_source: 'scan',
    metadata_refresh_trigger: triggerReason,
  };

  const { data: updated, error: updateError } = await supabase
    .from('opportunity_candidates')
    .update(updatePayload)
    .eq('id', existing.id)
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
    .single();
  if (updateError) throw new Error(`Candidate metadata refresh failed: ${updateError.message}`);

  await emitPreBidDebugReport(candidate, updated, 'UPDATE', supabase, sourceTaskId);

  // OML: scan-time refreshes no longer auto-queue F2/F3/F4 prep, even when
  // metadata changes. Re-analysis after a metadata change is the user's call,
  // triggered through analyze-project, not the scanner's.
  const preparation = { queued: false, duplicate: false, skipped: true, reason: 'oml_scan_no_auto_trigger' };

  return {
    state: metadataChanged ? 'refreshed' : 'unchanged',
    candidate: updated,
    metadataChanged,
    preparation,
  };
}

async function updateTaskStage(task, stage) {
  if (!task?.id) return;
  const payload = {
    ...(task.payload ?? {}),
    stage,
    stage_updated_at: new Date().toISOString(),
  };
  task.payload = payload;
  const { error } = await supabase
    .from('agent_tasks')
    .update({ payload })
    .eq('id', task.id);
  if (error) {
    console.warn(`[${ts()}] task stage update failed: ${error.message}`);
  }
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
  const { source_id, source_name, listing_url, portal_type, trigger_reason = task.trigger_reason ?? 'manual_refresh' } = task.payload;
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

  await supabase
    .from('opportunity_sources')
    .update({
      last_refresh_started_at: new Date().toISOString(),
      last_refresh_status: 'running',
      last_refresh_error: null,
    })
    .eq('id', source_id);

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
  let refreshedCount = 0;
  let unchangedCount = 0;
  let preparationQueued = 0;
  let preparationDuplicates = 0;

  for (const candidate of candidates) {
    try {
      const saved = await persistScannedCandidate({
        supabase,
        source_id,
        source_name,
        portal_type,
        candidate,
        triggerReason: trigger_reason,
        sourceTaskId: task.id,
        log,
      });

      if (saved.state === 'new') {
        newCount++;
        log(`[${source_name}] New candidate: ${candidate.raw_title}`);
      } else if (saved.state === 'refreshed') {
        refreshedCount++;
        log(`[${source_name}] Refreshed candidate metadata: ${candidate.source_url}`);
      } else {
        unchangedCount++;
        log(`[${source_name}] Already current: ${candidate.source_url}`);
      }

      if (saved.preparation?.queued) preparationQueued++;
      if (saved.preparation?.duplicate) preparationDuplicates++;
    } catch (e) {
      log(`[${source_name}] Candidate refresh threw: ${e.message}`);
      errorMessages.push(`Candidate refresh threw: ${e.message}`);
      errors++;
    }
  }

  const sourceStatus = errors > 0 && (newCount + refreshedCount + unchangedCount) > 0
    ? 'partial'
    : errors > 0
      ? 'failed'
      : 'complete';
  await supabase
    .from('opportunity_sources')
    .update({
      last_scanned_at: new Date().toISOString(),
      last_refresh_completed_at: new Date().toISOString(),
      last_refresh_failed_at: sourceStatus === 'failed' ? new Date().toISOString() : null,
      last_refresh_status: sourceStatus,
      last_refresh_error: errorMessages.length > 0 ? [...new Set(errorMessages)].slice(0, 5).join(' | ') : null,
    })
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

  return { found, new: newCount, refreshed: refreshedCount, unchanged: unchangedCount, preparationQueued, preparationDuplicates, errors, errorSummary, logs };
}

async function runCaltransScan(task, supabase) {
  const { source_id, source_name, listing_url, portal_type, trigger_reason = task.trigger_reason ?? 'manual_refresh' } = task.payload;
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

  await supabase
    .from('opportunity_sources')
    .update({
      last_refresh_started_at: new Date().toISOString(),
      last_refresh_status: 'running',
      last_refresh_error: null,
    })
    .eq('id', source_id);

  const {
    candidates,
    errors: driverErrors,
    errorMessages = [],
  } = await scrapeCaltrans(
    { source_id, source_name, listing_url, portal_type },
    log
  );

  let errors = driverErrors;
  const found = candidates.length;
  let newCount = 0;
  let refreshedCount = 0;
  let unchangedCount = 0;
  let preparationQueued = 0;
  let preparationDuplicates = 0;

  for (const candidate of candidates) {
    try {
      const saved = await persistScannedCandidate({
        supabase,
        source_id,
        source_name,
        portal_type,
        candidate,
        triggerReason: trigger_reason,
        sourceTaskId: task.id,
        log,
      });

      if (saved.state === 'new') {
        newCount++;
        log(`[${source_name}] New Caltrans candidate: ${candidate.raw_title}`);
      } else if (saved.state === 'refreshed') {
        refreshedCount++;
        log(`[${source_name}] Refreshed Caltrans candidate metadata: ${candidate.source_url}`);
      } else {
        unchangedCount++;
        log(`[${source_name}] Caltrans candidate already current: ${candidate.source_url}`);
      }

      if (saved.preparation?.queued) preparationQueued++;
      if (saved.preparation?.duplicate) preparationDuplicates++;
    } catch (e) {
      log(`[${source_name}] Candidate refresh threw: ${e.message}`);
      errorMessages.push(`Candidate refresh threw: ${e.message}`);
      errors++;
    }
  }

  const sourceStatus = errors > 0 && (newCount + refreshedCount + unchangedCount) > 0
    ? 'partial'
    : errors > 0
      ? 'failed'
      : 'complete';
  await supabase
    .from('opportunity_sources')
    .update({
      last_scanned_at: new Date().toISOString(),
      last_refresh_completed_at: new Date().toISOString(),
      last_refresh_failed_at: sourceStatus === 'failed' ? new Date().toISOString() : null,
      last_refresh_status: sourceStatus,
      last_refresh_error: errorMessages.length > 0 ? [...new Set(errorMessages)].slice(0, 5).join(' | ') : null,
    })
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

  return { found, new: newCount, refreshed: refreshedCount, unchanged: unchangedCount, preparationQueued, preparationDuplicates, errors, errorSummary, logs };
}

async function runBidItemScan(task, supabase) {
  const { candidate_id } = task.payload ?? {};
  if (!candidate_id) throw new Error('bid_item_scan task missing candidate_id');

  const { data: candidate, error } = await supabase
    .from('opportunity_candidates')
    .select('id, source_url, portal_type, portal_bid_id, crawl_data')
    .eq('id', candidate_id)
    .single();
  if (error || !candidate) throw new Error(`bid_item_scan: candidate not found — ${error?.message ?? 'no row'}`);

  const logs = [];
  const log = (msg) => { logs.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  try {
    const result = await runPlanetBidsBidItemScan({ supabase, candidate, log });
    return { ...result, logs };
  } catch (e) {
    log(`bid_item_scan error: ${e.message}`);
    throw e;
  }
}

async function runPortalIntelligenceTask(task, supabase) {
  const { candidate_id } = task.payload ?? {};
  if (!candidate_id) throw new Error('portal_intelligence task missing candidate_id');
  const logs = [];
  const log = (msg) => { logs.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };
  const result = await runPortalIntelligence({ supabase, candidateId: candidate_id, log });
  return { ...result, logs };
}

async function runProjectAnalysisAcquisition(task, supabase) {
  const { candidate_id } = task.payload;
  const logs = [];
  const screenshots = [];
  const log = (msg) => {
    const line = `[${ts()}] ${msg}`;
    logs.push(line);
    console.log(line);
  };
  log.screenshot = async (label, page) => {
    try {
      const image = await page.screenshot({ type: 'png' });
      screenshots.push({
        label,
        captured_at: new Date().toISOString(),
        mime_type: 'image/png',
        data_url: `data:image/png;base64,${image.toString('base64')}`,
      });
      log(`Screenshot captured: ${label}`);
    } catch (e) {
      log(`Screenshot capture failed: ${e.message}`);
    }
  };

  let runLogId = null;
  try {
    const { data: runLog, error: runLogError } = await supabase
      .from('agent_run_logs')
      .insert({
        task_id: task.id,
        status: 'running',
        logs: logs.join('\n'),
        screenshots,
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

  if (!candidate_id) {
    throw new Error('project_analysis task missing candidate_id');
  }

  await updateTaskStage(task, 'metadata_refresh');

  const { data: candidate, error: candidateError } = await supabase
    .from('opportunity_candidates')
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, document_acquisition_status')
    .eq('id', candidate_id)
    .maybeSingle();

  if (candidateError) throw new Error(`Candidate lookup failed: ${candidateError.message}`);
  if (!candidate) throw new Error(`Candidate not found: ${candidate_id}`);

  const startedAt = new Date().toISOString();
  await supabase
    .from('opportunity_candidates')
    .update({
      analysis_error: null,
      document_acquisition_status: 'acquiring',
      document_acquisition_started_at: startedAt,
      document_acquisition_completed_at: null,
      document_acquisition_error: null,
      opportunity_lifecycle_status: 'opportunity_intelligence_preparing',
      opportunity_intelligence_status: 'acquiring_documents',
      opportunity_intelligence_task_id: task.id,
      opportunity_intelligence_error: null,
    })
    .eq('id', candidate.id);

  log(`[${candidate.agency ?? 'Unknown agency'}] Starting document acquisition for candidate ${candidate.id}`);

  let result;
  try {
    if (candidate.portal_type === 'planetbids') {
      result = await acquirePlanetBidsDocuments({ supabase, task, candidate, log });
    } else if (candidate.portal_type === 'caltrans') {
      result = await acquireCaltransDocuments({ supabase, task, candidate, log });
    } else {
      throw new Error(`Document acquisition is not implemented for ${candidate.portal_type ?? 'unknown'} candidates`);
    }
  } catch (e) {
    const completedAt = new Date().toISOString();
    await supabase
      .from('opportunity_candidates')
      .update({
        document_acquisition_status: 'failed',
        document_acquisition_completed_at: completedAt,
        document_acquisition_error: userFacingDocumentAcquisitionFailureMessage(),
        opportunity_lifecycle_status: 'opportunity_intelligence_failed',
        opportunity_intelligence_status: 'failed',
        opportunity_intelligence_error: userFacingDocumentAcquisitionFailureMessage(),
      })
      .eq('id', candidate.id);

    if (runLogId) {
      await supabase
        .from('agent_run_logs')
        .update({
          status: 'failed',
          logs: logs.join('\n'),
          screenshots,
          completed_at: completedAt,
        })
        .eq('id', runLogId);
    }

    throw e;
  }

  const completedAt = new Date().toISOString();
  const acquisitionStatus = result.found === 0 || (result.found > 0 && result.acquired === 0 && result.skipped === 0)
    ? 'failed'
    : 'acquired';
  const technicalErrorSummary = acquisitionStatus === 'failed'
    ? result.errorSummary ?? (result.found === 0 ? 'No documents found' : 'No documents were acquired')
    : result.errorSummary;
  const warningSummary = acquisitionStatus === 'acquired' && result.failed > 0
    ? result.warningSummary ?? `Some source documents could not be acquired. BidBox successfully acquired ${result.acquired + result.skipped} of ${result.found} available documents.`
    : null;
  const userFacingAcquisitionError = acquisitionStatus === 'failed'
    ? userFacingDocumentAcquisitionFailureMessage()
    : null;
  const acquisitionSummary = {
    status: acquisitionStatus,
    documents_found: result.found,
    documents_acquired: result.acquired,
    documents_skipped: result.skipped,
    documents_failed: result.failed,
    warning_message: warningSummary,
    completed_at: completedAt,
  };

  const { data: latestCandidate, error: latestCandidateError } = await supabase
    .from('opportunity_candidates')
    .select('crawl_data')
    .eq('id', candidate.id)
    .maybeSingle();
  if (latestCandidateError) {
    log(`Latest crawl_data lookup failed before acquisition summary update: ${latestCandidateError.message}`);
  }
  const latestCrawlData = latestCandidate?.crawl_data ?? candidate.crawl_data ?? {};

  await supabase
    .from('opportunity_candidates')
    .update({
      analysis_completed_at: null,
      analysis_error: null,
      document_acquisition_status: acquisitionStatus,
      document_acquisition_completed_at: completedAt,
      document_acquisition_error: userFacingAcquisitionError,
      opportunity_lifecycle_status: acquisitionStatus === 'failed'
        ? 'opportunity_intelligence_failed'
        : 'opportunity_intelligence_preparing',
      opportunity_intelligence_status: acquisitionStatus === 'failed'
        ? 'failed'
        : 'processing_documents',
      opportunity_intelligence_error: userFacingAcquisitionError,
      crawl_data: {
        ...latestCrawlData,
        acquisition_summary: acquisitionSummary,
      },
    })
    .eq('id', candidate.id);

  let documentProcessingTaskId = null;
  let documentProcessingDuplicate = false;
  let projectIntelligenceTaskId = null;
  let projectIntelligenceDuplicate = false;
  let projectIntelligenceSkipped = false;
  if (acquisitionStatus === 'acquired' && (result.acquired + result.skipped) > 0) {
    try {
      if (task.payload?.safe_reanalysis) {
        const queued = await queueProjectIntelligenceForCandidate({
          supabase,
          candidateId: candidate.id,
          sourceTaskId: task.id,
          safeReanalysis: true,
        });
        projectIntelligenceTaskId = queued.taskId;
        projectIntelligenceDuplicate = queued.duplicate;
        projectIntelligenceSkipped = Boolean(queued.skipped);
        if (queued.skipped) {
          log(`Safe Project Intelligence re-analysis not queued: ${queued.reason}`);
        } else {
          log(`Safe Project Intelligence re-analysis ${queued.duplicate ? 'already queued' : 'queued'}: ${queued.taskId}`);
        }
      } else {
        const queued = await queueDocumentProcessingForCandidate({
          supabase,
          candidateId: candidate.id,
        });
        documentProcessingTaskId = queued.taskId;
        documentProcessingDuplicate = queued.duplicate;
        log(`Document processing ${queued.duplicate ? 'already queued' : 'queued'}: ${queued.taskId}`);
      }
    } catch (e) {
      log(`${task.payload?.safe_reanalysis ? 'Safe Project Intelligence re-analysis' : 'Document processing'} queue failed: ${e.message}`);
    }
  }

  if (runLogId) {
    try {
      await supabase
        .from('agent_run_logs')
        .update({
          status: technicalErrorSummary ? 'complete_with_errors' : 'complete',
          logs: logs.join('\n'),
          screenshots,
          completed_at: completedAt,
        })
        .eq('id', runLogId);
    } catch (e) {
      console.warn(`[${ts()}] agent_run_logs update threw: ${e.message}`);
    }
  }

  return {
    candidate_id: candidate.id,
    documents_found: result.found,
    documents_acquired: result.acquired,
    documents_skipped: result.skipped,
    documents_failed: result.failed,
    document_processing_task_id: documentProcessingTaskId,
    document_processing_duplicate: documentProcessingDuplicate,
    project_intelligence_task_id: projectIntelligenceTaskId,
    project_intelligence_duplicate: projectIntelligenceDuplicate,
    project_intelligence_skipped: projectIntelligenceSkipped,
    acquisition_status: acquisitionStatus,
    warningSummary,
    errorSummary: technicalErrorSummary,
  };
}

async function runDocumentProcessingTask(task, supabase) {
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

  try {
    await updateTaskStage(task, 'metadata_refresh');
    const result = await runDocumentProcessing(task, supabase, log);
    log('Bid item document fallback disabled: bid items are portal-authoritative only');
    let projectIntelligenceTaskId = null;
    let projectIntelligenceDuplicate = false;
    let projectIntelligenceSkipped = false;
    if (
      ['processed', 'partial'].includes(result.status)
      && result.chunks_created > 0
    ) {
      try {
        const queued = await queueProjectIntelligenceForCandidate({
          supabase,
          candidateId: result.candidate_id,
          sourceTaskId: task.id,
        });
        projectIntelligenceTaskId = queued.taskId;
        projectIntelligenceDuplicate = queued.duplicate;
        projectIntelligenceSkipped = Boolean(queued.skipped);
        if (queued.skipped) {
          log(`Project Intelligence not queued: ${queued.reason}`);
        } else {
          log(`Project Intelligence ${queued.duplicate ? 'already queued' : 'queued'}: ${queued.taskId}`);
        }
      } catch (e) {
        log(`Project Intelligence queue failed: ${e.message}`);
      }
    }
    if (runLogId) {
      await supabase
        .from('agent_run_logs')
        .update({
          status: result.errorSummary ? 'complete_with_errors' : 'complete',
          logs: logs.join('\n'),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runLogId);
    }
    return {
      ...result,
      project_intelligence_task_id: projectIntelligenceTaskId,
      project_intelligence_duplicate: projectIntelligenceDuplicate,
      project_intelligence_skipped: projectIntelligenceSkipped,
    };
  } catch (e) {
    if (runLogId) {
      await supabase
        .from('agent_run_logs')
        .update({
          status: 'failed',
          logs: logs.join('\n'),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runLogId);
    }
    throw e;
  }
}

async function runProjectIntelligenceTask(task, supabase) {
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

  try {
    const result = await runProjectIntelligence(task, supabase, log);
    if (runLogId) {
      await supabase
        .from('agent_run_logs')
        .update({
          status: result.errorSummary ? 'complete_with_errors' : 'complete',
          logs: logs.join('\n'),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runLogId);
    }
    return result;
  } catch (e) {
    if (runLogId) {
      await supabase
        .from('agent_run_logs')
        .update({
          status: 'failed',
          logs: logs.join('\n'),
          completed_at: new Date().toISOString(),
        })
        .eq('id', runLogId);
    }
    throw e;
  }
}

async function claimNextTask() {
  const { data: task, error: pollError } = await supabase
    .from('agent_tasks')
    .select('*')
    .eq('status', 'pending')
    .in('task_type', ['planetbids_scan', 'caltrans_scan', 'bid_item_scan', 'portal_intelligence', 'document_prefetch', 'project_analysis', 'document_processing', 'project_intelligence'])
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

// ── document_prefetch ─────────────────────────────────────────────────────────
// Downloads originals from the portal immediately after discovery, before the
// user clicks Prepare Intelligence. Does NOT queue F3 (chunking/embedding).
// Per-document idempotency in upsertDocumentRecord means F2 re-runs simply skip
// already-stored files and proceed directly to queuing document processing.
async function runDocumentPrefetchTask(task, supabase) {
  const candidateId = task.payload?.candidate_id;
  if (!candidateId) throw new Error('document_prefetch task missing candidate_id');

  const { data: candidate, error } = await supabase
    .from('opportunity_candidates')
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`document_prefetch: candidate lookup failed: ${error.message}`);
  if (!candidate) throw new Error(`document_prefetch: candidate not found: ${candidateId}`);

  const log = (msg) => console.log(`[${new Date().toISOString()}] [prefetch:${candidateId.slice(0, 8)}] ${msg}`);
  log(`Starting document prefetch for ${candidate.raw_title ?? candidateId} (${candidate.portal_type})`);

  let result;
  if (candidate.portal_type === 'planetbids') {
    result = await acquirePlanetBidsDocuments({ supabase, task, candidate, log });
  } else if (candidate.portal_type === 'caltrans') {
    result = await acquireCaltransDocuments({ supabase, task, candidate, log });
  } else {
    throw new Error(`document_prefetch not implemented for portal_type=${candidate.portal_type}`);
  }

  log(`Prefetch complete: found=${result.found} acquired=${result.acquired} skipped=${result.skipped} failed=${result.failed}`);
  return result;
}

async function processTask(task) {
  try {
    let result;
    if (task.task_type === 'planetbids_scan') {
      result = await runPlanetBidsScan(task, supabase);
    } else if (task.task_type === 'caltrans_scan') {
      result = await runCaltransScan(task, supabase);
    } else if (task.task_type === 'bid_item_scan') {
      result = await runBidItemScan(task, supabase);
    } else if (task.task_type === 'portal_intelligence') {
      result = await runPortalIntelligenceTask(task, supabase);
    } else if (task.task_type === 'document_prefetch') {
      result = await runDocumentPrefetchTask(task, supabase);
    } else if (task.task_type === 'project_analysis') {
      result = await runProjectAnalysisAcquisition(task, supabase);
    } else if (task.task_type === 'document_processing') {
      result = await runDocumentProcessingTask(task, supabase);
    } else if (task.task_type === 'project_intelligence') {
      result = await runProjectIntelligenceTask(task, supabase);
    } else {
      throw new Error(`Unsupported task type: ${task.task_type}`);
    }

    const taskResult = ['planetbids_scan', 'caltrans_scan'].includes(task.task_type)
      ? {
          found: result.found,
          new: result.new,
          refreshed: result.refreshed ?? 0,
          unchanged: result.unchanged ?? 0,
          opportunity_intelligence_queued: result.preparationQueued ?? 0,
          opportunity_intelligence_duplicates: result.preparationDuplicates ?? 0,
          errors: result.errors,
          error_summary: result.errorSummary,
          phase: task.task_type === 'caltrans_scan' ? 'caltrans_discovery_v1' : 'planetbids_discovery',
          document_acquisition_supported: true,
          trigger_reason: task.payload?.trigger_reason ?? task.trigger_reason ?? null,
          refresh_window: task.payload?.refresh_window ?? task.refresh_window ?? null,
        }
      : task.task_type === 'document_processing'
      ? {
          candidate_id: result.candidate_id,
          documents_total: result.documents_total,
          documents_processed: result.documents_processed,
          documents_partial: result.documents_partial,
          documents_failed: result.documents_failed,
          documents_unsupported: result.documents_unsupported,
          documents_skipped: result.documents_skipped,
          pages_extracted: result.pages_extracted,
          chunks_created: result.chunks_created,
          needs_ocr_count: result.needs_ocr_count,
          project_intelligence_task_id: result.project_intelligence_task_id,
          project_intelligence_duplicate: result.project_intelligence_duplicate,
          project_intelligence_skipped: result.project_intelligence_skipped,
          error_summary: result.errorSummary,
          phase: 'f3_document_processing',
          intelligence_status: result.project_intelligence_task_id ? 'queued' : 'not_generated',
        }
      : task.task_type === 'project_intelligence'
      ? {
          candidate_id: result.candidate_id,
          report_id: result.report_id,
          status: result.status,
          findings_inserted: result.findings_inserted,
          citations_inserted: result.citations_inserted,
          critical_findings: result.critical_findings,
          executive_summary_bullets: result.executive_summary_bullets,
          warning_summary: result.warningSummary,
          error_summary: result.errorSummary,
          phase: 'f4_project_intelligence',
          no_citation_no_fact: true,
        }
      : task.task_type === 'bid_item_scan'
      ? {
          candidate_id: task.payload?.candidate_id ?? null,
          portal_type: task.payload?.portal_type ?? null,
          rows_extracted: result.extracted ?? 0,
          rows_stored: result.inserted ?? 0,
          phase: 'portal_bid_item_scan',
        }
      : task.task_type === 'document_prefetch'
      ? {
          candidate_id: task.payload?.candidate_id ?? null,
          portal_type: task.payload?.portal_type ?? null,
          documents_found: result.found ?? 0,
          documents_prefetched: result.acquired ?? 0,
          documents_skipped: result.skipped ?? 0,
          documents_failed: result.failed ?? 0,
          phase: 'document_prefetch_v1',
        }
      : task.task_type === 'portal_intelligence'
      ? {
          candidate_id: task.payload?.candidate_id ?? null,
          portal_type: task.payload?.portal_type ?? null,
          summary_written: Boolean(result.summary),
          summary_length: result.summary?.length ?? 0,
          phase: 'portal_intelligence_v1',
        }
      : {
          candidate_id: result.candidate_id,
          documents_found: result.documents_found,
          documents_acquired: result.documents_acquired,
          documents_skipped: result.documents_skipped,
          documents_failed: result.documents_failed,
          acquisition_status: result.acquisition_status,
          document_processing_task_id: result.document_processing_task_id,
          document_processing_duplicate: result.document_processing_duplicate,
          project_intelligence_task_id: result.project_intelligence_task_id,
          project_intelligence_duplicate: result.project_intelligence_duplicate,
          project_intelligence_skipped: result.project_intelligence_skipped,
          warning_summary: result.warningSummary,
          error_summary: result.errorSummary,
          phase: 'f2_document_acquisition',
          intelligence_status: result.project_intelligence_task_id ? 'queued' : 'not_generated',
        };

    const taskError = task.task_type === 'project_analysis'
      ? (result.acquisition_status === 'failed' ? result.errorSummary : null)
      : ['bid_item_scan', 'portal_intelligence', 'document_prefetch'].includes(task.task_type)
      ? null
      : result.errorSummary;

    await supabase
      .from('agent_tasks')
      .update({
        status: 'complete',
        result: taskResult,
        error: taskError,
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    if (['planetbids_scan', 'caltrans_scan'].includes(task.task_type)) {
      console.log(`[${ts()}] Task ${task.id} complete: found=${result.found} new=${result.new} refreshed=${result.refreshed ?? 0} unchanged=${result.unchanged ?? 0} errors=${result.errors}`);
      await maybeQualifyCandidates();
    } else if (task.task_type === 'document_processing') {
      console.log(`[${ts()}] Task ${task.id} complete: documents_processed=${result.documents_processed} documents_failed=${result.documents_failed} pages=${result.pages_extracted} chunks=${result.chunks_created}`);
    } else if (task.task_type === 'project_intelligence') {
      console.log(`[${ts()}] Task ${task.id} complete: report=${result.report_id} findings=${result.findings_inserted} citations=${result.citations_inserted}`);
    } else {
      console.log(`[${ts()}] Task ${task.id} complete: documents_acquired=${result.documents_acquired} documents_failed=${result.documents_failed}`);
    }
  } catch (e) {
    console.error(`[${ts()}] Task ${task.id} failed: ${e.message}`);
    if (['planetbids_scan', 'caltrans_scan'].includes(task.task_type) && task.payload?.source_id) {
      await supabase
        .from('opportunity_sources')
        .update({
          last_refresh_failed_at: new Date().toISOString(),
          last_refresh_status: 'failed',
          last_refresh_error: e.message,
        })
        .eq('id', task.payload.source_id);
    }
    if (task.task_type === 'project_analysis' && task.payload?.candidate_id) {
      await supabase
        .from('opportunity_candidates')
        .update({
          document_acquisition_status: 'failed',
          document_acquisition_completed_at: new Date().toISOString(),
          document_acquisition_error: userFacingDocumentAcquisitionFailureMessage(),
          opportunity_lifecycle_status: 'opportunity_intelligence_failed',
          opportunity_intelligence_status: 'failed',
          opportunity_intelligence_error: userFacingDocumentAcquisitionFailureMessage(),
        })
        .eq('id', task.payload.candidate_id);
    }
    if (task.task_type === 'document_processing' && task.payload?.candidate_id) {
      await supabase
        .from('opportunity_candidates')
        .update({
          document_processing_status: 'failed',
          document_processing_completed_at: new Date().toISOString(),
          document_processing_error: e.message,
          opportunity_lifecycle_status: 'opportunity_intelligence_failed',
          opportunity_intelligence_status: 'failed',
          opportunity_intelligence_error: e.message,
        })
        .eq('id', task.payload.candidate_id);
    }
    if (task.task_type === 'project_intelligence' && task.payload?.candidate_id) {
      await supabase
        .from('opportunity_candidates')
        .update({
          analysis_status: 'failed',
          analysis_completed_at: new Date().toISOString(),
          analysis_error: e.message,
          opportunity_lifecycle_status: 'opportunity_intelligence_failed',
          opportunity_intelligence_status: 'failed',
          opportunity_intelligence_error: e.message,
        })
        .eq('id', task.payload.candidate_id);
    }
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
