const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyIngestionCandidate, isConfirmedCrossPortalDuplicate, resolveCrossPortalCanonical } = require('../lib/opportunity-policy');

test('confirmed Caltrans / Cal eProcure IDs match regardless of ingestion order', () => {
  const ct = { portal_type: 'caltrans', portal_bid_id: '04-1J7104' };
  const ce = { portal_type: 'caleprocure', portal_bid_id: '04-1J7104' };
  assert.equal(isConfirmedCrossPortalDuplicate(ct, ce), true);
  assert.equal(isConfirmedCrossPortalDuplicate(ce, ct), true);
  assert.equal(resolveCrossPortalCanonical(ct, ce).canonical.portal_type, 'caltrans');
  assert.equal(resolveCrossPortalCanonical(ce, ct).canonical.portal_type, 'caltrans');
});

test('a reversed existing relationship normalizes to Caltrans canonical', () => {
  const caltrans = { id: 'ct', portal_type: 'caltrans', portal_bid_id: 'A-1', canonical_candidate_id: 'ce' };
  const eprocure = { id: 'ce', portal_type: 'caleprocure', portal_bid_id: 'A-1' };
  const resolved = resolveCrossPortalCanonical(caltrans, eprocure);
  assert.equal(resolved.canonical.id, 'ct');
  assert.equal(resolved.duplicate.id, 'ce');
});

test('single-portal and similar non-duplicate opportunities remain independent', () => {
  assert.equal(isConfirmedCrossPortalDuplicate(
    { portal_type: 'caltrans', portal_bid_id: 'A-1' },
    { portal_type: 'caleprocure', portal_bid_id: 'A-2' },
  ), false);
  assert.equal(isConfirmedCrossPortalDuplicate(
    { portal_type: 'caltrans', portal_bid_id: 'A-1' },
    { portal_type: 'caltrans', portal_bid_id: 'A-1' },
  ), false);
});

test('PlanetBids incomplete detail rows are quarantined with authoritative reasons', () => {
  assert.deepEqual(classifyIngestionCandidate('planetbids', {
    source_url: 'https://vendors.planetbids.com/portal/1/bo/bo-detail/42',
    portal_bid_id: '42', raw_title: null,
  }), {
    status: 'quarantined', code: 'missing_required_title',
    reason: 'Invalid PlanetBids record: detail metadata is missing a title',
  });
});

test('valid PlanetBids detail rows remain user-facing', () => {
  assert.equal(classifyIngestionCandidate('planetbids', {
    source_url: 'https://vendors.planetbids.com/portal/1/bo/bo-detail/42',
    portal_bid_id: '42', raw_title: 'Runway paving',
  }).status, 'valid');
});
