require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePlanetBids } = require('./drivers/planetbids');
const { scrapeCaltrans } = require('./drivers/caltrans');
const { scrapeLaCountyDpw } = require('./drivers/lacounty_dpw');
const { scrapeLacmta } = require('./drivers/lacmta');
const { scrapeCalEprocure } = require('./drivers/caleprocure');
const { scrapeOpenGov } = require('./drivers/opengov');
const { replaceBidItemsForCandidate } = require('./drivers/bid_items');
const { acquirePlanetBidsDocuments, runPlanetBidsBidItemScan } = require('./drivers/planetbids_documents');
const { runPortalIntelligence } = require('./drivers/portal_intelligence');
const { acquireCaltransDocuments } = require('./drivers/caltrans_documents');
const { acquireOpenGovDocuments } = require('./drivers/opengov_documents');
const { acquireCalEprocureDocuments } = require('./drivers/caleprocure_documents');
const { classifyIngestionCandidate } = require('./lib/opportunity-policy');
const { runPlanetBidsCandidateRecovery } = require('./drivers/planetbids_recovery');
const { runQualificationCandidateFanout, runQualificationRebuild } = require('./drivers/qualification_jobs');
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
const CLAIM_RETRY = Symbol('claim-retry');
const CALEPROCURE_SOURCE_ID = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82';

// ── PlanetBids distributed login lock ────────────────────────────────────────
// Only one Railway worker may hold an active PlanetBids browser session at a
// time.  Concurrent logins with the same account invalidate each other's
// session token, causing every parallel document_prefetch to fail.
// The lock is stored in app_settings and managed by two PostgreSQL functions
// (acquire_planetbids_lock / release_planetbids_lock) in the migration
// 20260701120000_planetbids_login_lock.sql.

// ── Env guardrail helpers ─────────────────────────────────────────────────────
function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}
function envBool(name, fallback) {
  const v = process.env[name];
  if (v == null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

const PLANETBIDS_LOCK_TTL_SECONDS = 600;   // 10 min — covers longest browser session
const PLANETBIDS_LOCK_RETRY_DELAY_MS = envNumber('PLANETBIDS_LOCK_RETRY_DELAY_MS', 20_000);  // 20 s between retries
// Cap the lock wait so a worker is never held for many minutes when many
// PlanetBids document_prefetch tasks contend for the single login lock.
// Default 3 attempts × 20 s ≈ 1 min (was 15 × 20 s = 5 min).
const PLANETBIDS_LOCK_MAX_RETRIES = envNumber('PLANETBIDS_LOCK_MAX_WAIT_ATTEMPTS', 3);
// After giving up the lock wait, cool down before releasing the worker so it
// doesn't immediately re-claim the same task and hot-loop on the lock.
const PLANETBIDS_LOCK_REQUEUE_DELAY_MS = envNumber('PLANETBIDS_LOCK_REQUEUE_DELAY_MS', 15_000);

class PlanetBidsLockTimeoutError extends Error {
  constructor(attempts) {
    super(`PlanetBids login lock not available after ${attempts} attempts — requeueing task`);
    this.name = 'PlanetBidsLockTimeoutError';
  }
}

async function acquirePlanetBidsLock(workerId, log) {
  for (let attempt = 1; attempt <= PLANETBIDS_LOCK_MAX_RETRIES; attempt++) {
    const { data: acquired, error } = await supabase.rpc('acquire_planetbids_lock', {
      p_worker_id: workerId,
      p_ttl_seconds: PLANETBIDS_LOCK_TTL_SECONDS,
    });
    if (error) throw new Error(`PlanetBids lock RPC error: ${error.message}`);
    if (acquired) {
      log(`PlanetBids lock acquired (worker=${workerId.slice(0, 8)}, attempt=${attempt})`);
      return;
    }
    log(`PlanetBids lock held — waiting ${PLANETBIDS_LOCK_RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${PLANETBIDS_LOCK_MAX_RETRIES})`);
    await new Promise((r) => setTimeout(r, PLANETBIDS_LOCK_RETRY_DELAY_MS));
  }
  throw new PlanetBidsLockTimeoutError(PLANETBIDS_LOCK_MAX_RETRIES);
}

async function releasePlanetBidsLock(workerId, log) {
  const { error } = await supabase.rpc('release_planetbids_lock', { p_worker_id: workerId });
  if (error) log(`Warning: PlanetBids lock release RPC error: ${error.message}`);
  else log(`PlanetBids lock released (worker=${workerId.slice(0, 8)})`);
}

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
  const ingestion = classifyIngestionCandidate(portal_type, candidate);
  return {
    source_id,
    source_url: candidate.source_url,
    portal_type,
    raw_title: candidate.raw_title,
    agency: candidate.agency ?? source_name,
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
    ingestion_status: ingestion.status,
    ingestion_issue_code: ingestion.code,
    ingestion_issue_reason: ingestion.reason,
  };
}

function safePortalRefreshFields(existing, incoming) {
  const merged = { ...incoming };
  for (const [field, value] of Object.entries(incoming)) {
    if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
      if (existing[field] !== null && existing[field] !== undefined && existing[field] !== '') {
        merged[field] = existing[field];
      }
    }
  }
  if (existing.crawl_data && incoming.crawl_data && typeof existing.crawl_data === 'object' && typeof incoming.crawl_data === 'object') {
    merged.crawl_data = { ...existing.crawl_data, ...incoming.crawl_data };
  }
  // A failed/empty refresh cannot quarantine a previously valid, titled row.
  if (existing.ingestion_status === 'valid' && String(existing.raw_title ?? '').trim() && incoming.ingestion_status === 'quarantined') {
    merged.ingestion_status = 'valid';
    merged.ingestion_issue_code = existing.ingestion_issue_code ?? null;
    merged.ingestion_issue_reason = existing.ingestion_issue_reason ?? null;
  }
  return merged;
}

function supportsDocumentPrefetch(portalType) {
  // Discovery-only drivers deliberately stop at metadata. Their scan task
  // result reports document_acquisition_supported=false, and new candidates
  // should not enqueue no-op document_prefetch work.
  return !['caleprocure', 'opengov'].includes(portalType);
}

function effectivePortalType(portalType, sourceId) {
  if (portalType) return portalType;
  if (sourceId === CALEPROCURE_SOURCE_ID) return 'caleprocure';
  return portalType;
}

async function markCalEprocureDuplicateOfCaltrans({ supabase, source_id, candidate, caltransDuplicate, triggerReason, log }) {
  const now = new Date().toISOString();
  const duplicateCrawlData = {
    ...(candidate.crawl_data ?? {}),
    duplicate_of_caltrans: true,
    duplicate_of_candidate_id: caltransDuplicate.id,
    duplicate_of_source_url: caltransDuplicate.source_url,
    duplicate_match_field: 'portal_bid_id',
    duplicate_match_value: candidate.portal_bid_id,
    duplicate_marked_at: now,
  };

  const { data: existing, error: lookupError } = await supabase
    .from('opportunity_candidates')
    .select('id, crawl_data')
    .eq('source_id', source_id)
    .eq('portal_bid_id', candidate.portal_bid_id)
    .maybeSingle();
  if (lookupError) throw new Error(`Cal eProcure duplicate lookup failed: ${lookupError.message}`);

  const updatePayload = {
    source_id,
    source_url: candidate.source_url,
    portal_type: 'caleprocure',
    raw_title: candidate.raw_title,
    agency: candidate.agency,
    bid_due_at: candidate.bid_due_at,
    estimated_value: candidate.estimated_value ?? null,
    estimated_value_low: candidate.estimated_value_low ?? null,
    estimated_value_high: candidate.estimated_value_high ?? null,
    county: candidate.county ?? null,
    project_address: candidate.project_address ?? null,
    required_licenses: candidate.required_licenses ?? null,
    required_naics: candidate.required_naics ?? null,
    portal_department: candidate.portal_department ?? null,
    crawl_data: {
      ...(existing?.crawl_data ?? {}),
      ...duplicateCrawlData,
    },
    auto_status: 'red',
    auto_status_reason: `Duplicate of Caltrans-native opportunity ${candidate.portal_bid_id}`,
    global_exclusion_code: 'duplicate_of_caltrans',
    global_exclusion_reason: `Duplicate of Caltrans opportunity ${candidate.portal_bid_id}`,
    canonical_candidate_id: caltransDuplicate.id,
    qualification_score: 0,
    qualified_at: now,
    last_metadata_refreshed_at: now,
    metadata_refresh_source: 'scan',
    metadata_refresh_trigger: triggerReason,
  };

  if (existing?.id) {
    const { error } = await supabase
      .from('opportunity_candidates')
      .update(updatePayload)
      .eq('id', existing.id);
    if (error) throw new Error(`Cal eProcure duplicate update failed: ${error.message}`);
    log(`Marked Cal eProcure duplicate ${candidate.portal_bid_id} as duplicate_of_caltrans (${existing.id} -> ${caltransDuplicate.id})`);
    return { state: 'duplicate_marked', candidate_id: existing.id };
  }

  const { data: inserted, error } = await supabase
    .from('opportunity_candidates')
    .insert({
      ...updatePayload,
      portal_type: 'caleprocure',
      portal_bid_id: candidate.portal_bid_id,
      opportunity_lifecycle_status: 'discovered',
      opportunity_intelligence_status: 'not_requested',
      metadata_refresh_count: 1,
      last_metadata_changed_at: now,
    })
    .select('id')
    .single();
  if (error) throw new Error(`Cal eProcure duplicate insert failed: ${error.message}`);
  log(`Inserted suppressed Cal eProcure duplicate ${candidate.portal_bid_id} as duplicate_of_caltrans (${inserted.id} -> ${caltransDuplicate.id})`);
  return { state: 'duplicate_inserted', candidate_id: inserted.id };
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
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, estimated_value, estimated_value_low, estimated_value_high, county, project_address, required_licenses, required_naics, portal_bid_id, portal_department, crawl_data, ingestion_status, ingestion_issue_code, ingestion_issue_reason, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
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
      .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, ingestion_status, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
      .single();
    if (insertError) throw new Error(`Candidate insert failed: ${insertError.message}`);
    await emitPreBidDebugReport(candidate, inserted, 'INSERT', supabase, sourceTaskId);
    // OML: F2/F3/F4 stays user-triggered.
    // bid_item_scan is NOT queued for PlanetBids because document_prefetch
    // (via getAuthenticatedManifest) already extracts and stores bid items in
    // the same browser session. Queuing both causes concurrent PlanetBids logins
    // that invalidate each other's auth token.
    const bidItemTask = { queued: false, reason: 'superseded_by_document_prefetch' };

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

    let documentPrefetchTask = { queued: false, reason: 'document_acquisition_not_supported' };
    // Kill switch — broad/nightly PlanetBids scans are metadata-only by default.
    // PlanetBids is the dominant portal (many sources × many opportunities), and
    // auto-enqueuing a document_prefetch per new candidate floods the queue with
    // Browserbase+login work that saturates every worker (Browserbase 429s,
    // login-lock contention). Documents are still acquired on demand when the
    // user runs Prepare Intelligence (project_analysis path). Set
    // PLANETBIDS_AUTO_DOCUMENT_PREFETCH_ENABLED=true to restore auto-prefetch.
    const autoPrefetchAllowed =
      inserted.portal_type === 'planetbids'
        ? envBool('PLANETBIDS_AUTO_DOCUMENT_PREFETCH_ENABLED', false)
        : true;
    if (supportsDocumentPrefetch(inserted.portal_type) && !autoPrefetchAllowed) {
      documentPrefetchTask = { queued: false, reason: 'planetbids_auto_document_prefetch_disabled' };
    } else if (supportsDocumentPrefetch(inserted.portal_type)) {
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
      documentPrefetchTask = dpError
        ? { queued: false, reason: dpError.message }
        : { queued: true };
    }

    return { state: 'new', candidate: inserted, metadataChanged: true, preparation: { queued: false, duplicate: false, skipped: true, reason: 'oml_scan_no_auto_trigger' }, bidItemTask, portalIntelligenceTask, documentPrefetchTask };
  }

  const safePortalFields = safePortalRefreshFields(existing, portalFields);
  const metadataChanged = changedPortalMetadata(existing, safePortalFields);
  const updatePayload = {
    ...safePortalFields,
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
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, crawl_data, ingestion_status, converted_project_id, analysis_status, document_acquisition_status, document_processing_status, opportunity_intelligence_status, last_metadata_changed_at, metadata_refresh_count')
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

async function enforceCaltransCanonical({ supabase, caltransCandidate, log }) {
  if (!caltransCandidate?.id || !caltransCandidate?.portal_bid_id) return 0;
  const now = new Date().toISOString();
  const reason = `Duplicate of Caltrans opportunity ${caltransCandidate.portal_bid_id}`;
  const { data, error } = await supabase
    .from('opportunity_candidates')
    .update({
      global_exclusion_code: 'duplicate_of_caltrans',
      global_exclusion_reason: reason,
      canonical_candidate_id: caltransCandidate.id,
      auto_status: 'red',
      auto_status_reason: reason,
      qualification_score: 0,
      qualified_at: now,
    })
    .eq('portal_type', 'caleprocure')
    .eq('portal_bid_id', caltransCandidate.portal_bid_id)
    .neq('id', caltransCandidate.id)
    .select('id');
  if (error) throw new Error(`Cal eProcure canonicalization failed: ${error.message}`);

  // A Caltrans row can carry a stale reversed link from historical cleanup.
  const { error: canonicalError } = await supabase
    .from('opportunity_candidates')
    .update({ global_exclusion_code: null, global_exclusion_reason: null, canonical_candidate_id: null })
    .eq('id', caltransCandidate.id)
    .eq('global_exclusion_code', 'duplicate_of_caleprocure');
  if (canonicalError) throw new Error(`Caltrans canonical normalization failed: ${canonicalError.message}`);
  if (data?.length) log(`Canonicalized ${data.length} Cal eProcure duplicate(s) to Caltrans ${caltransCandidate.id}`);
  return data?.length ?? 0;
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

// Shared scan runner for portal scan drivers. All portal scan tasks
// (planetbids_scan, caltrans_scan, lacounty_dpw_scan) share identical
// bookkeeping — run logs, source status transitions, the persist loop, tallies,
// and the return shape — and differ only in which scrape driver they invoke.
// The driver is a `(source, log) => { candidates, errors, errorMessages }` fn.
async function runScan(task, supabase, driver) {
  const { source_id, source_name, listing_url, portal_type, trigger_reason = task.trigger_reason ?? 'manual_refresh' } = task.payload;
  const resolvedPortalType = effectivePortalType(portal_type, source_id);
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
    telemetry = {},
  } = await driver(
    { source_id, source_name, listing_url, portal_type: resolvedPortalType },
    log
  );

  let errors = driverErrors;
  const found = candidates.length;
  let newCount = 0;
  let refreshedCount = 0;
  let unchangedCount = 0;
  let preparationQueued = 0;
  let preparationDuplicates = 0;

  // Existing rows that fail authoritative extraction are enrolled for a later
  // bounded retry. New empty shells are never inserted as candidates.
  if (resolvedPortalType === 'planetbids' && Array.isArray(telemetry.recovery_candidates)) {
    for (const failure of telemetry.recovery_candidates) {
      const { data: existingFailure } = await supabase.from('opportunity_candidates')
        .select('id, raw_title, ingestion_status')
        .eq('source_url', failure.source_url).maybeSingle();
      if (!existingFailure?.id || String(existingFailure.raw_title ?? '').trim()) continue;
      const { error: enrollmentError } = await supabase.from('opportunity_candidates').update({
        ingestion_status: 'quarantined',
        ingestion_issue_code: failure.error_code,
        ingestion_issue_reason: `PlanetBids detail extraction failed (${failure.error_code})`,
        recovery_next_attempt_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        recovery_last_error_code: failure.error_code,
        recovery_last_error_reason: `PlanetBids detail extraction failed (${failure.error_code})`,
      }).eq('id', existingFailure.id);
      if (!enrollmentError) telemetry.candidates_quarantined = (telemetry.candidates_quarantined ?? 0) + 1;
    }
  }

  for (const candidate of candidates) {
    try {
      if (resolvedPortalType === 'caleprocure' && candidate.portal_bid_id) {
        const { data: caltransDuplicate, error: duplicateError } = await supabase
          .from('opportunity_candidates')
          .select('id, source_url, raw_title, portal_bid_id')
          .eq('portal_type', 'caltrans')
          .eq('portal_bid_id', candidate.portal_bid_id)
          .limit(1)
          .maybeSingle();
        if (duplicateError) {
          throw new Error(`Caltrans duplicate check failed: ${duplicateError.message}`);
        }
        if (caltransDuplicate?.id) {
          await markCalEprocureDuplicateOfCaltrans({
            supabase,
            source_id,
            candidate,
            caltransDuplicate,
            triggerReason: trigger_reason,
            log,
          });
          unchangedCount++;
          log(`[${source_name}] Skipping Cal eProcure duplicate ${candidate.portal_bid_id}: exact Caltrans candidate ${caltransDuplicate.id}`);
          continue;
        }
      }

      const saved = await persistScannedCandidate({
        supabase,
        source_id,
        source_name,
        portal_type: resolvedPortalType,
        candidate,
        triggerReason: trigger_reason,
        sourceTaskId: task.id,
        log,
      });

      if (resolvedPortalType === 'caltrans' && saved.candidate?.id && candidate.portal_bid_id) {
        await enforceCaltransCanonical({
          supabase,
          caltransCandidate: { id: saved.candidate.id, portal_bid_id: candidate.portal_bid_id },
          log,
        });
      }

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

      // Portal-native bid items carried on the candidate (e.g. OpenGov
      // priceTables → opportunity_bid_items). Generic: any driver may attach
      // `_bidItems`. Non-fatal — a persistence failure never fails the scan.
      if (Array.isArray(candidate._bidItems) && candidate._bidItems.length > 0 && saved.candidate?.id) {
        try {
          const result = await replaceBidItemsForCandidate({
            supabase,
            candidateId: saved.candidate.id,
            items: candidate._bidItems,
            methods: ['portal_tab'],
            defaults: {
              sourcePortal: portal_type,
              extractionMethod: 'portal_tab',
              sourceOpportunityId: candidate.portal_bid_id ?? null,
              sourceUrl: candidate.source_url ?? null,
            },
            log,
          });
          log(`[${source_name}] Bid items for ${candidate.source_url}: ${result.inserted} stored`);
        } catch (e) {
          log(`[${source_name}] Bid item persist failed for ${candidate.source_url}: ${e.message}`);
          errorMessages.push(`Bid item persist failed: ${e.message}`);
        }
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

  return { found, new: newCount, refreshed: refreshedCount, unchanged: unchangedCount, preparationQueued, preparationDuplicates, errors, errorSummary, telemetry, logs };
}

async function runPlanetBidsScan(task, supabase) {
  return runScan(task, supabase, scrapePlanetBids);
}

async function runCaltransScan(task, supabase) {
  return runScan(task, supabase, scrapeCaltrans);
}

async function runLaCountyDpwScan(task, supabase) {
  return runScan(task, supabase, scrapeLaCountyDpw);
}

async function runLacmtaScan(task, supabase) {
  return runScan(task, supabase, scrapeLacmta);
}

async function runCalEprocureScan(task, supabase) {
  return runScan(task, supabase, scrapeCalEprocure);
}

async function runOpenGovScan(task, supabase) {
  return runScan(task, supabase, scrapeOpenGov);
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
  // Portal Intelligence writes portal_summary from portal metadata only. It is
  // intentionally separate from full Opportunity Intelligence/F4, so it does
  // not advance opportunity_intelligence_status out of not_requested.
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
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, county, crawl_data, document_acquisition_status')
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
    } else if (candidate.portal_type === 'opengov') {
      result = await acquireOpenGovDocuments({ supabase, task, candidate, log });
    } else if (candidate.portal_type === 'caleprocure') {
      result = await acquireCalEprocureDocuments({ supabase, task, candidate, log });
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
    .in('task_type', ['planetbids_scan', 'planetbids_candidate_recovery', 'qualification_rebuild', 'qualification_candidate_fanout', 'caltrans_scan', 'lacounty_dpw_scan', 'lacmta_scan', 'caleprocure_scan', 'opengov_scan', 'bid_item_scan', 'portal_intelligence', 'document_prefetch', 'project_analysis', 'document_processing', 'project_intelligence'])
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
    .select('id, source_id, source_url, portal_type, raw_title, agency, bid_due_at, county, crawl_data')
    .eq('id', candidateId)
    .maybeSingle();
  if (error) throw new Error(`document_prefetch: candidate lookup failed: ${error.message}`);
  if (!candidate) throw new Error(`document_prefetch: candidate not found: ${candidateId}`);

  const log = (msg) => console.log(`[${new Date().toISOString()}] [prefetch:${candidateId.slice(0, 8)}] ${msg}`);
  log(`Starting document prefetch for ${candidate.raw_title ?? candidateId} (${candidate.portal_type})`);

  let result;
  if (candidate.portal_type === 'planetbids') {
    const workerId = crypto.randomUUID();
    await acquirePlanetBidsLock(workerId, log);
    try {
      result = await acquirePlanetBidsDocuments({ supabase, task, candidate, log });
    } finally {
      await releasePlanetBidsLock(workerId, log);
    }
  } else if (candidate.portal_type === 'caltrans') {
    result = await acquireCaltransDocuments({ supabase, task, candidate, log });
  } else if (candidate.portal_type === 'lacounty_dpw') {
    // Milestone 1 is metadata-only. DPW document acquisition (authenticated
    // SSO flow) is Milestone 2. Return an empty acquisition result so the
    // auto-queued prefetch task completes cleanly instead of throwing.
    log('LA County DPW document acquisition not implemented (Milestone 2) — skipping');
    result = { found: 0, acquired: 0, skipped: 0, failed: 0 };
  } else if (candidate.portal_type === 'lacmta') {
    // This driver is metadata-only by design: LA Metro document acquisition
    // requires Oracle iSupplier vendor registration with manual agency
    // approval, which is out of scope. Return an empty acquisition result so
    // the auto-queued prefetch task completes cleanly.
    log('LA Metro document acquisition not implemented (requires manual iSupplier vendor approval) — skipping');
    result = { found: 0, acquired: 0, skipped: 0, failed: 0 };
  } else if (candidate.portal_type === 'caleprocure') {
    result = await acquireCalEprocureDocuments({ supabase, task, candidate, log });
  } else if (candidate.portal_type === 'opengov') {
    // Phase 3: acquire OpenGov project documents (pre-signed S3 URLs embedded
    // in project detail). supportsDocumentPrefetch() still gates opengov out of
    // the AUTO-queued prefetch path, so this branch runs only for an explicitly
    // queued document_prefetch task (controlled acquisition), not the global
    // scan flow.
    result = await acquireOpenGovDocuments({ supabase, task, candidate, log });
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
    } else if (task.task_type === 'planetbids_candidate_recovery') {
      const log = (msg) => console.log(`[${ts()}] [recovery:${task.payload?.candidate_id ?? 'unknown'}] ${msg}`);
      const workerId = crypto.randomUUID();
      await acquirePlanetBidsLock(workerId, log);
      try {
        result = await runPlanetBidsCandidateRecovery({ task, supabase, log });
      } finally {
        await releasePlanetBidsLock(workerId, log);
      }
    } else if (task.task_type === 'qualification_rebuild') {
      result = await runQualificationRebuild({ task, supabase, log: (msg) => console.log(`[${ts()}] ${msg}`) });
    } else if (task.task_type === 'qualification_candidate_fanout') {
      result = await runQualificationCandidateFanout({ task, supabase, log: (msg) => console.log(`[${ts()}] ${msg}`) });
    } else if (task.task_type === 'caltrans_scan') {
      result = await runCaltransScan(task, supabase);
    } else if (task.task_type === 'lacounty_dpw_scan') {
      result = await runLaCountyDpwScan(task, supabase);
    } else if (task.task_type === 'lacmta_scan') {
      result = await runLacmtaScan(task, supabase);
    } else if (task.task_type === 'caleprocure_scan') {
      result = await runCalEprocureScan(task, supabase);
    } else if (task.task_type === 'opengov_scan') {
      result = await runOpenGovScan(task, supabase);
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

    const taskResult = task.task_type === 'planetbids_candidate_recovery'
      ? { ...result, phase: 'planetbids_candidate_recovery_v1' }
      : task.task_type === 'qualification_rebuild'
      ? { ...result, phase: 'qualification_rebuild_v1' }
      : task.task_type === 'qualification_candidate_fanout'
      ? { ...result, phase: 'qualification_candidate_fanout_v1' }
      : ['planetbids_scan', 'caltrans_scan', 'lacounty_dpw_scan', 'lacmta_scan', 'caleprocure_scan', 'opengov_scan'].includes(task.task_type)
      ? {
          found: result.found,
          new: result.new,
          refreshed: result.refreshed ?? 0,
          unchanged: result.unchanged ?? 0,
          opportunity_intelligence_queued: result.preparationQueued ?? 0,
          opportunity_intelligence_duplicates: result.preparationDuplicates ?? 0,
          errors: result.errors,
          candidates_discovered: result.telemetry?.candidates_discovered ?? result.found,
          candidates_fully_extracted: result.telemetry?.candidates_fully_extracted ?? result.found,
          candidates_quarantined: result.telemetry?.candidates_quarantined ?? 0,
          candidates_queued_for_recovery: result.telemetry?.candidates_queued_for_recovery ?? 0,
          extraction_failures: result.telemetry?.extraction_failures ?? 0,
          portal_errors: result.telemetry?.portal_errors ?? 0,
          empty_shells: result.telemetry?.empty_shells ?? 0,
          context_deaths: result.telemetry?.context_deaths ?? 0,
          retryable_failures: result.telemetry?.retryable_failures ?? 0,
          terminal_failures: result.telemetry?.terminal_failures ?? 0,
          error_summary: result.errorSummary,
          phase: task.task_type === 'caltrans_scan'
            ? 'caltrans_discovery_v1'
            : task.task_type === 'lacounty_dpw_scan'
              ? 'lacounty_dpw_discovery_v1'
              : task.task_type === 'lacmta_scan'
                ? 'lacmta_discovery_v1'
                : task.task_type === 'caleprocure_scan'
                  ? 'caleprocure_discovery_v1'
                  : task.task_type === 'opengov_scan'
                    ? 'opengov_discovery_v1'
                    : 'planetbids_discovery',
          document_acquisition_supported: !['caleprocure_scan', 'opengov_scan'].includes(task.task_type),
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
          documents_discovered: result.documents_discovered ?? result.found ?? 0,
          documents_attempted: result.documents_attempted ?? null,
          documents_unsupported: result.documents_unsupported ?? result.unsupported_file_count ?? 0,
          unsupported_file_count: result.unsupported_file_count ?? result.documents_unsupported ?? 0,
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

    const taskError = ['planetbids_candidate_recovery', 'qualification_rebuild', 'qualification_candidate_fanout'].includes(task.task_type)
      ? null
      : task.task_type === 'project_analysis'
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

    if (['planetbids_scan', 'caltrans_scan', 'lacounty_dpw_scan', 'lacmta_scan', 'caleprocure_scan', 'opengov_scan'].includes(task.task_type)) {
      console.log(`[${ts()}] Task ${task.id} complete: found=${result.found} new=${result.new} refreshed=${result.refreshed ?? 0} unchanged=${result.unchanged ?? 0} errors=${result.errors}`);
    } else if (task.task_type === 'document_processing') {
      console.log(`[${ts()}] Task ${task.id} complete: documents_processed=${result.documents_processed} documents_failed=${result.documents_failed} pages=${result.pages_extracted} chunks=${result.chunks_created}`);
    } else if (task.task_type === 'project_intelligence') {
      console.log(`[${ts()}] Task ${task.id} complete: report=${result.report_id} findings=${result.findings_inserted} citations=${result.citations_inserted}`);
    } else {
      console.log(`[${ts()}] Task ${task.id} complete: documents_acquired=${result.documents_acquired} documents_failed=${result.documents_failed}`);
    }
  } catch (e) {
    // Lock timeout — another worker holds the PlanetBids session.  Reset this
    // task to pending so a later worker can retry it rather than marking it failed.
    if (e instanceof PlanetBidsLockTimeoutError) {
      console.warn(`[${ts()}] Task ${task.id} requeueing (lock timeout): ${e.message}`);
      await supabase
        .from('agent_tasks')
        .update({ status: 'pending', started_at: null, error: null })
        .eq('id', task.id);
      // Brief cooldown before this worker returns to the poll loop so it does not
      // immediately re-claim the same task and hot-loop on the contended lock;
      // gives the current lock holder time to finish and release.
      if (PLANETBIDS_LOCK_REQUEUE_DELAY_MS > 0) {
        await new Promise((r) => setTimeout(r, PLANETBIDS_LOCK_REQUEUE_DELAY_MS));
      }
      return;
    }

    console.error(`[${ts()}] Task ${task.id} failed: ${e.message}`);
    if (['planetbids_scan', 'caltrans_scan', 'lacounty_dpw_scan', 'lacmta_scan', 'caleprocure_scan', 'opengov_scan'].includes(task.task_type) && task.payload?.source_id) {
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
