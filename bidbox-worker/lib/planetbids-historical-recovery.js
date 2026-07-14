'use strict';

const crypto = require('crypto');

const PORTAL_API_CODES = new Set(['portal_error_page', 'detail_api_missing', 'rate_limited', 'authentication_expired']);
const IDENTITY_CODES = new Set(['conflicting_metadata', 'missing_stable_identifier']);
const PROTECTED_FIELDS = ['raw_title', 'bid_due_at', 'status', 'agency', 'county', 'source_id', 'source_url', 'portal_bid_id', 'portal_type'];

function hashIds(ids) {
  return crypto.createHash('sha256').update(JSON.stringify(ids)).digest('hex');
}

function unique(ids) {
  return [...new Set(ids)];
}

function buildRecoveryPlan({ frozenIds, wave1Ids, authenticationExpiredIds, recoveredIds, waveSize = 100 }) {
  if (unique(frozenIds).length !== frozenIds.length) throw new Error('frozen manifest contains duplicate UUIDs');
  const frozen = new Set(frozenIds);
  for (const id of [...wave1Ids, ...authenticationExpiredIds, ...recoveredIds]) {
    if (!frozen.has(id)) throw new Error(`exclusion is outside frozen manifest: ${id}`);
  }
  const wave1 = new Set(wave1Ids);
  const recovered = new Set(recoveredIds);
  const remainingIds = frozenIds.filter((id) => !wave1.has(id) && !recovered.has(id));
  const waves = [];
  for (let index = 0; index < remainingIds.length; index += waveSize) waves.push(remainingIds.slice(index, index + waveSize));
  return {
    remainingIds,
    waves,
    counts: {
      original_frozen_manifest: frozenIds.length,
      wave1_excluded: wave1Ids.length,
      authentication_expired_exclusions: authenticationExpiredIds.length,
      previously_recovered: recoveredIds.filter((id) => !wave1.has(id)).length,
      remaining: remainingIds.length,
    },
  };
}

function blank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function fieldRegressions(before, after) {
  return PROTECTED_FIELDS.filter((field) => !blank(before?.[field]) && blank(after?.[field]));
}

function dateValidationFailed(result) {
  const parse = result?.diagnostics?.due_date_parse;
  return Boolean(result?.diagnostics?.due_date_raw && parse && parse.ok === false);
}

function evaluateWaveGate({ tasks, identityFailures = [], duplicateCreations = 0, unrelatedRowsModified = 0, regressions = [], automaticRecoveryEnabled = false, missingAudits = [] }) {
  const results = tasks.map((task) => task.result || {});
  const browserFailures = results.filter((result) => result.error_code === 'browser_context_closed').length;
  const portalApiFailures = results.filter((result) => PORTAL_API_CODES.has(result.error_code)).length;
  const resultIdentityFailures = results.filter((result) => IDENTITY_CODES.has(result.error_code)).length;
  const timezoneFailures = results.filter(dateValidationFailed).length;
  const attempted = tasks.length;
  const reasons = [];
  if (duplicateCreations) reasons.push('duplicate_candidate_created');
  if (unrelatedRowsModified) reasons.push('unrelated_row_modified');
  if (regressions.length) reasons.push('good_non_null_value_overwritten_with_null_or_blank');
  if (identityFailures.length || resultIdentityFailures) reasons.push('candidate_identity_validation_failed');
  if (timezoneFailures) reasons.push('timezone_date_validation_failed');
  if (attempted && browserFailures / attempted > 0.20) reasons.push('browser_context_failure_rate_over_20_percent');
  if (attempted && portalApiFailures / attempted > 0.10) reasons.push('portal_api_error_rate_over_10_percent');
  if (automaticRecoveryEnabled) reasons.push('automatic_recovery_enabled');
  if (missingAudits.length) reasons.push('attempt_missing_audit');
  return {
    passed: reasons.length === 0,
    reasons,
    attempted,
    browser_context_failures: browserFailures,
    browser_context_failure_rate: attempted ? browserFailures / attempted : 0,
    portal_api_failures: portalApiFailures,
    portal_api_failure_rate: attempted ? portalApiFailures / attempted : 0,
    identity_failures: identityFailures.length + resultIdentityFailures,
    timezone_validation_failures: timezoneFailures,
    duplicate_creations: duplicateCreations,
    unrelated_rows_modified: unrelatedRowsModified,
    null_or_blank_overwrites: regressions.length,
    missing_audits: missingAudits.length,
  };
}

module.exports = { PORTAL_API_CODES, PROTECTED_FIELDS, buildRecoveryPlan, evaluateWaveGate, fieldRegressions, hashIds };
