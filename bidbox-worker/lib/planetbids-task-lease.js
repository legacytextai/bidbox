'use strict';

const DEFAULT_LEASE_MS = 3 * 60 * 1000;
const DEFAULT_LEGACY_STALE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 3;

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function leaseFor(task) {
  return task?.payload?.recovery_lease ?? null;
}

function leaseAttemptCount(task) {
  const stored = Number(leaseFor(task)?.attempt_count || 0);
  if (stored > 0) return stored;
  return task?.status === 'running' && task?.started_at ? 1 : 0;
}

function isLeaseExpired(task, now = new Date(), legacyStaleMs = DEFAULT_LEGACY_STALE_MS) {
  if (task?.status !== 'running') return false;
  const nowMs = new Date(now).getTime();
  const expiresAt = new Date(leaseFor(task)?.expires_at ?? '').getTime();
  if (Number.isFinite(expiresAt)) return expiresAt <= nowMs;
  const lastActivity = new Date(task.updated_at ?? task.started_at ?? task.created_at ?? '').getTime();
  return Number.isFinite(lastActivity) && lastActivity + legacyStaleMs <= nowMs;
}

function isLiveRecoveryTask(task, now = new Date(), legacyStaleMs = DEFAULT_LEGACY_STALE_MS) {
  if (['complete', 'failed'].includes(task?.status)) return false;
  if (task?.status !== 'running') return true;
  return !isLeaseExpired(task, now, legacyStaleMs);
}

function claimedPayload(task, workerId, now = new Date(), leaseMs = DEFAULT_LEASE_MS) {
  const claimedAt = iso(now);
  const previous = leaseFor(task) ?? {};
  return {
    ...(task.payload ?? {}),
    recovery_lease: {
      worker_id: workerId,
      claimed_at: claimedAt,
      heartbeat_at: claimedAt,
      expires_at: new Date(new Date(now).getTime() + leaseMs).toISOString(),
      attempt_count: leaseAttemptCount(task) + 1,
      stale_recovery_count: Number(previous.stale_recovery_count || 0),
      history: Array.isArray(previous.history) ? previous.history : [],
    },
  };
}

function heartbeatPayload(task, now = new Date(), leaseMs = DEFAULT_LEASE_MS) {
  const lease = leaseFor(task);
  if (!lease?.worker_id) throw new Error('recovery task has no active lease worker');
  const heartbeatAt = iso(now);
  return {
    ...(task.payload ?? {}),
    recovery_lease: {
      ...lease,
      heartbeat_at: heartbeatAt,
      expires_at: new Date(new Date(now).getTime() + leaseMs).toISOString(),
    },
  };
}

function reclaimedPayload(task, action, now = new Date()) {
  const lease = leaseFor(task) ?? {};
  const history = Array.isArray(lease.history) ? lease.history : [];
  return {
    ...(task.payload ?? {}),
    recovery_lease: {
      worker_id: null,
      claimed_at: null,
      heartbeat_at: null,
      expires_at: null,
      attempt_count: leaseAttemptCount(task),
      stale_recovery_count: Number(lease.stale_recovery_count || 0) + 1,
      history: [...history, {
        recovered_at: iso(now),
        action,
        abandoned_worker_id: lease.worker_id ?? null,
        abandoned_claimed_at: lease.claimed_at ?? task.started_at ?? null,
        abandoned_heartbeat_at: lease.heartbeat_at ?? task.updated_at ?? null,
      }],
    },
  };
}

function auditResult(task, audit) {
  const recovered = audit.outcome === 'recovered' ? 1 : 0;
  return {
    candidate_id: task.payload?.candidate_id ?? audit.opportunity_candidate_id,
    attempted: 1,
    recovered,
    unresolved: recovered ? 0 : 1,
    source: audit.extraction_source ?? null,
    error_code: audit.error_code ?? null,
    browserbase_sessions: 0,
    runtime_ms: 0,
    already_finalized: true,
    stale_recovery_audit_id: audit.id,
    phase: 'planetbids_candidate_recovery_v1',
  };
}

async function reclaimStaleRecoveryTask(sb, task, {
  now = new Date(),
  legacyStaleMs = DEFAULT_LEGACY_STALE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
} = {}) {
  if (!isLeaseExpired(task, now, legacyStaleMs)) return { action: 'not_stale', task };

  const { data: audits, error: auditError } = await sb.from('opportunity_recovery_audits')
    .select('*').eq('agent_task_id', task.id).order('created_at', { ascending: false }).limit(1);
  if (auditError) throw auditError;

  const audit = audits?.[0] ?? null;
  let action;
  let patch;
  if (audit) {
    action = 'finalized_from_audit';
    patch = {
      status: 'complete',
      result: auditResult(task, audit),
      error: null,
      completed_at: iso(now),
      payload: reclaimedPayload(task, action, now),
    };
  } else if (leaseAttemptCount(task) >= maxAttempts) {
    action = 'retry_exhausted';
    patch = {
      status: 'failed',
      result: {
        candidate_id: task.payload?.candidate_id ?? null,
        attempted: 1,
        recovered: 0,
        unresolved: 1,
        error_code: 'stale_recovery_retry_exhausted',
        browserbase_sessions: 0,
        runtime_ms: 0,
        phase: 'planetbids_candidate_recovery_v1',
      },
      error: 'stale recovery retry limit exhausted',
      completed_at: iso(now),
      payload: reclaimedPayload(task, action, now),
    };
  } else {
    action = 'requeued';
    patch = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      error: null,
      payload: reclaimedPayload(task, action, now),
    };
  }

  let query = sb.from('agent_tasks').update(patch)
    .eq('id', task.id).eq('status', 'running').eq('updated_at', task.updated_at);
  const workerId = leaseFor(task)?.worker_id;
  if (workerId) query = query.contains('payload', { recovery_lease: { worker_id: workerId } });
  const { data, error } = await query.select('*').maybeSingle();
  if (error) throw error;
  return data ? { action, task: data } : { action: 'lost_race', task: null };
}

module.exports = {
  DEFAULT_LEASE_MS,
  DEFAULT_LEGACY_STALE_MS,
  DEFAULT_MAX_ATTEMPTS,
  auditResult,
  claimedPayload,
  heartbeatPayload,
  isLeaseExpired,
  isLiveRecoveryTask,
  leaseAttemptCount,
  leaseFor,
  reclaimStaleRecoveryTask,
  reclaimedPayload,
};
