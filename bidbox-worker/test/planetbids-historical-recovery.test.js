'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRecoveryPlan, evaluateWaveGate, fieldRegressions } = require('../lib/planetbids-historical-recovery');

test('buildRecoveryPlan excludes all Wave 1 and previously recovered IDs in deterministic waves', () => {
  const frozenIds = Array.from({ length: 583 }, (_, i) => `id-${String(i).padStart(3, '0')}`);
  const wave1Ids = frozenIds.slice(0, 100);
  const authenticationExpiredIds = [frozenIds[2], frozenIds[9]];
  const recoveredIds = [...frozenIds.slice(0, 98), ...frozenIds.slice(100, 110)];
  const plan = buildRecoveryPlan({ frozenIds, wave1Ids, authenticationExpiredIds, recoveredIds });
  assert.equal(plan.remainingIds.length, 473);
  assert.deepEqual(plan.waves.map((wave) => wave.length), [100, 100, 100, 100, 73]);
  assert.equal(plan.counts.wave1_excluded, 100);
  assert.equal(plan.counts.previously_recovered, 10);
  assert.ok(plan.remainingIds.every((id) => !wave1Ids.includes(id)));
});

test('fieldRegressions catches null, blank, and whitespace overwrites', () => {
  assert.deepEqual(fieldRegressions({ raw_title: 'Good', bid_due_at: '2026-01-01', agency: 'Agency' }, { raw_title: ' ', bid_due_at: null, agency: 'Agency' }), ['raw_title', 'bid_due_at']);
});

test('wave gate enforces strict rates and safety controls', () => {
  const passing = evaluateWaveGate({ tasks: Array.from({ length: 100 }, () => ({ result: {} })) });
  assert.equal(passing.passed, true);
  const browserBoundary = evaluateWaveGate({ tasks: Array.from({ length: 100 }, (_, i) => ({ result: i < 20 ? { error_code: 'browser_context_closed' } : {} })) });
  assert.equal(browserBoundary.passed, true);
  const failing = evaluateWaveGate({ tasks: Array.from({ length: 100 }, (_, i) => ({ result: i < 21 ? { error_code: 'browser_context_closed' } : {} })), duplicateCreations: 1 });
  assert.equal(failing.passed, false);
  assert.deepEqual(failing.reasons, ['duplicate_candidate_created', 'browser_context_failure_rate_over_20_percent']);
});
