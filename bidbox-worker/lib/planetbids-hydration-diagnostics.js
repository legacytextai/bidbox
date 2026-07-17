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
  const railwayReplicaId = process.env.RAILWAY_REPLICA_ID || process.env.RAILWAY_DEPLOYMENT_ID || null;

  function begin(attemptNumber, page, portalId) {
    active = {
      attempt: attemptNumber,
      started_at: new Date().toISOString(),
      portal_id: portalId ?? null,
      browserbase_session_id: sessionId ?? null,
      railway_replica_id: railwayReplicaId,
      page_identity: String(page),
      console_events: [], page_errors: [], failed_requests: [], http_errors: [], api_chronology: [],
      search_button_clicked: false,
    };
    attempts.push(active);
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
    };
    if (compactAttempts.length === 2) {
      const [a, b] = compactAttempts;
      output.attempt_comparison = {
        same_browserbase_session: a.browserbase_session_id === b.browserbase_session_id,
        same_playwright_page: a.page_identity === b.page_identity,
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

  return { attach, begin, finish, build, request, requestFailed, pageError, consoleEvent, response };
}

module.exports = { createPlanetBidsHydrationDiagnostics, sanitizeText, sanitizeUrl, inspectBidsPayload, collectTimeoutDomEvidence, collectAttemptPageState, MAX_PAYLOAD_BYTES };
