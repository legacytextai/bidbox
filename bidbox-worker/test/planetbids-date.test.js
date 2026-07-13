'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseBidDueDate, parsePlanetBidsDate, PLANETBIDS_TIME_ZONE } = require('../lib/planetbids-date');
const { parseBidDueDate: parseNormalScanDueDate } = require('../drivers/planetbids');
const { parseRecoveredDueDate } = require('../drivers/planetbids_recovery');
const { safeMetadataPatch } = require('../lib/planetbids-recovery');

test('timezone-naive summer API timestamp is interpreted in Pacific time', () => {
  const result = parsePlanetBidsDate('2025-04-24T18:00:00');
  assert.equal(result.value, '2025-04-25T01:00:00.000Z');
  assert.equal(result.source_timezone, PLANETBIDS_TIME_ZONE);
  assert.equal(result.classification, 'parsed_pacific_local');
});

test('timezone-naive winter API timestamp is interpreted in Pacific time', () => {
  assert.equal(parseBidDueDate('2025-12-22T14:00:00'), '2025-12-22T22:00:00.000Z');
});

test('another summer timestamp crosses midnight UTC', () => {
  assert.equal(parseBidDueDate('2025-07-22 17:00'), '2025-07-23T00:00:00.000Z');
});

test('another winter timestamp remains on the same UTC date', () => {
  assert.equal(parseBidDueDate('2024-11-21 11:00'), '2024-11-21T19:00:00.000Z');
});

test('explicit Z timezone is respected', () => {
  const result = parsePlanetBidsDate('2025-04-25T01:00:00Z');
  assert.equal(result.value, '2025-04-25T01:00:00.000Z');
  assert.equal(result.classification, 'parsed_explicit_timezone');
});

test('explicit negative seven hour offset is respected', () => {
  assert.equal(parseBidDueDate('2025-04-24T18:00:00-07:00'), '2025-04-25T01:00:00.000Z');
});

test('explicit negative eight hour offset is respected', () => {
  assert.equal(parseBidDueDate('2025-12-22T14:00:00-08:00'), '2025-12-22T22:00:00.000Z');
});

test('date-only input is rejected because a bid due time is required', () => {
  const result = parsePlanetBidsDate('2025-04-24');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'date_only_time_missing');
});

test('invalid input returns a machine-readable failure', () => {
  const result = parsePlanetBidsDate('not a real date');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'invalid_or_unsupported_format');
});

test('invalid explicit calendar date is not normalized by JavaScript', () => {
  const result = parsePlanetBidsDate('2025-02-30T12:00:00Z');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'invalid_explicit_timestamp');
});

test('empty input returns a machine-readable failure', () => {
  const result = parsePlanetBidsDate('  ');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'empty_input');
});

test('nonexistent Pacific spring-forward time is rejected', () => {
  const result = parsePlanetBidsDate('2025-03-09 02:30');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'nonexistent_local_time');
});

test('ambiguous Pacific fall-back time is rejected', () => {
  const result = parsePlanetBidsDate('2025-11-02 01:30');
  assert.equal(result.value, null);
  assert.equal(result.error_code, 'ambiguous_local_time');
});

test('slash-formatted DOM timestamp without zone uses Pacific time', () => {
  assert.equal(parseBidDueDate('04/24/2025 6:00 PM'), '2025-04-25T01:00:00.000Z');
});

test('explicit PST and PDT abbreviations are respected', () => {
  assert.equal(parseBidDueDate('12/22/2025 2:00 PM PST'), '2025-12-22T22:00:00.000Z');
  assert.equal(parseBidDueDate('04/24/2025 6:00 PM PDT'), '2025-04-25T01:00:00.000Z');
});

test('recovery API normalization uses the centralized parser', () => {
  const result = parseRecoveredDueDate('2025-04-24T18:00:00');
  assert.equal(result.value, '2025-04-25T01:00:00.000Z');
  assert.equal(result.source_timezone, PLANETBIDS_TIME_ZONE);
});

test('normal PlanetBids scan uses the centralized parser', () => {
  assert.equal(parseNormalScanDueDate('2025-12-22T14:00:00'), '2025-12-22T22:00:00.000Z');
});

test('failed parsing cannot overwrite an existing good due date', () => {
  const parsed = parsePlanetBidsDate('invalid');
  const patch = safeMetadataPatch(
    { raw_title: 'Good title', bid_due_at: '2026-07-20T17:00:00.000Z' },
    { raw_title: null, bid_due_at: parsed.value, extraction_confidence: 'authoritative' },
  );
  assert.deepEqual(patch, {});
});
