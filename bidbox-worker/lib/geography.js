'use strict';

const RESOLVER_VERSION = 'ca-geography-v1';

const COUNTY_FIPS = Object.freeze({
  Alameda:'001', Alpine:'003', Amador:'005', Butte:'007', Calaveras:'009', Colusa:'011', 'Contra Costa':'013', 'Del Norte':'015', 'El Dorado':'017', Fresno:'019', Glenn:'021', Humboldt:'023', Imperial:'025', Inyo:'027', Kern:'029', Kings:'031', Lake:'033', Lassen:'035', 'Los Angeles':'037', Madera:'039', Marin:'041', Mariposa:'043', Mendocino:'045', Merced:'047', Modoc:'049', Mono:'051', Monterey:'053', Napa:'055', Nevada:'057', Orange:'059', Placer:'061', Plumas:'063', Riverside:'065', Sacramento:'067', 'San Benito':'069', 'San Bernardino':'071', 'San Diego':'073', 'San Francisco':'075', 'San Joaquin':'077', 'San Luis Obispo':'079', 'San Mateo':'081', 'Santa Barbara':'083', 'Santa Clara':'085', 'Santa Cruz':'087', Shasta:'089', Sierra:'091', Siskiyou:'093', Solano:'095', Sonoma:'097', Stanislaus:'099', Sutter:'101', Tehama:'103', Trinity:'105', Tulare:'107', Tuolumne:'109', Ventura:'111', Yolo:'113', Yuba:'115',
});

const CITY_COUNTY = Object.freeze({
  alameda:'Alameda', berkeley:'Alameda', fremont:'Alameda', hayward:'Alameda', oakland:'Alameda',
  chico:'Butte', concord:'Contra Costa', richmond:'Contra Costa', antioch:'Contra Costa',
  placerville:'El Dorado', fresno:'Fresno', eureka:'Humboldt', 'el centro':'Imperial', bakersfield:'Kern',
  'long beach':'Los Angeles', 'los angeles':'Los Angeles', norwalk:'Los Angeles', alhambra:'Los Angeles',
  burbank:'Los Angeles', cerritos:'Los Angeles', compton:'Los Angeles', downey:'Los Angeles',
  'el monte':'Los Angeles', glendale:'Los Angeles', inglewood:'Los Angeles', lancaster:'Los Angeles',
  palmdale:'Los Angeles', pasadena:'Los Angeles', pomona:'Los Angeles', 'santa clarita':'Los Angeles',
  'santa monica':'Los Angeles', torrance:'Los Angeles', malibu:'Los Angeles', carson:'Los Angeles',
  madera:'Madera', merced:'Merced', salinas:'Monterey', monterey:'Monterey', napa:'Napa',
  anaheim:'Orange', fullerton:'Orange', irvine:'Orange', 'huntington beach':'Orange', 'costa mesa':'Orange',
  'garden grove':'Orange', orange:'Orange', 'santa ana':'Orange', 'newport beach':'Orange',
  auburn:'Placer', roseville:'Placer', riverside:'Riverside', corona:'Riverside', murrieta:'Riverside',
  temecula:'Riverside', hemet:'Riverside', indio:'Riverside', 'palm springs':'Riverside', perris:'Riverside',
  'moreno valley':'Riverside', blythe:'Riverside', sacramento:'Sacramento',
  'san bernardino':'San Bernardino', fontana:'San Bernardino', ontario:'San Bernardino', victorville:'San Bernardino',
  redlands:'San Bernardino', 'rancho cucamonga':'San Bernardino', carlsbad:'San Diego', 'chula vista':'San Diego',
  escondido:'San Diego', oceanside:'San Diego', 'san diego':'San Diego', 'san francisco':'San Francisco',
  stockton:'San Joaquin', 'san luis obispo':'San Luis Obispo', 'san mateo':'San Mateo',
  'santa barbara':'Santa Barbara', 'san jose':'Santa Clara', 'santa clara':'Santa Clara',
  'santa cruz':'Santa Cruz', redding:'Shasta', vallejo:'Solano', 'santa rosa':'Sonoma',
  modesto:'Stanislaus', visalia:'Tulare', oxnard:'Ventura', ventura:'Ventura', davis:'Yolo', woodland:'Yolo',
});

const DEFAULT_AGENCIES = Object.freeze([
  { pattern:/\b(los angeles county|la county|lacounty)\b/i, counties:['Los Angeles'], scope:'fixed', confidence:0.99 },
  { pattern:/\b(los angeles county metropolitan transportation authority|la metro|lacmta)\b/i, counties:['Los Angeles'], scope:'regional', confidence:0.98 },
  { pattern:/\bport of (los angeles|long beach)\b/i, counties:['Los Angeles'], scope:'fixed', confidence:0.99 },
  { pattern:/\bcity of norwalk\b/i, counties:['Los Angeles'], scope:'fixed', confidence:0.99 },
  { pattern:/\bcity of riverside\b/i, counties:['Riverside'], scope:'fixed', confidence:0.99 },
]);

const SOURCE_PRIORITY = Object.freeze({ portal_county:1, project_address:2, raw_metadata:3, project_text:4, agency_jurisdiction:5, document:6, geocode:7 });

function normalize(value) { return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' '); }
function agencyRegistryFromRows(rows) {
  return (rows ?? []).filter((row) => row.active !== false && row.jurisdiction_scope !== 'statewide').map((row) => {
    const names = [row.normalized_agency_name, ...(row.aliases ?? [])].filter(Boolean)
      .map((name) => String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return {
      pattern:new RegExp(`\\b(?:${names.join('|')})\\b`, 'i'),
      counties:(row.county_names ?? row.counties ?? []).map(canonicalCounty).filter(Boolean),
      scope:row.jurisdiction_scope,
      confidence:Number(row.confidence),
    };
  }).filter((row) => row.counties.length > 0);
}
function canonicalCounty(value) {
  const cleaned = String(value ?? '').trim().replace(/\s+county$/i, '').replace(/\bcounty of\s+/i, '');
  return Object.keys(COUNTY_FIPS).find((county) => normalize(county) === normalize(cleaned)) ?? null;
}
function countyRecord(name) { return { name, fips:`06${COUNTY_FIPS[name]}` }; }
function countyNamesFromValue(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,;|/]+/);
  return [...new Set(values.map(canonicalCounty).filter(Boolean))];
}
function cityCounties(text) {
  const value = normalize(text);
  return [...new Set(Object.entries(CITY_COUNTY)
    .filter(([city]) => new RegExp(`(^|[^a-z])${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(value))
    .map(([, county]) => county))];
}
function addEvidence(list, source, counties, confidence, rawValue, options = {}) {
  if (!counties.length) return;
  list.push({ source, priority:SOURCE_PRIORITY[source], counties:counties.map(countyRecord), confidence, raw_value:rawValue, project_specific:options.projectSpecific !== false, authoritative:Boolean(options.authoritative) });
}

function collectGeographyEvidence(candidate, { agencyRegistry = DEFAULT_AGENCIES, documentEvidence = [], geocodeEvidence = [] } = {}) {
  const evidence = [];
  const crawl = candidate.crawl_data ?? {};
  addEvidence(evidence, 'portal_county', countyNamesFromValue(candidate.county), 1, candidate.county, { authoritative:true });
  addEvidence(evidence, 'portal_county', countyNamesFromValue(crawl.service_areas ?? crawl.counties), .99, crawl.service_areas ?? crawl.counties, { authoritative:true });

  // OpenGov's project_address is commonly the buyer/contact address, not a work site.
  const siteAddress = crawl.project_site_address ?? crawl.project_location ?? crawl.work_location
    ?? (candidate.portal_type !== 'opengov' || crawl.project_address_is_site === true ? candidate.project_address : null);
  addEvidence(evidence, 'project_address', cityCounties(siteAddress), .98, siteAddress, { authoritative:true });

  const rawCounty = crawl.project_county ?? crawl.location_county ?? crawl.county ?? crawl.county_name;
  addEvidence(evidence, 'raw_metadata', countyNamesFromValue(rawCounty), .98, rawCounty, { authoritative:true });
  const rawCity = crawl.project_city ?? crawl.location_city ?? crawl.city;
  addEvidence(evidence, 'raw_metadata', cityCounties(rawCity), .96, rawCity, { authoritative:true });

  const title = String(candidate.raw_title ?? '');
  const body = `${candidate.scope_text ?? ''} ${crawl.description ?? ''}`;
  const text = `${title} ${body}`;
  const countyContext = /\bcount(?:y|ies)\b/i.test(text);
  const allNamedCounties = countyContext
    ? Object.keys(COUNTY_FIPS).filter((county) => new RegExp(`\\b${county.replace(/ /g, '\\s+')}\\b`, 'i').test(text))
    : [];
  // Text inference is probable by default. It becomes confirmed only when the
  // county occurs in explicit project-site language rather than an agency name.
  const explicitLocation = /\b(?:project (?:site|location)|work (?:is )?(?:located|performed)|located|site address|job site)\b[\s\S]{0,160}\bcount(?:y|ies)\b/i.test(text)
    || /\b\d{2,6}\s+[a-z0-9 .'-]+,\s*[a-z .'-]+,?\s+(?:[a-z ]+\s+)?count(?:y|ies)\b/i.test(text);
  const titleCounties = /\bcount(?:y|ies)\b/i.test(title)
    ? allNamedCounties.filter((county) => new RegExp(`\\b${county.replace(/ /g, '\\s+')}\\b`, 'i').test(title))
    : [];
  const explicitCounties = explicitLocation ? allNamedCounties : titleCounties;
  addEvidence(evidence, 'project_text', explicitCounties, explicitLocation ? .97 : .92, text);
  if (!explicitCounties.length) addEvidence(evidence, 'project_text', cityCounties(candidate.raw_title), .9, candidate.raw_title);

  const agencyText = `${candidate.agency ?? ''} ${crawl.agency_name ?? ''} ${crawl.organization ?? ''}`;
  for (const entry of agencyRegistry) {
    if (entry.pattern.test(agencyText)) addEvidence(evidence, 'agency_jurisdiction', entry.counties, entry.confidence, agencyText, { projectSpecific:false, authoritative:entry.scope === 'fixed' });
  }
  // City agencies are a probable jurisdiction signal, never a substitute for a project location.
  const cityAgency = agencyText.match(/\b(?:city|town) of ([a-z .'-]+)/i)?.[1];
  if (cityAgency) addEvidence(evidence, 'agency_jurisdiction', cityCounties(cityAgency), .9, agencyText, { projectSpecific:false });
  const namedAgencyCounties = Object.keys(COUNTY_FIPS).filter((county) =>
    new RegExp(`\\b(?:county of\\s+${county.replace(/ /g, '\\s+')}|${county.replace(/ /g, '\\s+')}\\s+county)\\b`, 'i').test(agencyText));
  addEvidence(evidence, 'agency_jurisdiction', namedAgencyCounties, .9, agencyText, { projectSpecific:false });
  for (const item of documentEvidence) addEvidence(evidence, 'document', countyNamesFromValue(item.counties), item.confidence ?? .9, item.raw_value ?? item.counties);
  for (const item of geocodeEvidence) addEvidence(evidence, 'geocode', countyNamesFromValue(item.counties), item.confidence ?? .95, item.raw_value ?? item.counties, { authoritative:Boolean(item.authoritative) });
  return evidence.sort((a, b) => a.priority - b.priority || b.confidence - a.confidence);
}

function extractDocumentGeographyEvidence(chunks) {
  const results = [];
  for (const chunk of chunks ?? []) {
    const text = String(chunk.text ?? '');
    if (!/\b(?:project (?:site|location)|location of (?:the )?work|work (?:is )?(?:located|performed)|job site|site address)\b/i.test(text)) continue;
    const counties = Object.keys(COUNTY_FIPS).filter((county) => new RegExp(`\\b${county.replace(/ /g, '\\s+')}\\s+count(?:y|ies)\\b`, 'i').test(text));
    if (counties.length) results.push({ counties, confidence:.96, raw_value:text.slice(0, 1000), chunk_id:chunk.id ?? null });
  }
  return results;
}

function resolveCandidateGeography(candidate, options = {}) {
  const evidence = collectGeographyEvidence(candidate, options);
  if (!evidence.length) return { version:RESOLVER_VERSION, status:'unresolved', confidence:0, counties:[], primary_source:null, evidence };
  const projectEvidence = evidence.filter((item) => item.project_specific);
  const pool = projectEvidence.length ? projectEvidence : evidence;
  const bestPriority = Math.min(...pool.map((item) => item.priority));
  const leading = pool.filter((item) => item.priority === bestPriority);
  const countySets = [...new Set(leading.map((item) => item.counties.map((county) => county.fips).sort().join(',')))];
  if (countySets.length > 1) return { version:RESOLVER_VERSION, status:'conflict', confidence:Math.max(...leading.map((item) => item.confidence)), counties:[], primary_source:leading[0].source, evidence };
  const counties = leading[0].counties;
  const confidence = Math.max(...leading.map((item) => item.confidence));
  return { version:RESOLVER_VERSION, status:confidence >= .95 ? 'confirmed' : 'probable', confidence, counties, primary_source:leading[0].source, evidence };
}

function classifyGeographyMatch(resolution, targetCounties) {
  if (resolution.status === 'conflict') return 'conflict';
  if (resolution.status === 'unresolved' || !resolution.counties.length) return 'unresolved';
  const targets = new Set((targetCounties ?? []).map(canonicalCounty).filter(Boolean));
  const matches = resolution.counties.some((county) => targets.has(county.name));
  return `${resolution.status}_${matches ? 'match' : 'outside'}`;
}

// Shadow geography is additive and must never become a hard dependency of the
// shared candidate-ingestion path. Deployments can briefly lead migrations,
// and production may intentionally leave the shadow model unapplied while the
// feature is disabled. In either case, omit every shadow-only field.
function geographyShadowFields(resolution, schemaAvailable) {
  if (!schemaAvailable) return {};
  return {
    resolved_county_fips: resolution.counties.map((county) => county.fips),
    geography_resolution_status: resolution.status,
    geography_confidence: resolution.confidence,
    geography_primary_source: resolution.primary_source,
    geography_resolution_version: resolution.version,
    geography_resolved_at: new Date().toISOString(),
    geography_shadow: true,
  };
}

module.exports = { CITY_COUNTY, COUNTY_FIPS, DEFAULT_AGENCIES, RESOLVER_VERSION, agencyRegistryFromRows, canonicalCounty, classifyGeographyMatch, collectGeographyEvidence, extractDocumentGeographyEvidence, geographyShadowFields, resolveCandidateGeography };
