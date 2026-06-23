import { fromZonedTime, toZonedTime, format as formatTz } from 'date-fns-tz';

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST/AKDT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
];

// Convert local datetime input + timezone → UTC for storage
export function localDateTimeToUtc(localDateTime: string, timezone: string): string {
  return fromZonedTime(localDateTime, timezone).toISOString();
}

// Convert UTC from DB → local datetime for input display
export function utcToLocalDateTime(utcString: string, timezone: string): string {
  const zonedDate = toZonedTime(new Date(utcString), timezone);
  return formatTz(zonedDate, "yyyy-MM-dd'T'HH:mm", { timeZone: timezone });
}

// Format UTC date for display using project's timezone
export function formatInProjectTimezone(utcString: string, timezone: string, formatStr: string): string {
  const zonedDate = toZonedTime(new Date(utcString), timezone);
  return formatTz(zonedDate, formatStr, { timeZone: timezone });
}

export const DEFAULT_PROJECT_TIMEZONE = 'America/Los_Angeles';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SLASH_DATE_TIME_RE =
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*(?:\(?\s*(PDT|PST|PT)\s*\)?)?/i;
const ISO_LIKE_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;

function timezoneAbbrForDate(year: number, month: number, day: number, timezone: string) {
  try {
    const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    return formatInProjectTimezone(noonUtc.toISOString(), timezone, 'zzz');
  } catch {
    return timezone === DEFAULT_PROJECT_TIMEZONE ? 'PT' : '';
  }
}

function formatWallClockDateTime({
  year,
  month,
  day,
  hour,
  minute,
  timezone,
  timezoneAbbr,
}: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timezone: string;
  timezoneAbbr?: string | null;
}) {
  const h12 = hour % 12 || 12;
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  const tzLabel =
    timezoneAbbr && timezoneAbbr.toUpperCase() !== 'PT'
      ? timezoneAbbr.toUpperCase()
      : timezoneAbbrForDate(year, month, day, timezone);

  return `${MONTH_NAMES[month - 1]} ${day}, ${year} at ${h12}:${String(minute).padStart(2, '0')} ${meridiem}${tzLabel ? ` ${tzLabel}` : ''}`;
}

function normalizeHour(hour12: string, meridiem: string) {
  let hour = Number(hour12);
  if (!Number.isFinite(hour)) return null;
  const upper = meridiem.toUpperCase();
  if (upper === 'PM' && hour !== 12) hour += 12;
  if (upper === 'AM' && hour === 12) hour = 0;
  return hour;
}

export function formatProjectDateTime(
  value: string | Date | null | undefined,
  options: {
    timezone?: string | null;
    fallback?: string;
  } = {},
) {
  const timezone = options.timezone || DEFAULT_PROJECT_TIMEZONE;
  const fallback = options.fallback ?? '—';
  if (!value) return fallback;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fallback;
    return formatInProjectTimezone(value.toISOString(), timezone, "MMMM d, yyyy 'at' h:mm a zzz");
  }

  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text) return fallback;

  const slashMatch = text.match(SLASH_DATE_TIME_RE);
  if (slashMatch) {
    const [, monthText, dayText, yearText, hourText, minuteText = '0', meridiem, sourceTz] = slashMatch;
    const hour = normalizeHour(hourText, meridiem);
    if (hour !== null) {
      return formatWallClockDateTime({
        year: Number(yearText),
        month: Number(monthText),
        day: Number(dayText),
        hour,
        minute: Number(minuteText),
        timezone,
        timezoneAbbr: sourceTz,
      });
    }
  }

  if (ISO_LIKE_RE.test(text)) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return formatInProjectTimezone(date.toISOString(), timezone, "MMMM d, yyyy 'at' h:mm a zzz");
    }
  }

  const genericDate = new Date(text);
  if (!Number.isNaN(genericDate.getTime()) && /\d/.test(text)) {
    return formatInProjectTimezone(genericDate.toISOString(), timezone, "MMMM d, yyyy 'at' h:mm a zzz");
  }

  return text.replace(/\s+UTC\b/i, ` ${timezoneAbbrForDate(new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate(), timezone)}`);
}

export function formatProjectDateTimeOrNull(
  value: string | Date | null | undefined,
  options: Omit<Parameters<typeof formatProjectDateTime>[1], 'fallback'> = {},
) {
  if (!value) return null;
  const formatted = formatProjectDateTime(value, { ...options, fallback: '' });
  return formatted || null;
}
