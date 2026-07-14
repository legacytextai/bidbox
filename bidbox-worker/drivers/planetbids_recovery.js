'use strict';

const { createBrowserbasePage, loginToPlanetBids } = require('./planetbids_documents');
const { parsePlanetBidsDate } = require('../lib/planetbids-date');
const {
  classifyFailure,
  extractExactApiMetadata,
  retryDelayMs,
  safeMetadataPatch,
  TERMINAL_CODES,
} = require('../lib/planetbids-recovery');

const API_HOST = 'api-external.prod.planetbids.com';
const DETAIL_TIMEOUT_MS = Number(process.env.PLANETBIDS_RECOVERY_DETAIL_TIMEOUT_MS ?? 45000);

function parseRecoveredDueDate(raw) {
  return parsePlanetBidsDate(raw);
}

function truncate(value, length = 800) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().substring(0, length);
}

async function renderedState(page, targetBidId) {
  return page.evaluate((bidId) => {
    const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim();
    const errorMatch = body.match(/(?:something went wrong|service unavailable|project (?:is )?unavailable|not found|session expired|log in)/i);
    const titleNode = document.querySelector('h1, h2, [class*="bid-title" i], [class*="project-title" i], #bo-detail-content h3');
    const detailRoot = document.querySelector('#bo-detail-content, [data-test*="bo-detail" i], [class*="bo-detail" i], [class*="bid-detail" i]');
    const field = (label) => {
      const pattern = new RegExp(`${label}\\s*:?\\s*(.{1,180}?)(?=Bid Due|Due Date|Closing Date|Status|Department|Project Type|$)`, 'i');
      return body.match(pattern)?.[1]?.trim() || null;
    };
    return {
      target_bid_id: String(bidId),
      page_title: document.title,
      body_chars: body.length,
      body_preview: body.substring(0, 800),
      detail_root: Boolean(detailRoot),
      ember_root: Boolean(document.querySelector('.ember-application, [class*="ember-view"]')),
      terminal_error: errorMatch?.[0] ?? null,
      metadata: {
        portal_bid_id: String(bidId),
        raw_title: titleNode?.textContent?.replace(/\s+/g, ' ').trim() || field('(?:Bid Title|Project Title|Project Name)'),
        due_date_raw: field('(?:Bid Due Date|Bid Due|Due Date|Closing Date)'),
        status: field('(?:Bid Status|Status)'),
        extraction_source: 'rendered_page',
        extraction_confidence: 'high',
      },
    };
  }, targetBidId);
}

async function waitForAuthoritativeDetail(page, targetBidId, apiMatches, apiDiagnostics, timeoutMs = DETAIL_TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (apiMatches.length) return { metadata: apiMatches[0], diagnostics: await renderedState(page, targetBidId), duration_ms: Date.now() - started };
    const state = await renderedState(page, targetBidId).catch((error) => {
      throw error;
    });
    if (state.terminal_error) return { error: new Error(state.terminal_error), diagnostics: state, duration_ms: Date.now() - started };
    if (state.detail_root && state.body_chars > 40 && state.metadata.raw_title) {
      return { metadata: state.metadata, diagnostics: state, duration_ms: Date.now() - started };
    }
    await page.waitForTimeout(500);
  }
  const diagnostics = await renderedState(page, targetBidId).catch(() => ({ target_bid_id: targetBidId, body_chars: 0 }));
  diagnostics.api_observed = apiDiagnostics.observed > 0;
  diagnostics.api_matched = apiMatches.length > 0;
  throw Object.assign(new Error('PlanetBids detail readiness timeout'), { diagnostics });
}

async function recoverFromPortal(candidate, log, metrics = null) {
  const targetBidId = String(candidate.portal_bid_id ?? candidate.crawl_data?.bid_id ?? '').trim();
  if (!targetBidId) throw Object.assign(new Error('candidate has no stable PlanetBids identifier'), { code: 'missing_stable_identifier' });
  const created = await createBrowserbasePage(log);
  if (metrics) metrics.browserbase_sessions++;
  const { browser, page } = created;
  const apiMatches = [];
  const apiDiagnostics = { observed: 0, last_status: null, last_url: null };
  try {
    page.on('response', (response) => {
      if (!response.url().includes(API_HOST)) return;
      apiDiagnostics.observed++;
      apiDiagnostics.last_status = response.status();
      apiDiagnostics.last_url = response.url();
      if (response.status() === 429) return;
      response.json().then((payload) => {
        const metadata = extractExactApiMetadata(payload, targetBidId, response.url(), response.status());
        if (metadata) apiMatches.push(metadata);
      }).catch(() => {});
    });
    await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await loginToPlanetBids(page, log).catch((error) => log(`recovery login continuation: ${error.message}`));
    if (!page.url().includes(`/bo-detail/${targetBidId}`)) {
      await page.goto(candidate.source_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    const readiness = await waitForAuthoritativeDetail(page, targetBidId, apiMatches, apiDiagnostics);
    if (readiness.error) throw Object.assign(readiness.error, { diagnostics: readiness.diagnostics });
    const metadata = readiness.metadata;
    const dueDateParse = parseRecoveredDueDate(metadata.due_date_raw);
    metadata.bid_due_at = dueDateParse.value;
    metadata.diagnostics = {
      page_title: readiness.diagnostics?.page_title ?? null,
      body_chars: readiness.diagnostics?.body_chars ?? 0,
      detail_root: readiness.diagnostics?.detail_root ?? false,
      target_bid_id: targetBidId,
      api_response_status: metadata.api_response_status ?? apiDiagnostics.last_status,
      api_response_url: metadata.api_response_url ?? apiDiagnostics.last_url,
      render_timeout_ms: DETAIL_TIMEOUT_MS,
      browser_session_id: null,
      extraction_source: metadata.extraction_source,
      extraction_confidence: metadata.extraction_confidence,
      due_date_raw: metadata.due_date_raw,
      due_date_parse: dueDateParse,
    };
    return metadata;
  } catch (error) {
    const diagnostics = error.diagnostics ?? await renderedState(page, targetBidId).catch(() => ({ target_bid_id: targetBidId, body_chars: 0 }));
    diagnostics.api_observed = apiDiagnostics.observed > 0;
    diagnostics.api_matched = apiMatches.length > 0;
    diagnostics.api_response_status = apiDiagnostics.last_status;
    diagnostics.api_response_url = apiDiagnostics.last_url;
    const code = error.code ?? classifyFailure(error, diagnostics);
    throw Object.assign(error, { code, diagnostics });
  } finally {
    await browser.close().catch(() => {});
  }
}

async function recoverFromListingApi(supabase, candidate, log, metrics = null) {
  const targetBidId = String(candidate.portal_bid_id ?? candidate.crawl_data?.bid_id ?? '').trim();
  if (!targetBidId || !candidate.source_id) return null;
  const { data: source } = await supabase.from('opportunity_sources').select('listing_url').eq('id', candidate.source_id).maybeSingle();
  if (!source?.listing_url) return null;
  const { browser, page } = await createBrowserbasePage(log);
  if (metrics) metrics.browserbase_sessions++;
  const matches = [];
  try {
    page.on('response', (response) => {
      if (!response.url().includes(API_HOST) || response.status() < 200 || response.status() >= 300) return;
      response.json().then((payload) => {
        const metadata = extractExactApiMetadata(payload, targetBidId, response.url(), response.status());
        if (metadata?.raw_title) matches.push({ ...metadata, extraction_source: 'listing_api' });
      }).catch(() => {});
    });
    await page.goto(source.listing_url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const deadline = Date.now() + 20000;
    while (!matches.length && Date.now() < deadline) await page.waitForTimeout(500);
    if (!matches.length) return null;
    const metadata = matches[0];
    const dueDateParse = parseRecoveredDueDate(metadata.due_date_raw);
    metadata.bid_due_at = dueDateParse.value;
    metadata.diagnostics = {
      target_bid_id: targetBidId,
      api_response_status: metadata.api_response_status,
      api_response_url: metadata.api_response_url,
      extraction_source: 'listing_api',
      extraction_confidence: 'authoritative',
      due_date_raw: metadata.due_date_raw,
      due_date_parse: dueDateParse,
    };
    return metadata;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function recoverFromDocuments(supabase, candidate) {
  const { data: chunks, error } = await supabase.from('opportunity_document_chunks')
    .select('text, citation_label, document_class, opportunity_document_id, page_start')
    .eq('opportunity_candidate_id', candidate.id)
    .in('document_class', ['notice_to_bidders', 'bid_package', 'solicitation', 'invitation_for_bids'])
    .order('page_start', { ascending: true }).limit(12);
  if (error || !chunks?.length) return null;
  const text = chunks.map((chunk) => chunk.text).join('\n').substring(0, 30000);
  if (!/(notice to bidders|invitation for bids|sealed bids|bid proposal)/i.test(text)) return null;
  const title = text.match(/(?:PROJECT|BID|CONTRACT)\s+(?:TITLE|NAME)\s*[:\-]\s*([^\n]{5,300})/i)?.[1]
    ?? text.match(/(?:NOTICE TO BIDDERS|INVITATION FOR BIDS)\s*[:\-]?\s*\n\s*([^\n]{5,300})/i)?.[1]
    ?? null;
  const dueRaw = text.match(/(?:BID DUE|DUE DATE|RECEIVED (?:UNTIL|BY)|CLOSING DATE)\s*[:\-]?\s*([^\n]{6,120})/i)?.[1] ?? null;
  if (!title && !dueRaw) return null;
  const dueDateParse = parseRecoveredDueDate(dueRaw);
  return {
    raw_title: truncate(title, 500),
    due_date_raw: truncate(dueRaw, 150),
    bid_due_at: dueDateParse.value,
    extraction_source: 'document',
    extraction_confidence: 'high',
    diagnostics: {
      due_date_raw: dueRaw,
      due_date_parse: dueDateParse,
      evidence: chunks.slice(0, 3).map((chunk) => ({ document_id: chunk.opportunity_document_id, page: chunk.page_start, citation: chunk.citation_label })),
    },
  };
}

async function runPlanetBidsCandidateRecovery({ task, supabase, log = console.log }) {
  const candidateId = task.payload?.candidate_id;
  const dryRun = task.payload?.dry_run === true;
  if (!candidateId) throw new Error('planetbids_candidate_recovery task missing candidate_id');
  const { data: candidate, error } = await supabase.from('opportunity_candidates').select('*').eq('id', candidateId).maybeSingle();
  if (error || !candidate) throw new Error(`recovery candidate lookup failed: ${error?.message ?? 'not found'}`);
  if (candidate.portal_type !== 'planetbids') throw new Error('recovery candidate is not PlanetBids');
  const attempt = Math.max(1, Number(task.payload?.attempt_number ?? candidate.recovery_attempt_count + 1));
  const trigger = task.payload?.recovery_trigger ?? task.trigger_reason ?? 'automatic_retry';
  const before = { raw_title: candidate.raw_title, bid_due_at: candidate.bid_due_at, agency: candidate.agency, county: candidate.county, ingestion_status: candidate.ingestion_status };
  let recovered = null;
  let portalError = null;
  const metrics = { browserbase_sessions: 0 };
  const started = Date.now();
  try {
    recovered = await recoverFromPortal(candidate, log, metrics);
  } catch (error) {
    portalError = error;
    log(`portal recovery failed candidate=${candidateId} code=${error.code}: ${error.message}`);
    recovered = await recoverFromListingApi(supabase, candidate, log, metrics).catch((listingError) => {
      log(`listing recovery failed candidate=${candidateId}: ${listingError.message}`);
      return null;
    });
    if (!recovered) recovered = await recoverFromDocuments(supabase, candidate);
  }

  const patch = recovered ? safeMetadataPatch(candidate, recovered) : {};
  const validTitle = String(patch.raw_title ?? candidate.raw_title ?? '').trim();
  const successful = Boolean(validTitle);
  const code = successful ? null : (portalError?.code ?? 'missing_required_title');
  const nextDelay = successful || attempt >= 3 || TERMINAL_CODES.has(code) ? null : retryDelayMs(attempt, code);
  const exhausted = !successful && (attempt >= 3 || TERMINAL_CODES.has(code));
  const after = { ...before, ...patch, ingestion_status: successful ? 'valid' : 'quarantined' };
  const fieldsChanged = Object.keys(after).filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));

  if (!dryRun) {
    const now = new Date().toISOString();
    const update = successful ? {
      ...patch,
      crawl_data: { ...(candidate.crawl_data ?? {}), recovery: { source: recovered.extraction_source, confidence: recovered.extraction_confidence, recovered_at: now } },
      ingestion_status: 'valid', ingestion_issue_code: null, ingestion_issue_reason: null,
      recovery_attempt_count: attempt, recovery_last_attempt_at: now, recovery_next_attempt_at: null,
      recovery_last_error_code: null, recovery_last_error_reason: null, recovery_exhausted_at: null,
      recovery_last_task_id: task.id, last_metadata_refreshed_at: now, metadata_refresh_source: 'recovery',
    } : {
      ingestion_status: 'quarantined', ingestion_issue_code: code, ingestion_issue_reason: truncate(portalError?.message ?? code, 1000),
      recovery_attempt_count: attempt, recovery_last_attempt_at: now,
      recovery_next_attempt_at: nextDelay ? new Date(Date.now() + nextDelay).toISOString() : null,
      recovery_last_error_code: code, recovery_last_error_reason: truncate(portalError?.message ?? code, 1000),
      recovery_exhausted_at: exhausted ? now : null, recovery_last_task_id: task.id,
    };
    const { error: updateError } = await supabase.from('opportunity_candidates').update(update).eq('id', candidate.id);
    if (updateError) throw new Error(`candidate recovery update failed: ${updateError.message}`);
    const { error: auditError } = await supabase.from('opportunity_recovery_audits').insert({
      opportunity_candidate_id: candidate.id, agent_task_id: task.id, attempt_number: attempt, trigger,
      extraction_source: recovered?.extraction_source ?? null, before_values: before, after_values: after,
      fields_changed: fieldsChanged, confidence: recovered?.extraction_confidence ?? null,
      outcome: successful ? 'recovered' : exhausted ? 'exhausted' : 'failed', error_code: code,
      error_reason: code ? truncate(portalError?.message ?? code, 1000) : null,
      diagnostics: recovered?.diagnostics ?? portalError?.diagnostics ?? {},
    });
    if (auditError) throw new Error(`candidate recovery audit failed: ${auditError.message}`);
    if (successful && task.payload?.suppress_qualification_fanout !== true) {
      await supabase.from('agent_tasks').insert({ task_type: 'qualification_candidate_fanout', status: 'pending', priority: 6, trigger_reason: 'candidate_recovered', payload: { candidate_id: candidate.id, metadata_version: candidate.metadata_version } });
    }
  }
  return {
    candidate_id: candidate.id, dry_run: dryRun, attempted: 1, recovered: successful ? 1 : 0,
    unresolved: successful ? 0 : 1, source: recovered?.extraction_source ?? null,
    title_found: recovered?.raw_title ?? null, bid_due_at_found: recovered?.bid_due_at ?? null,
    status_found: recovered?.status ?? null, error_code: code, exhausted,
    browserbase_sessions: metrics.browserbase_sessions,
    would_update: fieldsChanged.length > 0, fields_changed: fieldsChanged,
    runtime_ms: Date.now() - started, diagnostics: recovered?.diagnostics ?? portalError?.diagnostics ?? {},
  };
}

module.exports = { parseRecoveredDueDate, recoverFromDocuments, recoverFromListingApi, recoverFromPortal, runPlanetBidsCandidateRecovery, waitForAuthoritativeDetail };
