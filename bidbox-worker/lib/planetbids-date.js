'use strict';

const PLANETBIDS_TIME_ZONE = 'America/Los_Angeles';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANETBIDS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function failure(input, errorCode, format = null, localComponents = null) {
  return {
    ok: false,
    value: null,
    input,
    format,
    source_timezone: null,
    classification: 'parse_failure',
    error_code: errorCode,
    local_components: localComponents,
  };
}

function formattedParts(epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function offsetMinutesAt(epochMs) {
  const truncated = Math.floor(epochMs / 1000) * 1000;
  const parts = formattedParts(truncated);
  return Math.round((Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ) - truncated) / 60_000);
}

function sameLocalParts(actual, expected) {
  return actual.year === expected.year && actual.month === expected.month && actual.day === expected.day &&
    actual.hour === expected.hour && actual.minute === expected.minute && actual.second === expected.second;
}

function validateComponents(components) {
  if (!Number.isInteger(components.year) || components.year < 1900 || components.year > 2200) return false;
  if (!Number.isInteger(components.month) || components.month < 1 || components.month > 12) return false;
  if (!Number.isInteger(components.day) || components.day < 1 || components.day > 31) return false;
  if (!Number.isInteger(components.hour) || components.hour < 0 || components.hour > 23) return false;
  if (!Number.isInteger(components.minute) || components.minute < 0 || components.minute > 59) return false;
  if (!Number.isInteger(components.second) || components.second < 0 || components.second > 59) return false;
  const check = new Date(Date.UTC(components.year, components.month - 1, components.day));
  return check.getUTCFullYear() === components.year && check.getUTCMonth() === components.month - 1 && check.getUTCDate() === components.day;
}

function pacificInstantsForLocal(components) {
  const localEpoch = Date.UTC(
    components.year,
    components.month - 1,
    components.day,
    components.hour,
    components.minute,
    components.second,
    components.millisecond,
  );
  const offsets = new Set();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetMinutesAt(localEpoch + hours * 3_600_000));
  }
  const matches = [];
  for (const offset of offsets) {
    const candidate = localEpoch - offset * 60_000;
    if (sameLocalParts(formattedParts(candidate), components)) matches.push(candidate);
  }
  return [...new Set(matches)].sort((a, b) => a - b);
}

function parseNaiveComponents(text) {
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/);
  if (iso) {
    return {
      format: 'iso_local',
      components: {
        year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]),
        hour: Number(iso[4]), minute: Number(iso[5]), second: Number(iso[6] ?? 0),
        millisecond: Number(String(iso[7] ?? '').padEnd(3, '0').slice(0, 3) || 0),
      },
    };
  }
  const us12 = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)(?:\s*\(?\s*(PST|PDT|PT)\s*\)?)?$/i);
  if (us12) {
    let hour = Number(us12[4]);
    if (hour < 1 || hour > 12) return null;
    if (/PM/i.test(us12[7]) && hour !== 12) hour += 12;
    if (/AM/i.test(us12[7]) && hour === 12) hour = 0;
    return {
      format: 'us_12h_local',
      zoneToken: us12[8]?.toUpperCase() ?? null,
      components: {
        year: Number(us12[3]), month: Number(us12[1]), day: Number(us12[2]),
        hour, minute: Number(us12[5] ?? 0), second: Number(us12[6] ?? 0), millisecond: 0,
      },
    };
  }
  const us24 = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (us24) {
    return {
      format: 'us_24h_local',
      components: {
        year: Number(us24[3]), month: Number(us24[1]), day: Number(us24[2]),
        hour: Number(us24[4]), minute: Number(us24[5]), second: Number(us24[6] ?? 0), millisecond: 0,
      },
    };
  }
  return null;
}

function parsePlanetBidsDate(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return failure(raw ?? null, 'empty_input');
  const text = String(raw).replace(/\s+/g, ' ').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) {
    return failure(text, 'date_only_time_missing', 'date_only');
  }

  const explicitIso = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})$/i);
  if (explicitIso) {
    const components = {
      year: Number(explicitIso[1]), month: Number(explicitIso[2]), day: Number(explicitIso[3]),
      hour: Number(explicitIso[4]), minute: Number(explicitIso[5]), second: Number(explicitIso[6] ?? 0),
      millisecond: Number(String(explicitIso[7] ?? '').padEnd(3, '0').slice(0, 3) || 0),
    };
    if (!validateComponents(components)) return failure(text, 'invalid_explicit_timestamp', 'iso_explicit', components);
    const normalized = text.includes(' ') ? text.replace(' ', 'T') : text;
    const epochMs = Date.parse(normalized);
    if (!Number.isFinite(epochMs)) return failure(text, 'invalid_explicit_timestamp', 'iso_explicit');
    return {
      ok: true,
      value: new Date(epochMs).toISOString(),
      input: text,
      format: 'iso_explicit',
      source_timezone: explicitIso[8],
      classification: 'parsed_explicit_timezone',
      error_code: null,
      local_components: components,
    };
  }

  const parsed = parseNaiveComponents(text);
  if (!parsed || !validateComponents(parsed.components)) return failure(text, 'invalid_or_unsupported_format');

  if (parsed.zoneToken === 'PST' || parsed.zoneToken === 'PDT') {
    const offset = parsed.zoneToken === 'PST' ? '-08:00' : '-07:00';
    const c = parsed.components;
    const iso = `${String(c.year).padStart(4, '0')}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}T${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}:${String(c.second).padStart(2, '0')}${offset}`;
    const epochMs = Date.parse(iso);
    if (!Number.isFinite(epochMs)) return failure(text, 'invalid_explicit_timestamp', parsed.format, c);
    return {
      ok: true,
      value: new Date(epochMs).toISOString(),
      input: text,
      format: `${parsed.format}_explicit_${parsed.zoneToken.toLowerCase()}`,
      source_timezone: parsed.zoneToken,
      classification: 'parsed_explicit_timezone',
      error_code: null,
      local_components: c,
    };
  }

  const matches = pacificInstantsForLocal(parsed.components);
  if (matches.length === 0) return failure(text, 'nonexistent_local_time', parsed.format, parsed.components);
  if (matches.length > 1) return failure(text, 'ambiguous_local_time', parsed.format, parsed.components);
  return {
    ok: true,
    value: new Date(matches[0]).toISOString(),
    input: text,
    format: parsed.format,
    source_timezone: PLANETBIDS_TIME_ZONE,
    classification: 'parsed_pacific_local',
    error_code: null,
    local_components: parsed.components,
  };
}

function parseBidDueDate(raw) {
  return parsePlanetBidsDate(raw).value;
}

module.exports = {
  PLANETBIDS_TIME_ZONE,
  parseBidDueDate,
  parsePlanetBidsDate,
};
