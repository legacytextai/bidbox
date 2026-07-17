'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlanetBidsHydrationDiagnostics,
  sanitizeText,
  sanitizeUrl,
  inspectBidsPayload,
  MAX_PAYLOAD_BYTES,
} = require('../lib/planetbids-hydration-diagnostics');

function pageState() {
  return {
    final_url: 'https://vendors.planetbids.com/portal/12/bo/bo-search?token=secret',
    ready_state: 'complete', page_title: 'PlanetBids', body_text_length: 48,
    body_preview: 'Found 0 bids', dom_html_length: 420, row_count: 0, role_row_count: 0,
    found_bid_count: '0', no_results_indicator: true, invalid_portal_indicator: false,
    search_button_detected: true, search_button_disabled: false,
  };
}

function fakePage() {
  const handlers = {};
  return {
    handlers,
    on: (name, fn) => { handlers[name] = fn; },
    url: () => 'https://vendors.planetbids.com/portal/12/bo/bo-search?access_token=secret',
    isClosed: () => false,
    evaluate: async () => pageState(),
  };
}

test('PlanetBids diagnostics redact secrets and keep endpoint identity', () => {
  assert.equal(sanitizeUrl('https://api-external.prod.planetbids.com/papi/bids?access_token=secret&cid=12'), 'api-external.prod.planetbids.com/papi/bids');
  assert.doesNotMatch(sanitizeText('Bearer eyJabcdefghijklmnopqrstuvwxyz access_token=secret user@example.com'), /secret|eyJ|example\.com/);
});

test('PlanetBids /papi/bids structural evidence never retains bid records', () => {
  const array = inspectBidsPayload(Buffer.from(JSON.stringify([{ bid_id: '1', title: 'Sensitive project', bid_due_date: '2026-01-01' }])));
  assert.equal(array.json_parsed, true);
  assert.equal(array.array_length, 1);
  assert.equal(array.records_have_bid_identifiers, true);
  assert.equal(array.records_have_titles, true);
  assert.equal(array.records_have_due_dates, true);
  assert.equal(JSON.stringify(array).includes('Sensitive project'), false);

  const object = inspectBidsPayload(Buffer.from(JSON.stringify({ bids: [] })));
  assert.deepEqual(object.top_level_keys, ['bids']);
  assert.equal(object.candidate_record_count, 0);
  assert.equal(object.empty, true);
  assert.equal(inspectBidsPayload(Buffer.from('{not json')).parsing_failed, true);
});

test('PlanetBids diagnostics capture runtime errors, network failures, chronology, and caps', async () => {
  const page = fakePage();
  const diagnostics = createPlanetBidsHydrationDiagnostics({ sourceId: 'source-1', taskId: 'task-1', sessionId: 'session-1' });
  diagnostics.attach(page);
  diagnostics.begin(1, page, '12');

  page.handlers.pageerror({ name: 'TypeError', message: 'token=secret exploded', stack: 'TypeError: token=secret\n at one\n at two' });
  page.handlers.console({ type: () => 'warning', text: () => 'Failed user@example.com token=secret', location: () => ({ url: 'https://x.test/a?token=secret', lineNumber: 2, columnNumber: 3 }) });
  page.handlers.console({ type: () => 'info', text: () => 'ignore me', location: () => ({}) });
  const failed = { method: () => 'GET', url: () => 'https://api-external.prod.planetbids.com/papi/oauth/refresh/?token=secret', resourceType: () => 'fetch', failure: () => ({ errorText: 'net::ERR_FAILED' }) };
  page.handlers.request(failed);
  page.handlers.requestfailed(failed);
  for (let i = 0; i < 60; i++) diagnostics.consoleEvent({ type: () => 'error', text: () => `error-${i}`, location: () => ({}) });

  await diagnostics.response({
    url: () => 'https://api-external.prod.planetbids.com/papi/bids?cid=12', status: () => 500,
    request: () => ({ method: () => 'GET', resourceType: () => 'fetch' }), headers: () => ({ 'content-type': 'application/json', 'content-length': '55' }),
    body: async () => Buffer.from(JSON.stringify({ bids: [{ id: 1, title: 'Do not persist' }] })),
  });
  await diagnostics.finish({ state: 'timeout', waitMs: 15000, finalUrl: page.url() }, page, { timeout: true });
  const output = diagnostics.build({ failure: true });
  const attempt = output.attempts[0];
  assert.equal(attempt.page_errors.length, 1);
  assert.equal(attempt.console_events.some((event) => event.type === 'info'), false);
  assert.ok(attempt.console_events.length <= 40);
  assert.equal(attempt.failed_requests[0].path, 'api-external.prod.planetbids.com/papi/oauth/refresh/');
  assert.equal(attempt.http_errors[0].status, 500);
  assert.equal(attempt.papi_bids.records_have_titles, true);
  assert.equal(JSON.stringify(output).includes('Do not persist'), false);
  assert.ok(attempt.dom);
});

test('PlanetBids diagnostics compare attempts and enforce the total payload limit', async () => {
  const page = fakePage();
  const diagnostics = createPlanetBidsHydrationDiagnostics({ sourceId: 'source-1', sessionId: 'session-1' });
  diagnostics.begin(1, page, '12');
  for (let i = 0; i < 40; i++) diagnostics.consoleEvent({ type: () => 'error', text: () => `x${i}-${'a'.repeat(700)}`, location: () => ({}) });
  await diagnostics.finish({ state: 'timeout', waitMs: 15000, finalUrl: page.url() }, page, { timeout: true });
  diagnostics.begin(2, page, '12');
  await diagnostics.finish({ state: 'timeout', waitMs: 15000, finalUrl: page.url() }, page, { timeout: true });
  const output = diagnostics.build({ failure: true });
  assert.equal(output.attempt_comparison.same_browserbase_session, true);
  assert.equal(output.attempt_comparison.same_playwright_page, true);
  assert.ok(Buffer.byteLength(JSON.stringify(output)) <= MAX_PAYLOAD_BYTES || output.diagnostics_truncated === true);
});
