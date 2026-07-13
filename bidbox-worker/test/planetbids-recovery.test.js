'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure, extractExactApiMetadata, retryDelayMs, safeMetadataPatch } = require('../lib/planetbids-recovery');

test('empty Ember shell is a retryable extraction failure', () => {
  assert.equal(classifyFailure(new Error('incomplete'), { target_bid_id: '12345', body_chars: 0, ember_root: true, detail_root: false }), 'empty_detail_shell');
});
test('explicit PlanetBids error page is classified', () => {
  assert.equal(classifyFailure(new Error('failed'), { target_bid_id: '12345', body_chars: 80, body_preview: 'Something went wrong. Please retry.' }), 'portal_error_page');
});
test('authoritative API extraction matches only the exact target bid ID', () => {
  const exact = extractExactApiMetadata({ data: [
    { bid_id: 111, bidTitle: 'Wrong project', dueDate: '07/20/2026' },
    { bid_id: 222, bidTitle: 'Exact project', dueDate: '07/21/2026', status: 'Bidding' },
  ] }, '222', 'https://api-external.prod.planetbids.com/papi/bids/222', 200);
  assert.equal(exact.raw_title, 'Exact project');
  assert.equal(exact.portal_bid_id, '222');
  assert.equal(exact.extraction_confidence, 'authoritative');
});
test('good existing values are never overwritten with null or empty values', () => {
  const patch = safeMetadataPatch(
    { raw_title: 'Existing title', bid_due_at: '2026-07-20T17:00:00Z', county: 'Riverside' },
    { raw_title: null, bid_due_at: '', county: null, agency: 'City', extraction_confidence: 'authoritative' },
  );
  assert.deepEqual(patch, { agency: 'City' });
});
test('retry schedule is bounded at three attempts', () => {
  assert.equal(retryDelayMs(1, 'empty_detail_shell'), 15 * 60 * 1000);
  assert.equal(retryDelayMs(2, 'empty_detail_shell'), 2 * 60 * 60 * 1000);
  assert.equal(retryDelayMs(3, 'empty_detail_shell'), null);
});
