require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { scrapePlanetBids } = require('./drivers/planetbids');
const { acquirePlanetBidsDocuments } = require('./drivers/planetbids_documents');
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

  if (candidate.portal_type !== 'planetbids') {
    throw new Error(`Document acquisition is only implemented for planetbids candidates; got ${candidate.portal_type ?? 'unknown'}`);
  }

  const startedAt = new Date().toISOString();
  await supabase
    .from('opportunity_candidates')
    .update({
      analysis_error: null,
      document_acquisition_status: 'acquiring',
      document_acquisition_started_at: startedAt,
      document_acquisition_completed_at: null,
      document_acquisition_error: null,
    })
    .eq('id', candidate.id);

  log(`[${candidate.agency ?? 'Unknown agency'}] Starting document acquisition for candidate ${candidate.id}`);

  let result;
  try {
    result = await acquirePlanetBidsDocuments({ supabase, task, candidate, log });
  } catch (e) {
    const completedAt = new Date().toISOString();
    await supabase
      .from('opportunity_candidates')
      .update({
        document_acquisition_status: 'failed',
        document_acquisition_completed_at: completedAt,
        document_acquisition_error: e.message,
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
  const errorSummary = acquisitionStatus === 'failed'
    ? result.errorSummary ?? (result.found === 0 ? 'No documents found' : 'No documents were acquired')
    : result.errorSummary;

  await supabase
    .from('opportunity_candidates')
    .update({
      analysis_completed_at: null,
      analysis_error: null,
      document_acquisition_status: acquisitionStatus,
      document_acquisition_completed_at: completedAt,
      document_acquisition_error: errorSummary,
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
          status: errorSummary ? 'complete_with_errors' : 'complete',
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
    errorSummary,
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
    .in('task_type', ['planetbids_scan', 'project_analysis', 'document_processing', 'project_intelligence'])
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
    let result;
    if (task.task_type === 'planetbids_scan') {
      result = await runPlanetBidsScan(task, supabase);
    } else if (task.task_type === 'project_analysis') {
      result = await runProjectAnalysisAcquisition(task, supabase);
    } else if (task.task_type === 'document_processing') {
      result = await runDocumentProcessingTask(task, supabase);
    } else if (task.task_type === 'project_intelligence') {
      result = await runProjectIntelligenceTask(task, supabase);
    } else {
      throw new Error(`Unsupported task type: ${task.task_type}`);
    }

    const taskResult = task.task_type === 'planetbids_scan'
      ? {
          found: result.found,
          new: result.new,
          errors: result.errors,
          error_summary: result.errorSummary,
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
      : {
          candidate_id: result.candidate_id,
          documents_found: result.documents_found,
          documents_acquired: result.documents_acquired,
          documents_skipped: result.documents_skipped,
          documents_failed: result.documents_failed,
          document_processing_task_id: result.document_processing_task_id,
          document_processing_duplicate: result.document_processing_duplicate,
          project_intelligence_task_id: result.project_intelligence_task_id,
          project_intelligence_duplicate: result.project_intelligence_duplicate,
          project_intelligence_skipped: result.project_intelligence_skipped,
          error_summary: result.errorSummary,
          phase: 'f2_document_acquisition',
          intelligence_status: result.project_intelligence_task_id ? 'queued' : 'not_generated',
        };

    await supabase
      .from('agent_tasks')
      .update({
        status: 'complete',
        result: taskResult,
        error: result.errorSummary,
        completed_at: new Date().toISOString(),
      })
      .eq('id', task.id);

    if (task.task_type === 'planetbids_scan') {
      console.log(`[${ts()}] Task ${task.id} complete: found=${result.found} new=${result.new} errors=${result.errors}`);
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
    if (task.task_type === 'project_analysis' && task.payload?.candidate_id) {
      await supabase
        .from('opportunity_candidates')
        .update({
          document_acquisition_status: 'failed',
          document_acquisition_completed_at: new Date().toISOString(),
          document_acquisition_error: e.message,
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
