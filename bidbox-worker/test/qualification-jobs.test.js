'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { candidateMetadataVersion, qualifyCandidate } = require('../lib/qualification');
const { BATCH_SIZE } = require('../drivers/qualification_jobs');

const profile = { target_counties: ['Riverside'], licenses_held: [], naics_codes: [], min_project_value: null, max_project_value: null };
function candidate(overrides = {}) {
  return { id: 'candidate-1', raw_title: 'Road improvement', agency: 'Agency', bid_due_at: '2099-01-01T00:00:00Z', scope_text: 'A sufficiently detailed construction scope that exceeds fifty characters.', estimated_value: 1000000, county: 'Riverside', required_licenses: [], required_naics: [], ingestion_status: 'valid', ...overrides };
}
test('Riverside profile filters a known non-Riverside county', () => {
  const result = qualifyCandidate(candidate({ county: 'Orange' }), profile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'red');
  assert.match(result.primary_reason, /outside target counties \(Orange\)/);
});
test('unknown county fails closed when the profile targets counties', () => {
  const result = qualifyCandidate(candidate({ county: null }), profile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'red');
  assert.match(result.primary_reason, /County not verified — cannot confirm location within target counties \(Riverside\)/);
});
test('unknown county stays yellow for profiles with no county selection', () => {
  const noCountyProfile = { ...profile, target_counties: [] };
  const result = qualifyCandidate(candidate({ county: null }), noCountyProfile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'yellow');
  assert.match(result.primary_reason, /County not verified/);
});
test('statewide agency without county evidence does not imply a county match', () => {
  const result = qualifyCandidate(
    candidate({ county: null, agency: 'Department of General Services', portal_type: 'caleprocure' }),
    profile,
    Date.parse('2026-07-13'),
  );
  assert.equal(result.status, 'red');
  assert.match(result.primary_reason, /County not verified/);
});
test('agency headquarters county does not leak beyond the explicit agency map', () => {
  // "County of Orange" is not in AGENCY_COUNTY; without a county column value
  // it must fail closed rather than surface as a possible Riverside match.
  const result = qualifyCandidate(candidate({ county: null, agency: 'County of Orange' }), profile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'red');
  assert.match(result.primary_reason, /County not verified/);
});
test('multi-county project including Riverside is not county-filtered', () => {
  const result = qualifyCandidate(candidate({ county: 'Riverside, San Bernardino' }), profile, Date.parse('2026-07-13'));
  assert.notEqual(result.status, 'red');
});
test('multi-county project excluding Riverside is filtered', () => {
  const result = qualifyCandidate(candidate({ county: 'Los Angeles, Orange' }), profile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'red');
  assert.match(result.primary_reason, /outside target counties/);
});
test('county match is case-insensitive', () => {
  const result = qualifyCandidate(candidate({ county: 'RIVERSIDE' }), profile, Date.parse('2026-07-13'));
  assert.notEqual(result.status, 'red');
});
test('qualification writes use bulk-sized batches', () => {
  assert.ok(BATCH_SIZE >= 200 && BATCH_SIZE <= 500);
});
test('qualification-relevant changes alter candidate metadata version', () => {
  assert.notEqual(candidateMetadataVersion(candidate()), candidateMetadataVersion(candidate({ county: 'Orange' })));
});
