#!/usr/bin/env node
// READ-ONLY audit for Cal eProcure data quality: placeholder titles and
// non-construction relevance. Reports counts and inspects named examples.
// Usage: railway run --service bidbox node bidbox-worker/scripts/caleprocure-quality-audit.js
'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PAGE = 1000;
async function allRows(table, select, configure = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await configure(supabase.from(table).select(select).order('id', { ascending: true })).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

const PLACEHOLDER_PATTERNS = [
  [/\[event title\]/i, 'bracketed_event_title'],
  [/^\s*(\d{10})?\s*-?\s*event title\s*$/i, 'bare_event_title'],
  [/\[title\]/i, 'bracketed_title'],
];

function classifyTitle(raw, eventId) {
  const title = String(raw ?? '').trim();
  if (!title) return 'empty';
  for (const [pattern, label] of PLACEHOLDER_PATTERNS) if (pattern.test(title)) return label;
  const withoutId = eventId ? title.replace(eventId, '').replace(/^[\s-]+|[\s-]+$/g, '') : title;
  if (!withoutId) return 'event_id_only';
  return null;
}

const isOpen = (c) => !c.bid_due_at || new Date(c.bid_due_at).getTime() > Date.now();

async function main() {
  const rows = await allRows(
    'opportunity_candidates',
    'id, portal_bid_id, raw_title, agency, bid_due_at, ingestion_status, status, global_exclusion_code, global_exclusion_reason, county, required_licenses, crawl_data',
    (q) => q.eq('portal_type', 'caleprocure'),
  );
  console.log(`caleprocure candidates: ${rows.length}`);

  // ---- Title audit ----
  const byPattern = {};
  const invalid = [];
  for (const c of rows) {
    const label = classifyTitle(c.raw_title, c.portal_bid_id);
    if (!label) continue;
    byPattern[label] = (byPattern[label] ?? 0) + 1;
    invalid.push({ ...c, __pattern: label });
  }
  const openInvalid = invalid.filter(isOpen);
  const recoverableFromStored = invalid.filter((c) => {
    const stored = String(c.crawl_data?.title ?? '').trim();
    return stored && !classifyTitle(stored, c.portal_bid_id);
  });
  console.log(`\nINVALID TITLES total=${invalid.length} open=${openInvalid.length} closed=${invalid.length - openInvalid.length}`);
  console.log('by pattern:', byPattern);
  console.log(`recoverable from stored crawl_data.title: ${recoverableFromStored.length} (require browser revisit: ${invalid.length - recoverableFromStored.length})`);
  console.log('\nOPEN INVALID-TITLE RECORDS:');
  for (const c of openInvalid) {
    console.log(`  ${c.id} | event=${c.portal_bid_id} | "${c.raw_title}" | crawl.title="${c.crawl_data?.title ?? ''}" | ${c.agency} | excl=${c.global_exclusion_code ?? '-'}`);
  }

  // ---- Event 0000039519 ----
  const target = rows.find((c) => String(c.portal_bid_id).includes('0000039519'));
  console.log('\nEVENT 0000039519:', target ? JSON.stringify({
    id: target.id, title: target.raw_title, agency: target.agency, status: target.status,
    ingestion: target.ingestion_status, excl: target.global_exclusion_code,
    crawl_title: target.crawl_data?.title, unspsc: target.crawl_data?.unspsc, desc: String(target.crawl_data?.description ?? '').slice(0, 200),
  }, null, 1) : 'NOT FOUND');

  // ---- Relevance examples ----
  const examples = ['0000039476', '0000039654', '01A6643', '56A0887', '0000039622'];
  console.log('\nRELEVANCE EXAMPLES:');
  for (const ev of examples) {
    const c = rows.find((r) => String(r.portal_bid_id).includes(ev) || String(r.raw_title).includes(ev));
    if (!c) { console.log(`  ${ev}: NOT FOUND`); continue; }
    console.log(JSON.stringify({
      event: ev, id: c.id, title: c.raw_title, agency: c.agency,
      unspsc: c.crawl_data?.unspsc ?? null, licenses: c.required_licenses,
      ingestion: c.ingestion_status, excl_code: c.global_exclusion_code, excl_reason: c.global_exclusion_reason,
      desc: String(c.crawl_data?.description ?? '').slice(0, 220),
    }, null, 1));
  }

  // ---- UNSPSC coverage ----
  let withUnspsc = 0;
  const segments = {};
  for (const c of rows) {
    const codes = (c.crawl_data?.unspsc ?? []).map((u) => String(u.code ?? ''));
    if (codes.length) withUnspsc++;
    for (const code of codes) {
      const seg = code.slice(0, 2);
      if (seg) segments[seg] = (segments[seg] ?? 0) + 1;
    }
  }
  console.log(`\nUNSPSC coverage: ${withUnspsc}/${rows.length}; top segments:`, Object.fromEntries(Object.entries(segments).sort((a, b) => b[1] - a[1]).slice(0, 12)));

  // license coverage
  const withLicenses = rows.filter((c) => (c.required_licenses ?? []).length > 0).length;
  console.log(`required_licenses populated: ${withLicenses}/${rows.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
