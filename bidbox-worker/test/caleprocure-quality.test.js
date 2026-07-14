'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseBestEventTitle,
  classifyCalEprocureRelevance,
  isPlaceholderEventTitle,
  normalizeEventTitle,
  shouldPreserveExistingTitle,
} = require('../lib/caleprocure-quality');
const { buildCandidateFromDetail } = require('../drivers/caleprocure');
const { composeRawTitle, retryDelayMs, MAX_ATTEMPTS } = require('../drivers/caleprocure_title_recovery');

// ---------------------------------------------------------------------------
// Relevance classification
// ---------------------------------------------------------------------------

const classify = (title, description = '') => classifyCalEprocureRelevance({ title, description });

test('clothing/linen services excluded', () => {
  const result = classify('0000039476 - Shop Clothing Linen Services - Williams',
    'CHP Williams Area office Shop Clothing and Linen services');
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.category, 'clothing_linen');
  assert.match(result.reason, /Non-public-works procurement/);
});

test('physical exams excluded', () => {
  const result = classify('0000039654 - CCC Ventura Training Center: Pre-Enrollment Physicals',
    'provide physical examinations for Corpsmember Trainees');
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.category, 'medical_services');
});

test('title/escrow excluded', () => {
  const result = classify('01A6643 - IFB Multi-provider Title and Escrow in Lake and Mendocino Counties',
    'Contractor agrees to provide Title and Escrow services');
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.category, 'real_estate_transactional');
});

test('pure software/system maintenance excluded (concatenated title normalized)', () => {
  const result = classify('0000039622 - 25-305722.FMD.AVSystemMaintenance',
    'AV Equipment Maintenance Services for MayLee Office Complex');
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.category, 'software_it');
});

test('asset-data-only services excluded even when the description names highways', () => {
  const result = classify('56A0887 - Asset Data Collection-North',
    'develop an inventory and geodatabase of all traffic safety and control devices on the State Highway System');
  assert.equal(result.verdict, 'excluded');
  assert.equal(result.category, 'asset_data_collection');
});

test('janitorial excluded, generic-word construction retained', () => {
  assert.equal(classify('Janitorial Services for District Office').verdict, 'excluded');
  // Generic words alone (system/maintenance/installation/repair/services/
  // equipment) never exclude without a matching category.
  assert.equal(classify('Equipment Installation and Repair Services for Building Systems').verdict, 'retain');
});

test('legitimate construction system installation retained', () => {
  const result = classify('Fire Sprinkler System Installation, Building #509');
  assert.equal(result.verdict, 'retain');
});

test('HVAC construction retained', () => {
  assert.equal(classify('HVAC Replacement — District Office').verdict, 'retain');
  assert.equal(classify('25-287739.FMD.ChillerMaintenance', 'Chiller Maintenance and Repair Services').verdict, 'retain');
});

test('physical infrastructure maintenance retained', () => {
  assert.equal(classify('Elevator Maintenance and Repair Service').verdict, 'retain');
  assert.equal(classify('25-322011.PMDB.Window Systems Repair').verdict, 'retain');
  assert.equal(classify('Exposition Park Site Utilities Replacement').verdict, 'retain');
});

test('construction evidence in title wins over category words in description', () => {
  const result = classify('Synthetic Turf Installation', 'includes laundry room adjacent to field house');
  assert.equal(result.verdict, 'retain');
});

test('ambiguous records fail safely into retain (review), never excluded', () => {
  assert.equal(classify('0000039717 - P26-0038 Yellow Panel Traps (Fresno)').verdict, 'retain');
  assert.equal(classify('').verdict, 'retain');
  assert.equal(classify(null, null).verdict, 'retain');
});

test('exclusion reason and category are machine-readable', () => {
  const result = classify('Shop Clothing Linen Services');
  assert.equal(result.verdict, 'excluded');
  assert.ok(result.category);
  assert.ok(result.reason.startsWith('Non-public-works procurement:'));
  assert.ok(result.evidence);
});

// ---------------------------------------------------------------------------
// Title validity
// ---------------------------------------------------------------------------

test('[Event Title] rejected in all forms', () => {
  assert.equal(isPlaceholderEventTitle('[Event Title]'), true);
  assert.equal(isPlaceholderEventTitle('Event Title'), true);
  assert.equal(isPlaceholderEventTitle('[Title]'), true);
  assert.equal(isPlaceholderEventTitle('0000039519 - [Event Title]', '0000039519'), true);
});

test('empty and boilerplate titles rejected', () => {
  assert.equal(isPlaceholderEventTitle(''), true);
  assert.equal(isPlaceholderEventTitle('   '), true);
  assert.equal(isPlaceholderEventTitle(null), true);
  assert.equal(isPlaceholderEventTitle('Event Details'), true);
});

test('event-ID-only title rejected', () => {
  assert.equal(isPlaceholderEventTitle('0000039519', '0000039519'), true);
  assert.equal(isPlaceholderEventTitle('0000039519 - ', '0000039519'), true);
});

test('real titles accepted', () => {
  assert.equal(isPlaceholderEventTitle('C5613245-D, Rebid 1 Synthetic Turf Installation', '0000039519'), false);
  assert.equal(isPlaceholderEventTitle('0000039519 - C5613245-D, Rebid 1 Synthetic Turf Installation', '0000039519'), false);
});

test('valid detail heading preferred over listing', () => {
  const chosen = chooseBestEventTitle([
    { value: 'Detail Heading Title', source: 'detail_event_name' },
    { value: 'Listing Title', source: 'listing_row' },
  ], 'E1');
  assert.deepEqual(chosen, { title: 'Detail Heading Title', source: 'detail_event_name' });
});

test('placeholder detail falls back to valid listing title', () => {
  const chosen = chooseBestEventTitle([
    { value: '[Event Title]', source: 'detail_event_name' },
    { value: 'Real Listing Title', source: 'listing_row' },
  ], 'E1');
  assert.deepEqual(chosen, { title: 'Real Listing Title', source: 'listing_row' });
});

test('HTML entities and whitespace normalized', () => {
  assert.equal(normalizeEventTitle('Roofing &amp; Waterproofing &#39;Phase 2&#39;   Rebid'), "Roofing & Waterproofing 'Phase 2' Rebid");
  const chosen = chooseBestEventTitle([{ value: '  Paving &amp; Grading  ', source: 'detail_event_name' }], 'E1');
  assert.equal(chosen.title, 'Paving & Grading');
});

test('valid stored title is not overwritten by an incoming placeholder', () => {
  const existing = { raw_title: '0000039519 - C5613245-D, Rebid 1 Synthetic Turf Installation', portal_bid_id: '0000039519' };
  assert.equal(shouldPreserveExistingTitle(existing, { raw_title: '0000039519 - [Event Title]', portal_bid_id: '0000039519' }), true);
  // A better incoming title is allowed through.
  assert.equal(shouldPreserveExistingTitle(existing, { raw_title: '0000039519 - Updated Real Title', portal_bid_id: '0000039519' }), false);
  // A placeholder existing title never blocks an incoming valid one.
  assert.equal(shouldPreserveExistingTitle({ raw_title: '[Event Title]', portal_bid_id: '0000039519' }, { raw_title: '0000039519 - Real', portal_bid_id: '0000039519' }), false);
});

test('buildCandidateFromDetail flags unhydrated placeholder for recovery', () => {
  const candidate = buildCandidateFromDetail({
    listingUrl: 'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx',
    row: { eventId: '0000039519', title: null, department: null },
    target: { sourceUrl: 'https://caleprocure.ca.gov/event/0000/0000039519', eventId: '0000039519', businessUnit: '0000' },
    detail: { eventId: '0000039519', title: '[Event Title]', pageTitle: 'Event Details' },
  });
  assert.equal(candidate.raw_title, '0000039519 - [Event Title]');
  assert.equal(candidate.crawl_data.title_quality, 'placeholder');
  assert.equal(candidate.crawl_data.title_recovery_required, true);
});

test('buildCandidateFromDetail records a hydrated detail title as valid', () => {
  const candidate = buildCandidateFromDetail({
    listingUrl: 'https://caleprocure.ca.gov/pages/Events-BS3/event-search.aspx',
    row: { eventId: '0000039519', title: '[Event Title]', department: null },
    target: { sourceUrl: 'https://caleprocure.ca.gov/event/0000/0000039519', eventId: '0000039519', businessUnit: '0000' },
    detail: { eventId: '0000039519', title: 'C5613245-D, Rebid 1 Synthetic Turf Installation', pageTitle: 'Event Details' },
  });
  assert.equal(candidate.raw_title, '0000039519 - C5613245-D, Rebid 1 Synthetic Turf Installation');
  assert.equal(candidate.crawl_data.title_quality, 'valid');
  assert.equal(candidate.crawl_data.title_recovery_required, false);
  assert.equal(candidate.crawl_data.title_source, 'detail_event_name');
});

// ---------------------------------------------------------------------------
// Recovery mechanics (pure parts)
// ---------------------------------------------------------------------------

test('event 0000039519 resolves to the synthetic-turf title', () => {
  const chosen = chooseBestEventTitle([
    { value: 'C5613245-D, Rebid 1 Synthetic Turf Installation', source: 'detail_event_name' },
  ], '0000039519');
  assert.equal(composeRawTitle('0000039519', chosen.title), '0000039519 - C5613245-D, Rebid 1 Synthetic Turf Installation');
});

test('retry count bounded with backoff, then exhausted', () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(retryDelayMs(1), 15 * 60 * 1000);
  assert.equal(retryDelayMs(2), 2 * 60 * 60 * 1000);
  assert.equal(retryDelayMs(3), null);
});
