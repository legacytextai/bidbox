'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBidDueDate } = require('../lib/planetbids-date');
const { APPROVED, APPROVED_IDS, MODE, stableCandidateState, validateScope } = require('../scripts/repair-planetbids-timezone');

test('all 10 approved Pacific local values map to their exact expected UTC timestamps', () => {
  for (const approved of Object.values(APPROVED)) {
    const pacificLocal = approved.before.replace(/\.000Z$/, '');
    assert.equal(parseBidDueDate(pacificLocal), approved.expected, approved.agency);
  }
});

test('repair scope accepts only the exact approved allowlist and explicit mode', () => {
  assert.deepEqual(validateScope([...APPROVED_IDS].reverse(), MODE, true), APPROVED_IDS);
});

test('repair scope rejects a missing UUID', () => {
  assert.throws(() => validateScope(APPROVED_IDS.slice(1), MODE, true), /exact 10 approved UUIDs/);
});

test('repair scope rejects an extra or substituted UUID', () => {
  assert.throws(() => validateScope([...APPROVED_IDS.slice(1), '00000000-0000-0000-0000-000000000000'], MODE, true), /differs from the exact/);
});

test('repair scope requires explicit mode and confirmation', () => {
  assert.throws(() => validateScope(APPROVED_IDS, 'generic-repair', true), /--mode/);
  assert.throws(() => validateScope(APPROVED_IDS, MODE, false), /confirm-exact-allowlist/);
});

test('stable repair state includes identity and user-linked reference fields', () => {
  const state = stableCandidateState({
    id: 'candidate', raw_title: 'Title', agency: 'Agency', source_id: 'source', source_url: 'url',
    portal_bid_id: '123', status: 'pending', county: null, ingestion_status: 'valid',
    ingestion_issue_code: null, ingestion_issue_reason: null, recovery_attempt_count: 1,
    recovery_last_task_id: 'task', converted_project_id: 'project', metadata_version: 'version',
    bid_due_at: '2025-04-24T18:00:00Z',
    last_metadata_refreshed_at: null, metadata_refresh_source: null, metadata_refresh_trigger: null,
  });
  assert.deepEqual(Object.keys(state), [
    'id', 'raw_title', 'agency', 'source_id', 'source_url', 'portal_bid_id', 'status', 'county',
    'ingestion_status', 'ingestion_issue_code', 'ingestion_issue_reason', 'recovery_attempt_count',
    'recovery_last_task_id', 'converted_project_id', 'metadata_version', 'bid_due_at',
    'last_metadata_refreshed_at', 'metadata_refresh_source', 'metadata_refresh_trigger',
  ]);
});
