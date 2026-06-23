import { fromZonedTime } from "date-fns-tz";
import { DEFAULT_PROJECT_TIMEZONE, formatProjectDateTime } from "@/lib/timezoneUtils";

const SLASH_DATE_TIME_RE =
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i;

const MONTH_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i;

export type AuthoritativeBidDueSource =
  | "portal_metadata"
  | "candidate_metadata"
  | "project_metadata"
  | "f4_fallback";

export interface AuthoritativeBidDueInput {
  dueDateRaw?: string | null;
  candidateBidDueAt?: string | null;
  projectBidDueAt?: string | null;
  f4ValueText?: string | null;
  timezone?: string | null;
}

export interface AuthoritativeBidDueResult {
  display: string;
  source: AuthoritativeBidDueSource | null;
  value: string | null;
  conflict: boolean;
  conflictMessage?: string;
}

function normalizeHour(hour12: string, meridiem: string) {
  let hour = Number(hour12);
  if (!Number.isFinite(hour)) return null;
  const upper = meridiem.toUpperCase();
  if (upper === "PM" && hour !== 12) hour += 12;
  if (upper === "AM" && hour === 12) hour = 0;
  return hour;
}

function parsePacificWallClockRaw(value: string | null | undefined, timezone: string) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const match = text.match(SLASH_DATE_TIME_RE);
  if (!match) return null;

  const [, monthText, dayText, yearText, hourText, minuteText = "0", meridiem] = match;
  const hour = normalizeHour(hourText, meridiem);
  if (hour === null) return null;

  const localDateTime =
    `${yearText}-${monthText.padStart(2, "0")}-${dayText.padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${minuteText.padStart(2, "0")}`;

  return fromZonedTime(localDateTime, timezone).toISOString();
}

export function dateIdentity(value: string | null | undefined) {
  if (!value) return null;
  const text = String(value).replace(/\s+/g, " ").trim();

  const slash = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthName = text.match(MONTH_DATE_RE);
  if (monthName) {
    const month = new Date(`${monthName[1]} 1, 2000`).getMonth() + 1;
    return `${monthName[3]}-${String(month).padStart(2, "0")}-${monthName[2].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

export function resolveAuthoritativeBidDue({
  dueDateRaw,
  candidateBidDueAt,
  projectBidDueAt,
  f4ValueText,
  timezone = DEFAULT_PROJECT_TIMEZONE,
}: AuthoritativeBidDueInput): AuthoritativeBidDueResult {
  const tz = timezone || DEFAULT_PROJECT_TIMEZONE;
  const rawInstant = parsePacificWallClockRaw(dueDateRaw, tz);

  const candidates = [
    { source: "portal_metadata" as const, value: rawInstant || dueDateRaw || null },
    { source: "candidate_metadata" as const, value: candidateBidDueAt || null },
    { source: "project_metadata" as const, value: projectBidDueAt || null },
    { source: "f4_fallback" as const, value: f4ValueText || null },
  ];

  const selected = candidates.find((candidate) => candidate.value);
  const display = selected?.value ? formatProjectDateTime(selected.value, { timezone: tz, fallback: "" }) : "";
  const structuredDate = dateIdentity(rawInstant || dueDateRaw || candidateBidDueAt || projectBidDueAt);
  const f4Date = dateIdentity(f4ValueText);
  const conflict = Boolean(structuredDate && f4Date && structuredDate !== f4Date);
  const conflictMessage = conflict && display
    ? `Conflicting extracted deadline ignored. Structured portal deadline is ${display}.`
    : undefined;

  return {
    display: display || "—",
    source: selected?.source ?? null,
    value: selected?.value ?? null,
    conflict,
    conflictMessage,
  };
}
