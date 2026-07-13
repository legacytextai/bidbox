'use strict';

const crypto = require('node:crypto');

const AGENCY_COUNTY = Object.freeze({
  'City of Irvine': 'Orange',
  'City of Huntington Beach': 'Orange',
  'City of Riverside': 'Riverside',
  'City of San Diego': 'San Diego',
  'City of Carlsbad': 'San Diego',
  'City of Long Beach': 'Los Angeles',
  'Port of Long Beach': 'Los Angeles',
  'Port of Los Angeles': 'Los Angeles',
});
const CALEPROCURE_SOURCE_ID = '75d7fa42-2302-4fce-ba0f-ba33ef6e9a82';
const PUBLIC_WORKS = /\b(bridge|road|street|sidewalk|concrete|asphalt|pav(?:ement|ing)|drainage|lighting|traffic|sewer|storm drain|wastewater|water|utilities|electrical|plumbing|construction|contractor|building|roof|hvac|pipeline|engineering|environmental|repair|maintenance|rehabilitation|replacement|renovation|improvement)\b/i;
const NON_PUBLIC_WORKS = [
  ['Non-public-works software / IT procurement', /\b(software|cloud services?|saas|cybersecurity|information technology|data system|subscription platform)\b/i],
  ['Non-public-works funding program', /\b(broadband funding|funding program|grant program)\b/i],
  ['Municipal operations outside construction scope', /\b(janitorial|custodial|lodging|courier|shipping|printing|videographer|guard services?|towing services?|medical consult|pharmaceutical|interpreting|translation|office moving|general supplies)\b/i],
];

function parseValueFromTitle(title) {
  const match = String(title ?? '').match(/\$\s*([\d,]+(?:\.\d+)?)\s*([BbMmKk])?/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return value * ({ b: 1e9, m: 1e6, k: 1e3 }[String(match[2] ?? '').toLowerCase()] ?? 1);
}

function formatDollar(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

function candidateMetadataVersion(candidate) {
  const relevant = {
    agency: candidate.agency ?? null,
    bid_due_at: candidate.bid_due_at ?? null,
    county: candidate.county ?? null,
    estimated_value: candidate.estimated_value ?? null,
    ingestion_status: candidate.ingestion_status ?? null,
    portal_type: candidate.portal_type ?? null,
    raw_title: candidate.raw_title ?? null,
    required_licenses: candidate.required_licenses ?? null,
    required_naics: candidate.required_naics ?? null,
    scope_text: candidate.scope_text ?? null,
    source_id: candidate.source_id ?? null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}

function result(candidate, status, primaryReason, score) {
  return {
    opportunity_candidate_id: candidate.id,
    status,
    primary_reason: primaryReason,
    reasons: primaryReason.split(';').map((reason) => reason.trim()).filter(Boolean),
    qualification_score: score,
    candidate_metadata_version: candidateMetadataVersion(candidate),
  };
}

function qualifyCandidate(candidate, profile, now = Date.now()) {
  const county = candidate.county ?? AGENCY_COUNTY[candidate.agency ?? ''] ?? null;
  const value = Number(candidate.estimated_value) > 0
    ? Number(candidate.estimated_value)
    : parseValueFromTitle(candidate.raw_title);

  if (candidate.portal_type === 'caleprocure' || candidate.source_id === CALEPROCURE_SOURCE_ID) {
    const title = String(candidate.raw_title ?? '');
    const exclusion = NON_PUBLIC_WORKS.find(([, pattern]) => pattern.test(title));
    if (exclusion && !PUBLIC_WORKS.test(title)) return result(candidate, 'red', exclusion[0], 0);
  }

  if (candidate.bid_due_at) {
    const due = new Date(candidate.bid_due_at).getTime();
    if (Number.isFinite(due) && due < now) return result(candidate, 'red', 'Bid closed', 0);
  }
  const targetCounties = profile.target_counties ?? [];
  if (county && targetCounties.length > 0 && !targetCounties.some((item) => item.toLowerCase() === county.toLowerCase())) {
    return result(candidate, 'red', `Location outside target counties (${county})`, 10);
  }
  if (value !== null && profile.min_project_value !== null && value < profile.min_project_value) {
    return result(candidate, 'red', `Project value (${formatDollar(value)}) below minimum (${formatDollar(profile.min_project_value)})`, 10);
  }
  if (value !== null && profile.max_project_value !== null && value > profile.max_project_value) {
    return result(candidate, 'red', `Project value (${formatDollar(value)}) above maximum (${formatDollar(profile.max_project_value)})`, 10);
  }

  const requiredLicenses = candidate.required_licenses ?? [];
  const requiredNaics = candidate.required_naics ?? [];
  if (requiredLicenses.length || requiredNaics.length) {
    const licenseMatch = requiredLicenses.some((required) => (profile.licenses_held ?? []).some((held) => held.toLowerCase() === required.toLowerCase()));
    const naicsMatch = requiredNaics.some((required) => (profile.naics_codes ?? []).includes(required));
    if (!licenseMatch && !naicsMatch) {
      return result(candidate, 'red', `No matching capability (requires ${[...requiredLicenses, ...requiredNaics].join(', ')})`, 10);
    }
  }

  const flags = [];
  if (!county) flags.push('County not verified');
  if (value === null) flags.push('Value not determinable');
  if (!candidate.scope_text || candidate.scope_text.trim().length < 50) flags.push('Scope not yet available');
  if (candidate.bid_due_at) {
    const days = Math.ceil((new Date(candidate.bid_due_at).getTime() - now) / 86_400_000);
    if (days <= 5) flags.push(`Bid due in ${days} day${days === 1 ? '' : 's'}`);
  }
  if (flags.length) return result(candidate, 'yellow', flags.join('; '), Math.max(30, 50 - flags.length * 10));

  const positives = [];
  let score = 70;
  if (county && targetCounties.some((item) => item.toLowerCase() === county.toLowerCase())) {
    positives.push(`County in target list (${county})`);
    score += 10;
  }
  if (value !== null && profile.min_project_value !== null && profile.max_project_value !== null) {
    positives.push(`Value in range (${formatDollar(value)})`);
    score += 10;
  }
  return result(candidate, 'green', positives.join('; ') || 'No disqualifying flags', Math.min(100, score));
}

async function fetchAllCandidates(supabase, { pageSize = 500, candidateId = null } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase.from('opportunity_candidates')
      .select('id, source_id, portal_type, raw_title, agency, bid_due_at, scope_text, estimated_value, county, required_licenses, required_naics, ingestion_status')
      .eq('status', 'pending').eq('ingestion_status', 'valid')
      .order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (candidateId) query = query.eq('id', candidateId);
    const { data, error } = await query;
    if (error) throw new Error(`qualification candidate query failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize || candidateId) break;
  }
  return rows;
}

module.exports = { candidateMetadataVersion, fetchAllCandidates, qualifyCandidate };
