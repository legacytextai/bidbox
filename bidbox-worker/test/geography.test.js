'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agencyRegistryFromRows, classifyGeographyMatch, extractDocumentGeographyEvidence, geographyShadowFields, resolveCandidateGeography } = require('../lib/geography');

test('project-specific location overrides agency jurisdiction', () => {
  const result = resolveCandidateGeography({ agency:'LA Metro', project_address:'100 Main St, Riverside, CA', portal_type:'planetbids', crawl_data:{} });
  assert.deepEqual(result.counties.map((county) => county.name), ['Riverside']);
  assert.equal(result.primary_source, 'project_address');
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'confirmed_match');
});

test('fixed LA sources classify outside Riverside even without project metadata', () => {
  const result = resolveCandidateGeography({ agency:'Port of Long Beach', crawl_data:{} });
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'confirmed_outside');
});

test('OpenGov buyer address is not mistaken for a project site', () => {
  const result = resolveCandidateGeography({ portal_type:'opengov', project_address:'Riverside, CA', agency:'California Department of General Services', crawl_data:{} });
  assert.equal(result.status, 'unresolved');
});

test('multiple structured service-area counties are retained', () => {
  const result = resolveCandidateGeography({ portal_type:'caleprocure', crawl_data:{ service_areas:['Riverside County', 'San Bernardino County'] } });
  assert.deepEqual(result.counties.map((county) => county.name), ['Riverside', 'San Bernardino']);
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'confirmed_match');
});

test('contradictory same-priority portal fields produce conflict', () => {
  const result = resolveCandidateGeography({ county:'Riverside', crawl_data:{ counties:['Los Angeles'] } });
  assert.equal(result.status, 'conflict');
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'conflict');
});

test('grouped multi-county language retains every named county', () => {
  const result = resolveCandidateGeography({ raw_title:'Services in Riverside, San Bernardino, and Orange Counties', crawl_data:{} });
  assert.deepEqual(result.counties.map((county) => county.name), ['Orange', 'Riverside', 'San Bernardino']);
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'probable_match');
});

test('document evidence requires explicit project-location language', () => {
  assert.deepEqual(extractDocumentGeographyEvidence([{ text:'The agency serves Riverside County.' }]), []);
  const evidence = extractDocumentGeographyEvidence([{ id:'chunk-1', text:'Project location: Riverside County, California.' }]);
  assert.deepEqual(evidence[0].counties, ['Riverside']);
});

test('durable agency-registry rows are compiled into resolver evidence', () => {
  const registry = agencyRegistryFromRows([{ normalized_agency_name:'western transit district', aliases:['wtd'], county_names:['Riverside'], jurisdiction_scope:'fixed', confidence:.99, active:true }]);
  const result = resolveCandidateGeography({ agency:'WTD', crawl_data:{} }, { agencyRegistry:registry });
  assert.equal(classifyGeographyMatch(result, ['Riverside']), 'confirmed_match');
});

test('a county mentioned only as a partner is not treated as project location', () => {
  const result = resolveCandidateGeography({ raw_title:'Statewide educator evaluation', scope_text:'The Kern County Superintendent is a program partner.', agency:'State of California', crawl_data:{} });
  assert.equal(result.status, 'unresolved');
});

test('unapplied shadow schema omits optional geography fields from ingestion', () => {
  const resolution = resolveCandidateGeography({ county:'Riverside', crawl_data:{} });
  assert.deepEqual(geographyShadowFields(resolution, false), {});
});

test('available shadow schema receives resolved geography without changing visibility', () => {
  const resolution = resolveCandidateGeography({ county:'Riverside', crawl_data:{} });
  const fields = geographyShadowFields(resolution, true);
  assert.deepEqual(fields.resolved_county_fips, ['06065']);
  assert.equal(fields.geography_resolution_status, 'confirmed');
  assert.equal(fields.geography_shadow, true);
  assert.ok(fields.geography_resolved_at);
});
