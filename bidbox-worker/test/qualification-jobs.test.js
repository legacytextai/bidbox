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
test('unknown county remains visible as yellow and clearly unverified', () => {
  const result = qualifyCandidate(candidate({ county: null }), profile, Date.parse('2026-07-13'));
  assert.equal(result.status, 'yellow');
  assert.match(result.primary_reason, /County not verified/);
});
test('qualification writes use bulk-sized batches', () => {
  assert.ok(BATCH_SIZE >= 200 && BATCH_SIZE <= 500);
});
test('qualification-relevant changes alter candidate metadata version', () => {
  assert.notEqual(candidateMetadataVersion(candidate()), candidateMetadataVersion(candidate({ county: 'Orange' })));
});
