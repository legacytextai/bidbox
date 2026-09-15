// Shared pursuit status vocabulary + color language.
// Reviewing = gray, Pursuing = green, Passed = red, Submitted = blue.

export type PursuitStatusKey = "reviewing" | "pursuing" | "passed" | "submitted";

export const PURSUIT_STATUSES: PursuitStatusKey[] = [
  "reviewing",
  "pursuing",
  "passed",
  "submitted",
];

export const PURSUIT_STATUS_LABELS: Record<PursuitStatusKey, string> = {
  reviewing: "Reviewing",
  pursuing: "Pursuing",
  passed: "Passed",
  submitted: "Submitted",
};

/** Badge / control tint */
export const PURSUIT_STATUS_STYLES: Record<PursuitStatusKey, string> = {
  reviewing: "bg-gray-500/10 text-gray-600",
  pursuing: "bg-green-500/10 text-green-600",
  passed: "bg-red-500/10 text-red-600",
  submitted: "bg-blue-500/10 text-blue-600",
};

/** Tab label colors — active (text + underline) and inactive (muted tint) */
export const PURSUIT_TAB_ACTIVE_CLASSES: Record<PursuitStatusKey, string> = {
  reviewing: "border-gray-500 text-gray-600",
  pursuing: "border-green-600 text-green-600",
  passed: "border-red-600 text-red-600",
  submitted: "border-blue-600 text-blue-600",
};

export const PURSUIT_TAB_INACTIVE_CLASSES: Record<PursuitStatusKey, string> = {
  reviewing: "border-transparent text-gray-600/60 hover:text-gray-600",
  pursuing: "border-transparent text-green-600/60 hover:text-green-600",
  passed: "border-transparent text-red-600/60 hover:text-red-600",
  submitted: "border-transparent text-blue-600/60 hover:text-blue-600",
};

export function normalizePursuitStatus(value: string | null | undefined): PursuitStatusKey {
  return value && (value as PursuitStatusKey) in PURSUIT_STATUS_LABELS
    ? (value as PursuitStatusKey)
    : "reviewing";
}
