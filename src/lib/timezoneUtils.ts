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
