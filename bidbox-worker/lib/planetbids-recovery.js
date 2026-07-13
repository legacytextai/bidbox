'use strict';

const RETRYABLE_CODES = new Set([
  'empty_detail_shell', 'detail_timeout', 'browser_context_closed',
  'authentication_expired', 'rate_limited', 'detail_api_missing',
  'portal_error_page', 'missing_required_title',
]);

const TERMINAL_CODES = new Set([
  'missing_stable_identifier', 'conflicting_metadata', 'project_unavailable',
]);

function clean(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function explicitBidId(object) {
  const attrs = object?.attributes && typeof object.attributes === 'object' ? object.attributes : {};
  return clean(object?.bid_id ?? object?.bidId ?? object?.bidID ?? object?.bo_id ?? object?.boId ?? attrs.bid_id ?? attrs.bidId ?? attrs.bo_id ?? null);
}

function normalizeApiMetadata(object, targetBidId, responseUrl, responseStatus) {
  const attrs = object?.attributes && typeof object.attributes === 'object' ? object.attributes : {};
  const row = { ...object, ...attrs };
  const id = explicitBidId(object) ?? (/\b(bid|solicitation|opportunit)/i.test(String(object?.type ?? '')) ? clean(object?.id) : null);
  if (id !== String(targetBidId)) return null;
  return {
    portal_bid_id: id,
    raw_title: clean(row.bidTitle ?? row.bid_title ?? row.projectTitle ?? row.project_title ?? row.title ?? row.name),
    due_date_raw: clean(row.bidDueDate ?? row.bid_due_date ?? row.dueDate ?? row.due_date ?? row.closingDate ?? row.closing_date ?? row.closeDate),
    status: clean(row.bidStatus ?? row.bid_status ?? row.status ?? row.stage),
    solicitation_number: clean(row.solicitationNumber ?? row.solicitation_number ?? row.bidNumber ?? row.bid_number ?? row.invitationNumber),
    project_type: clean(row.projectType ?? row.project_type ?? row.bidType ?? row.bid_type ?? row.type),
    agency: clean(row.agencyName ?? row.agency_name ?? row.organizationName ?? row.organization_name),
    county: clean(row.county ?? row.locationCounty ?? row.location_county),
    project_address: clean(row.projectAddress ?? row.project_address ?? row.location ?? row.address),
    scope_text: clean(row.description ?? row.scope ?? row.scopeOfWork ?? row.scope_of_work),
    contact: {
      name: clean(row.contactName ?? row.contact_name),
      email: clean(row.contactEmail ?? row.contact_email),
      phone: clean(row.contactPhone ?? row.contact_phone),
    },
    extraction_source: 'detail_api',
    extraction_confidence: 'authoritative',
    api_response_url: String(responseUrl ?? '').substring(0, 500),
    api_response_status: responseStatus ?? null,
  };
}

function extractExactApiMetadata(payload, targetBidId, responseUrl = '', responseStatus = null) {
  const seen = new Set();
  let found = null;
  function walk(value) {
    if (found || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (!Array.isArray(value)) found = normalizeApiMetadata(value, targetBidId, responseUrl, responseStatus);
    if (found) return;
    for (const child of Array.isArray(value) ? value : Object.values(value)) walk(child);
  }
  walk(payload);
  return found;
}

function classifyFailure(error, diagnostics = {}) {
  const text = clean(error?.message ?? error ?? '') ?? '';
  const body = clean(diagnostics.body_preview) ?? '';
  if (!diagnostics.target_bid_id) return 'missing_stable_identifier';
  if (/429|rate.?limit/i.test(text)) return 'rate_limited';
  if (/401|unauthorized|session expired|log.?in/i.test(`${text} ${body}`)) return 'authentication_expired';
  if (/context.*closed|target.*closed|browser.*closed/i.test(text)) return 'browser_context_closed';
  if (/something went wrong|unexpected error|service unavailable/i.test(body)) return 'portal_error_page';
  if (/not found|no longer available|removed/i.test(body)) return 'project_unavailable';
  if (/conflicting metadata|identifier conflict|does not match target/i.test(`${text} ${body}`)) return 'conflicting_metadata';
  if (diagnostics.body_chars === 0 || (diagnostics.ember_root && !diagnostics.detail_root)) return 'empty_detail_shell';
  if (/timeout|timed out/i.test(text)) return 'detail_timeout';
  if (diagnostics.api_observed && !diagnostics.api_matched) return 'detail_api_missing';
  return 'missing_required_title';
}

function retryDelayMs(attempt, code) {
  const slow = code === 'rate_limited' || code === 'portal_error_page';
  if (attempt <= 1) return slow ? 2 * 60 * 60 * 1000 : 15 * 60 * 1000;
  if (attempt === 2) return slow ? 12 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
  return null;
}

function safeMetadataPatch(existing, recovered) {
  const patch = {};
  const confidence = recovered.extraction_confidence ?? 'low';
  const authoritative = confidence === 'authoritative' || confidence === 'high';
  const fields = ['raw_title', 'bid_due_at', 'agency', 'county', 'project_address', 'scope_text', 'portal_bid_id', 'portal_department'];
  for (const field of fields) {
    const next = recovered[field];
    if (next === null || next === undefined || (typeof next === 'string' && !next.trim())) continue;
    const current = existing[field];
    if (current === null || current === undefined || current === '' || authoritative) patch[field] = next;
  }
  return patch;
}

module.exports = {
  RETRYABLE_CODES,
  TERMINAL_CODES,
  classifyFailure,
  extractExactApiMetadata,
  retryDelayMs,
  safeMetadataPatch,
};
