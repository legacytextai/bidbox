'use strict';

// Bounded, best-effort evidence collection for PlanetBids listing hydration.
// This module deliberately never decides readiness, retries, or scan outcome.
const crypto = require('node:crypto');

const MAX_EVENTS = 40;
const MAX_TEXT = 700;
const MAX_STACK = 900;
const MAX_PREVIEW = 900;
const MAX_BIDS_BYTES = 24 * 1024;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const BOOTSTRAP_FAILURE_GRACE_MS = 750;

function hash(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 24);
}

function sanitizeText(value, limit = MAX_TEXT) {
  return String(value ?? '')
    .replace(/((?:[?&]|\b)(?:access_token|refresh_token|token|api[_-]?key|key|authorization|cookie)=)[^&#\s]*/gi, '$1[REDACTED]')
    .replace(/\b(?:Bearer\s+)?(?:eyJ[a-zA-Z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,}|sbp_[A-Za-z0-9_]{10,})\b/g, '[REDACTED]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}

function sanitizeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl));
    return `${parsed.hostname}${parsed.pathname}`.slice(0, 500);
  } catch {
    return sanitizeText(rawUrl, 500);
  }
}

function relative(attempt) {
  return attempt?.started_at ? Math.max(0, Date.now() - new Date(attempt.started_at).getTime()) : null;
}

function pushBounded(list, entry, key) {
  if (!Array.isArray(list) || list.length >= MAX_EVENTS) return;
  const signature = key ?? JSON.stringify(entry);
  if (list.some((item) => item._dedupe === signature)) return;
  list.push({ ...entry, _dedupe: signature });
}

function publicEvents(events) {
  return events.map(({ _dedupe, ...event }) => event);
}

function sanitizeRecoveryValue(value, depth = 0) {
  if (depth > 4) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitizeText(value, 300);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeRecoveryValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 24).map(([key, item]) => [key, sanitizeRecoveryValue(item, depth + 1)]));
  }
  return sanitizeText(value, 300);
}

function eventText(event) {
  return sanitizeText(`${event?.name ?? ''} ${event?.message ?? ''} ${event?.text ?? ''} ${event?.failure ?? ''}`, MAX_TEXT).toLowerCase();
}

function firstEventMs(events, predicate) {
  const matches = (events ?? []).filter(predicate).map((event) => Number(event?.relative_ms)).filter(Number.isFinite);
  return matches.length > 0 ? Math.min(...matches) : null;
}

/**
 * Confirm the production-observed poisoned anonymous bootstrap without treating
 * an isolated OAuth warning, blank first paint, or JSON warning as sufficient.
 */
function detectPlanetBidsBootstrapFailure({
  listingEndpointObserved = false,
  rowCount = 0,
  foundBidsCount = null,
  bodyText = '',
  appRootPresent = false,
  noResults = false,
  pageErrors = [],
  consoleEvents = [],
  httpErrors = [],
  failedRequests = [],
  elapsedMs = 0,
  graceMs = BOOTSTRAP_FAILURE_GRACE_MS,
} = {}) {
  const isOauthRefresh = (event) => /\/papi\/oauth\/refresh\/?/i.test(String(event?.path ?? event?.source ?? ''));
  const authHttpAt = firstEventMs(httpErrors, (event) => isOauthRefresh(event) && Number(event?.status) === 401);
  const authRequestAt = firstEventMs(failedRequests, (event) => isOauthRefresh(event) && /err_failed|cors|aborted/i.test(eventText(event)));
  const authConsoleAt = firstEventMs(consoleEvents, (event) => (
    /token refresh failed|cross-agency bootstrap failed|oauth\/refresh.*cors policy|credential.*cors/i.test(eventText(event))
  ));
  const authTimes = [authHttpAt, authRequestAt, authConsoleAt].filter(Number.isFinite);

  const routePageAt = firstEventMs(pageErrors, (event) => (
    /unexpected end of json input|cannot read properties of undefined.*reading ['"]?data|normalizeresponse/i.test(eventText(event))
  ));
  const routeConsoleAt = firstEventMs(consoleEvents, (event) => (
    /error while processing route.*normalizeresponse|cannot read properties of undefined.*reading ['"]?data|unexpected end of json input/i.test(eventText(event))
  ));
  const routeTimes = [routePageAt, routeConsoleAt].filter(Number.isFinite);

  const noListing = !listingEndpointObserved && Number(rowCount) === 0;
  const noDefinitiveEmpty = foundBidsCount !== 0 && !noResults;
  const applicationUninitialized = sanitizeText(bodyText, MAX_PREVIEW).length === 0 || !appRootPresent;
  const authFailureObserved = authTimes.length > 0;
  const routeFailureObserved = routeTimes.length > 0;
  const firstSignalAtMs = [...authTimes, ...routeTimes].length > 0 ? Math.min(...authTimes, ...routeTimes) : null;
  const signatureAtMs = authFailureObserved && routeFailureObserved ? Math.max(Math.min(...authTimes), Math.min(...routeTimes)) : null;
  const graceElapsed = Number.isFinite(signatureAtMs) && Number(elapsedMs) - signatureAtMs >= graceMs;
  const detected = noListing && noDefinitiveEmpty && applicationUninitialized && authFailureObserved && routeFailureObserved && graceElapsed;

  const reasons = [];
  if (noListing) reasons.push('papi_bids_not_observed');
  if (noDefinitiveEmpty) reasons.push('no_rows_or_explicit_empty_state');
  if (applicationUninitialized) reasons.push(sanitizeText(bodyText).length === 0 ? 'blank_body' : 'app_root_not_initialized');
  if (authFailureObserved) reasons.push('anonymous_bootstrap_auth_failure');
  if (routeFailureObserved) reasons.push('route_bootstrap_exception');

  return {
    detected,
    candidate: noListing && noDefinitiveEmpty && applicationUninitialized && authFailureObserved && routeFailureObserved,
    reasons,
    first_signal_at_ms: firstSignalAtMs,
    signature_at_ms: signatureAtMs,
    detected_at_ms: detected ? Number(elapsedMs) : null,
    grace_ms: graceMs,
    papi_bids_observed: Boolean(listingEndpointObserved),
    body_blank: sanitizeText(bodyText, MAX_PREVIEW).length === 0,
    app_root_present: Boolean(appRootPresent),
    auth_failure_observed: authFailureObserved,
    route_failure_observed: routeFailureObserved,
  };
}

function inspectBidsPayload(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw ?? '');
  const sampled = bytes.subarray(0, MAX_BIDS_BYTES);
  const result = {
    response_body_bytes: bytes.length,
    inspected_bytes: sampled.length,
    response_truncated: bytes.length > MAX_BIDS_BYTES,
    response_hash: hash(bytes),
    json_parsed: false,
    top_level_type: null,
    top_level_keys: [],
    array_length: null,
    candidate_record_count: 0,
    records_have_bid_identifiers: false,
    records_have_titles: false,
    records_have_due_dates: false,
    empty: null,
    parsing_failed: false,
  };
  let parsed;
  try {
    parsed = JSON.parse(sampled.toString('utf8'));
    result.json_parsed = true;
  } catch {
    result.parsing_failed = true;
    return result;
  }
  result.top_level_type = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed;
  if (Array.isArray(parsed)) result.array_length = parsed.length;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) result.top_level_keys = Object.keys(parsed).slice(0, 25);
  const likelyRecords = Array.isArray(parsed)
    ? parsed
    : ['bids', 'data', 'records', 'items', 'results'].map((key) => parsed?.[key]).find(Array.isArray) ?? [];
  result.candidate_record_count = likelyRecords.length;
  result.empty = likelyRecords.length === 0;
  const sample = likelyRecords.slice(0, 10);
  result.records_have_bid_identifiers = sample.some((row) => row && typeof row === 'object' && Object.keys(row).some((key) => /(^|_)(bid_?)?id$|solicitation/i.test(key)));
  result.records_have_titles = sample.some((row) => row && typeof row === 'object' && Object.keys(row).some((key) => /title|name|project/i.test(key)));
  result.records_have_due_dates = sample.some((row) => row && typeof row === 'object' && Object.keys(row).some((key) => /due|deadline|close/i.test(key)));
  return result;
}

async function collectTimeoutDomEvidence(page) {
  try {
    const raw = await page.evaluate(() => {
      const html = document.documentElement?.outerHTML ?? '';
      const body = document.body?.innerText ?? '';
      const count = (selector) => document.querySelectorAll(selector).length;
      const search = [...document.querySelectorAll('button')].find((button) => /^search$/i.test((button.innerText || button.textContent || '').trim()));
      const shadows = [...document.querySelectorAll('*')].filter((el) => el.shadowRoot).length;
      return {
        final_url: location.href,
        ready_state: document.readyState,
        page_title: document.title,
        html_length: html.length,
        html_start: html.slice(0, 1200),
        html_end: html.slice(-1200),
        body_length: body.length,
        body_preview: body.slice(0, 1600),
        table_count: count('table'), tr_count: count('tr'), role_row_count: count('[role="row"]'),
        button_count: count('button'), input_count: count('input'), iframe_count: count('iframe'),
        shadow_host_count: shadows, loading_indicator_count: count('[class*="loading" i], [aria-busy="true"]'),
        error_banner_count: count('[role="alert"], [class*="error" i], [class*="alert" i]'),
        app_root_present: Boolean(document.querySelector('#app, #ember-app, [data-ember-action], [id*="ember" i]')),
        app_root_empty: Boolean(document.querySelector('#app, #ember-app') && !(document.querySelector('#app, #ember-app').textContent || '').trim()),
        scripts_present: count('script') > 0,
        login_or_auth_present: /sign in|log in|session expired|authentication/i.test(body),
        challenge_or_blocked_present: /captcha|access denied|blocked|unusual traffic/i.test(body),
        search_button_detected: Boolean(search),
        search_button_disabled: search ? Boolean(search.disabled) : null,
      };
    });
    return {
      ...raw,
      final_url: sanitizeUrl(raw.final_url),
      html_start: sanitizeText(raw.html_start, MAX_PREVIEW),
      html_end: sanitizeText(raw.html_end, MAX_PREVIEW),
      body_preview: sanitizeText(raw.body_preview, MAX_PREVIEW),
    };
  } catch (error) {
    return { capture_error: sanitizeText(error?.message, 240), final_url: sanitizeUrl(page?.url?.()) };
  }
}

async function collectAttemptPageState(page) {
  try {
    const raw = await page.evaluate(() => {
      const body = document.body?.innerText ?? '';
      const search = [...document.querySelectorAll('button')].find((button) => /^search$/i.test((button.innerText || button.textContent || '').trim()));
      return {
        final_url: location.href,
        ready_state: document.readyState,
        page_title: document.title,
        body_text_length: body.length,
        body_preview: body.slice(0, 1000),
        dom_html_length: (document.documentElement?.outerHTML ?? '').length,
        row_count: document.querySelectorAll('table tbody tr, table tr, [role="table"] [role="row"], [role="grid"] [role="row"]').length,
        role_row_count: document.querySelectorAll('[role="row"]').length,
        found_bid_count: (body.match(/Found\s+([\d,]+)\s+bids?/i) || [])[1] ?? null,
        no_results_indicator: /no open bids|no results|found\s+0\s+bids?/i.test(body),
        invalid_portal_indicator: /not a valid PlanetBids agency portal/i.test(body),
        search_button_detected: Boolean(search),
        search_button_disabled: search ? Boolean(search.disabled) : null,
      };
    });
    return { ...raw, final_url: sanitizeUrl(raw.final_url), body_preview: sanitizeText(raw.body_preview, MAX_PREVIEW) };
  } catch (error) {
    return { final_url: sanitizeUrl(page?.url?.()), capture_error: sanitizeText(error?.message, 240) };
  }
}

function createPlanetBidsHydrationDiagnostics({ sourceId = null, taskId = null, sourceName = null, sessionId = null } = {}) {
  const attempts = [];
  let active = null;
  let nextPageIdentity = 0;
  let nextContextIdentity = 0;
  const pageIdentities = new WeakMap();
  const contextIdentities = new WeakMap();
  const recovery = {
    recovery_strategy: 'none',
    fresh_session_recovery_triggered: false,
    session_attempts: [],
    first_session_cleanup_outcome: null,
    second_session_creation_outcome: null,
    recovery_outcome: null,
    final_error_classification: null,
  };
  const railwayReplicaId = process.env.RAILWAY_REPLICA_ID || process.env.RAILWAY_DEPLOYMENT_ID || null;

  function identityFor(map, value, prefix, next) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
    if (!map.has(value)) map.set(value, `${prefix}-${next()}`);
    return map.get(value);
  }

  function begin(attemptNumber, page, portalId, { browserbaseSessionId = sessionId, context = page?.context?.() } = {}) {
    const pageIdentity = identityFor(pageIdentities, page, 'page', () => ++nextPageIdentity);
    const contextIdentity = identityFor(contextIdentities, context, 'context', () => ++nextContextIdentity);
    active = {
      attempt: attemptNumber,
      started_at: new Date().toISOString(),
      portal_id: portalId ?? null,
      browserbase_session_id: browserbaseSessionId ?? null,
      railway_replica_id: railwayReplicaId,
      page_identity: pageIdentity,
      context_identity: contextIdentity,
      console_events: [], page_errors: [], failed_requests: [], http_errors: [], api_chronology: [],
      search_button_clicked: false,
    };
    attempts.push(active);
    recovery.session_attempts.push({
      attempt: attemptNumber,
      browserbase_session_id: browserbaseSessionId ?? null,
      page_identity: pageIdentity,
      context_identity: contextIdentity,
    });
    return active;
  }

  function request(req) {
    if (!active) return;
    const url = req.url();
    if (/api-external\.prod\.planetbids\.com/i.test(url)) {
      pushBounded(active.api_chronology, {
        relative_ms: relative(active), direction: 'request', method: req.method(), path: sanitizeUrl(url),
        resource_type: req.resourceType?.() ?? null, attempt: active.attempt,
      }, `req:${req.method()}:${sanitizeUrl(url)}`);
    }
  }

  function requestFailed(req) {
    if (!active) return;
    const entry = { relative_ms: relative(active), method: req.method(), path: sanitizeUrl(req.url()), resource_type: req.resourceType?.() ?? null, failure: sanitizeText(req.failure?.()?.errorText, 300), attempt: active.attempt };
    pushBounded(active.failed_requests, entry, JSON.stringify(entry));
  }

  function pageError(error) {
    if (!active) return;
    const entry = { relative_ms: relative(active), name: sanitizeText(error?.name || 'Error', 80), message: sanitizeText(error?.message, MAX_TEXT), stack: sanitizeText(String(error?.stack ?? '').split('\n').slice(0, 4).join('\n'), MAX_STACK), attempt: active.attempt };
    pushBounded(active.page_errors, entry, `${entry.name}:${entry.message}`);
  }

  function consoleEvent(message) {
    if (!active || !['error', 'warning', 'assert'].includes(message.type?.())) return;
    const location = message.location?.() ?? {};
    const entry = { relative_ms: relative(active), type: message.type(), text: sanitizeText(message.text?.(), MAX_TEXT), source: sanitizeUrl(location.url), line: location.lineNumber ?? null, column: location.columnNumber ?? null, attempt: active.attempt };
    pushBounded(active.console_events, entry, `${entry.type}:${entry.text}:${entry.source}`);
  }

  async function response(res) {
    if (!active) return;
    const url = res.url();
    const request = res.request?.();
    const base = { relative_ms: relative(active), method: request?.method?.() ?? null, path: sanitizeUrl(url), status: res.status(), resource_type: request?.resourceType?.() ?? null, attempt: active.attempt };
    if (/api-external\.prod\.planetbids\.com/i.test(url)) pushBounded(active.api_chronology, { ...base, direction: 'response' }, `res:${base.method}:${base.path}:${base.status}`);
    if (res.status() >= 400) pushBounded(active.http_errors, base, JSON.stringify(base));
    if (!/\/papi\/bids\/?(?:\?|$)/i.test(url)) return;
    const headers = res.headers?.() ?? {};
    const bids = { ...base, content_type: sanitizeText(headers['content-type'] ?? '', 160), content_length: Number(headers['content-length']) || null };
    try {
      Object.assign(bids, inspectBidsPayload(await res.body()));
    } catch (error) {
      bids.response_body_unavailable = true;
      bids.response_body_error = sanitizeText(error?.message, 240);
    }
    active.papi_bids = bids;
  }

  function attach(page) {
    page.on('request', request);
    page.on('requestfailed', requestFailed);
    page.on('response', (res) => { void response(res).catch(() => {}); });
    page.on('pageerror', pageError);
    page.on('console', consoleEvent);
  }

  function bootstrapFailureEvidence({ observed = {}, rowCount = 0, foundBidsCount = null, readinessSignals = {}, elapsedMs = 0 } = {}) {
    if (!active) return detectPlanetBidsBootstrapFailure();
    return detectPlanetBidsBootstrapFailure({
      listingEndpointObserved: Boolean(readinessSignals.listing_endpoint_observed || active.papi_bids),
      rowCount,
      foundBidsCount,
      bodyText: observed.body_text ?? '',
      appRootPresent: Boolean(observed.app_root_present),
      noResults: Boolean(observed.no_results_indicator),
      pageErrors: publicEvents(active.page_errors),
      consoleEvents: publicEvents(active.console_events),
      httpErrors: publicEvents(active.http_errors),
      failedRequests: publicEvents(active.failed_requests),
      elapsedMs,
    });
  }

  function markBootstrapFailure(evidence) {
    if (!active || !evidence) return;
    active.bootstrap_failure_signature = {
      reasons: evidence.reasons,
      first_signal_at_ms: evidence.first_signal_at_ms,
      signature_at_ms: evidence.signature_at_ms,
      detected_at_ms: evidence.detected_at_ms,
      papi_bids_observed: evidence.papi_bids_observed,
      body_blank: evidence.body_blank,
      app_root_present: evidence.app_root_present,
    };
    active.bootstrap_failure_detected_at_ms = evidence.detected_at_ms;
  }

  function recordRecovery(fields = {}) {
    for (const [key, value] of Object.entries(fields)) recovery[key] = sanitizeRecoveryValue(value);
  }

  async function finish(listing, page, { timeout = false, searchClicked = false } = {}) {
    if (!active) return null;
    active.ended_at = new Date().toISOString();
    active.total_wait_ms = listing?.waitMs ?? null;
    active.final_state = listing?.state ?? 'timeout';
    active.final_url = sanitizeUrl(listing?.finalUrl ?? page?.url?.());
    active.search_button_clicked = Boolean(searchClicked || active.search_button_clicked);
    active.page_closed = page?.isClosed?.() ?? null;
    active.page_disconnected = page?.context?.()?.browser?.()?.isConnected ? !page.context().browser().isConnected() : null;
    active.page_state = await collectAttemptPageState(page);
    if (timeout) active.dom = await collectTimeoutDomEvidence(page);
    return active;
  }

  function build({ failure = false } = {}) {
    const compactAttempts = attempts.map((attempt) => ({
      ...attempt,
      console_events: publicEvents(attempt.console_events), page_errors: publicEvents(attempt.page_errors),
      failed_requests: publicEvents(attempt.failed_requests), http_errors: publicEvents(attempt.http_errors),
      api_chronology: publicEvents(attempt.api_chronology),
    }));
    const output = {
      version: 'planetbids_hydration_diagnostics_v1', source_id: sourceId, source_name: sanitizeText(sourceName, 160), task_id: taskId,
      browserbase_session_id: sessionId ?? null, railway_replica_id: railwayReplicaId,
      attempts: failure ? compactAttempts : compactAttempts.map(({ dom, console_events, page_errors, failed_requests, http_errors, api_chronology, ...summary }) => summary),
      screenshot_capture_supported: false,
      screenshot_artifacts: [],
      ...recovery,
    };
    if (compactAttempts.length === 2) {
      const [a, b] = compactAttempts;
      output.attempt_comparison = {
        same_browserbase_session: a.browserbase_session_id === b.browserbase_session_id,
        same_page: a.page_identity === b.page_identity,
        same_playwright_page: a.page_identity === b.page_identity,
        same_context: a.context_identity === b.context_identity,
        final_url_equal: a.final_url === b.final_url,
        api_chronology_equal: hash(JSON.stringify(publicEvents(a.api_chronology))) === hash(JSON.stringify(publicEvents(b.api_chronology))),
        papi_bids_observed: [Boolean(a.papi_bids), Boolean(b.papi_bids)],
        papi_bids_response_hash_equal: (a.papi_bids?.response_hash ?? null) === (b.papi_bids?.response_hash ?? null),
        page_errors_equal: hash(JSON.stringify(publicEvents(a.page_errors))) === hash(JSON.stringify(publicEvents(b.page_errors))),
        console_errors_equal: hash(JSON.stringify(publicEvents(a.console_events))) === hash(JSON.stringify(publicEvents(b.console_events))),
        failed_requests_equal: hash(JSON.stringify(publicEvents(a.failed_requests))) === hash(JSON.stringify(publicEvents(b.failed_requests))),
        dom_signature_equal: hash(JSON.stringify(a.dom ?? {})) === hash(JSON.stringify(b.dom ?? {})),
        body_preview_hash_equal: hash(a.dom?.body_preview ?? '') === hash(b.dom?.body_preview ?? ''),
      };
    }
    const originalSize = Buffer.byteLength(JSON.stringify(output));
    if (originalSize > MAX_PAYLOAD_BYTES) {
      for (const attempt of output.attempts) {
        if (attempt.dom) { delete attempt.dom.html_start; delete attempt.dom.html_end; }
        for (const key of ['console_events', 'page_errors', 'failed_requests', 'http_errors', 'api_chronology']) {
          if (Array.isArray(attempt[key])) attempt[key] = attempt[key].slice(0, 12);
        }
      }
      output.diagnostics_truncated = true;
      output.diagnostics_original_size = originalSize;
      output.diagnostics_final_size = Buffer.byteLength(JSON.stringify(output));
    }
    return output;
  }

  return {
    attach,
    begin,
    finish,
    build,
    request,
    requestFailed,
    pageError,
    consoleEvent,
    response,
    bootstrapFailureEvidence,
    markBootstrapFailure,
    recordRecovery,
  };
}

module.exports = {
  createPlanetBidsHydrationDiagnostics,
  detectPlanetBidsBootstrapFailure,
  sanitizeText,
  sanitizeUrl,
  inspectBidsPayload,
  collectTimeoutDomEvidence,
  collectAttemptPageState,
  BOOTSTRAP_FAILURE_GRACE_MS,
  MAX_PAYLOAD_BYTES,
};
