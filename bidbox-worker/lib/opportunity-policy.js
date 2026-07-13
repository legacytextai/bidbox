function normalizedId(value) {
  const id = String(value ?? '').trim();
  return id || null;
}

function isConfirmedCrossPortalDuplicate(a, b) {
  const aId = normalizedId(a?.portal_bid_id);
  const bId = normalizedId(b?.portal_bid_id);
  return Boolean(
    aId && bId && aId === bId &&
    new Set([a?.portal_type, b?.portal_type]).size === 2 &&
    [a?.portal_type, b?.portal_type].includes('caltrans') &&
    [a?.portal_type, b?.portal_type].includes('caleprocure')
  );
}

function resolveCrossPortalCanonical(a, b) {
  if (!isConfirmedCrossPortalDuplicate(a, b)) return null;
  return a.portal_type === 'caltrans'
    ? { canonical: a, duplicate: b }
    : { canonical: b, duplicate: a };
}

function classifyIngestionCandidate(portalType, candidate) {
  const sourceUrl = String(candidate?.source_url ?? '');
  const title = String(candidate?.raw_title ?? '').trim();
  const stableId = normalizedId(candidate?.portal_bid_id ?? candidate?.crawl_data?.bid_id);

  if (portalType === 'planetbids') {
    if (!stableId || !/\/bo-detail\/\d+(?:[/?#]|$)/.test(sourceUrl)) {
      return { status: 'quarantined', code: 'missing_stable_portal_identifier', reason: 'Invalid PlanetBids record: missing stable detail identifier' };
    }
    if (!title) {
      return { status: 'quarantined', code: 'missing_required_title', reason: 'Invalid PlanetBids record: detail metadata is missing a title' };
    }
  }

  return { status: 'valid', code: null, reason: null };
}

module.exports = { classifyIngestionCandidate, isConfirmedCrossPortalDuplicate, resolveCrossPortalCanonical };
