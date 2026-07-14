'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  claimedPayload,
  heartbeatPayload,
  isLeaseExpired,
  isLiveRecoveryTask,
  reclaimStaleRecoveryTask,
} = require('../lib/planetbids-task-lease');

class FakeQuery {
  constructor(db, table, operation = 'select', patch = null) {
    this.db = db; this.table = table; this.operation = operation; this.patch = patch;
    this.filters = []; this.limitCount = null;
  }
  select() { return this; }
  eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
  contains(key, value) {
    const contains = (actual, expected) => Object.entries(expected).every(([k, v]) => v && typeof v === 'object' ? contains(actual?.[k], v) : actual?.[k] === v);
    this.filters.push((row) => contains(row[key], value)); return this;
  }
  order() { return this; }
  limit(value) { this.limitCount = value; return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  async execute(single) {
    await new Promise((resolve) => setImmediate(resolve));
    const rows = this.db.tables[this.table] ?? [];
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === 'update') {
      if (!matched.length) return { data: single ? null : [], error: null };
      for (const row of matched) {
        Object.assign(row, structuredClone(this.patch));
        row.updated_at = new Date(this.db.clock++).toISOString();
      }
      return { data: single ? structuredClone(matched[0]) : structuredClone(matched), error: null };
    }
    const selected = this.limitCount == null ? matched : matched.slice(0, this.limitCount);
    return { data: single ? structuredClone(selected[0] ?? null) : structuredClone(selected), error: null };
  }
}

class FakeSupabase {
  constructor(tables) { this.tables = structuredClone(tables); this.clock = Date.parse('2026-07-14T05:00:00Z'); }
  from(table) {
    return {
      select: () => new FakeQuery(this, table),
      update: (patch) => new FakeQuery(this, table, 'update', patch),
    };
  }
}

function task(overrides = {}) {
  return {
    id: 'task-1', task_type: 'planetbids_candidate_recovery', status: 'running',
    created_at: '2026-07-14T03:00:00Z', started_at: '2026-07-14T03:01:00Z',
    updated_at: '2026-07-14T03:01:00Z', payload: { candidate_id: 'candidate-1' },
    ...overrides,
  };
}

test('stale running task becomes reclaimable after lease expiry', async () => {
  const stale = task({ payload: { candidate_id: 'candidate-1', recovery_lease: { worker_id: 'dead', expires_at: '2026-07-14T03:04:00Z', attempt_count: 1 } } });
  const db = new FakeSupabase({ agent_tasks: [stale], opportunity_recovery_audits: [] });
  const result = await reclaimStaleRecoveryTask(db, stale, { now: new Date('2026-07-14T04:00:00Z') });
  assert.equal(result.action, 'requeued');
  assert.equal(result.task.status, 'pending');
  assert.equal(result.task.payload.recovery_lease.stale_recovery_count, 1);
});

test('live heartbeat prevents reclamation', async () => {
  const live = task({ payload: { candidate_id: 'candidate-1', recovery_lease: { worker_id: 'live', expires_at: '2026-07-14T04:03:00Z', attempt_count: 1 } } });
  const db = new FakeSupabase({ agent_tasks: [live], opportunity_recovery_audits: [] });
  const result = await reclaimStaleRecoveryTask(db, live, { now: new Date('2026-07-14T04:00:00Z') });
  assert.equal(result.action, 'not_stale');
  assert.equal(db.tables.agent_tasks[0].status, 'running');
});

test('two reconcilers cannot reclaim the same task', async () => {
  const stale = task({ payload: { candidate_id: 'candidate-1', recovery_lease: { worker_id: 'dead', expires_at: '2026-07-14T03:04:00Z', attempt_count: 1 } } });
  const db = new FakeSupabase({ agent_tasks: [stale], opportunity_recovery_audits: [] });
  const results = await Promise.all([
    reclaimStaleRecoveryTask(db, structuredClone(stale), { now: new Date('2026-07-14T04:00:00Z') }),
    reclaimStaleRecoveryTask(db, structuredClone(stale), { now: new Date('2026-07-14T04:00:00Z') }),
  ]);
  assert.deepEqual(results.map((result) => result.action).sort(), ['lost_race', 'requeued']);
});

test('already-successful stale task finalizes from audit without retry', async () => {
  const stale = task();
  const audit = { id: 'audit-1', agent_task_id: stale.id, opportunity_candidate_id: 'candidate-1', outcome: 'recovered', extraction_source: 'detail_api', error_code: null };
  const db = new FakeSupabase({ agent_tasks: [stale], opportunity_recovery_audits: [audit] });
  const result = await reclaimStaleRecoveryTask(db, stale, { now: new Date('2026-07-14T04:00:00Z') });
  assert.equal(result.action, 'finalized_from_audit');
  assert.equal(result.task.status, 'complete');
  assert.equal(result.task.result.recovered, 1);
});

test('partially attempted stale task retries safely and increments claim attempt', async () => {
  const stale = task();
  const db = new FakeSupabase({ agent_tasks: [stale], opportunity_recovery_audits: [] });
  const reclaimed = await reclaimStaleRecoveryTask(db, stale, { now: new Date('2026-07-14T04:00:00Z') });
  const payload = claimedPayload(reclaimed.task, 'replacement', new Date('2026-07-14T04:01:00Z'));
  assert.equal(payload.recovery_lease.attempt_count, 2);
  assert.equal(payload.recovery_lease.worker_id, 'replacement');
});

test('session-limit calculation ignores expired leases after worker replacement', () => {
  const now = new Date('2026-07-14T04:00:00Z');
  const expired = task();
  const livePayload = claimedPayload(task({ status: 'pending', started_at: null }), 'live', now);
  const live = task({ payload: livePayload, updated_at: now.toISOString() });
  assert.equal(isLiveRecoveryTask(expired, now), false);
  assert.equal(isLiveRecoveryTask(live, now), true);
  assert.equal([expired, live].filter((row) => isLiveRecoveryTask(row, now)).length, 1);
});

test('heartbeat extends an owned lease', () => {
  const claimed = task({ status: 'pending', started_at: null });
  claimed.payload = claimedPayload(claimed, 'worker-1', new Date('2026-07-14T04:00:00Z'), 60_000);
  claimed.status = 'running';
  claimed.payload = heartbeatPayload(claimed, new Date('2026-07-14T04:00:30Z'), 60_000);
  assert.equal(claimed.payload.recovery_lease.expires_at, '2026-07-14T04:01:30.000Z');
  assert.equal(isLeaseExpired(claimed, new Date('2026-07-14T04:01:00Z')), false);
});

test('retry count is bounded and persists a terminal task result', async () => {
  const stale = task({ payload: { candidate_id: 'candidate-1', recovery_lease: { worker_id: 'dead', expires_at: '2026-07-14T03:04:00Z', attempt_count: 3 } } });
  const db = new FakeSupabase({ agent_tasks: [stale], opportunity_recovery_audits: [] });
  const result = await reclaimStaleRecoveryTask(db, stale, { now: new Date('2026-07-14T04:00:00Z'), maxAttempts: 3 });
  assert.equal(result.action, 'retry_exhausted');
  assert.equal(result.task.status, 'failed');
  assert.equal(result.task.result.error_code, 'stale_recovery_retry_exhausted');
});
