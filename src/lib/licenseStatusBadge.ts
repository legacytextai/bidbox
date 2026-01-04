/**
 * Utility function to get consistent badge styling for license statuses
 * Rules:
 * - Active (CLEAR, ACTIVE) = Green (success)
 * - Expired = Red (destructive)
 * - Unknown/Other = Grey (secondary)
 */
export function getLicenseStatusBadge(status: string | null): {
  variant: "success" | "destructive" | "secondary";
  label: string;
} | null {
  if (!status) return null;

  const normalized = status.toUpperCase();

  // Active statuses (CSLB uses "CLEAR", GC pool uses "ACTIVE")
  if (normalized === "CLEAR" || normalized === "ACTIVE") {
    return { variant: "success", label: "active" };
  }

  // Expired status
  if (normalized === "EXPIRED") {
    return { variant: "destructive", label: "expired" };
  }

  // Unknown/other statuses
  return { variant: "secondary", label: status.toLowerCase() };
}
