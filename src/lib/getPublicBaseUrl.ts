/**
 * Returns the correct public base URL for sharing bid room links.
 * Converts preview URLs (*.lovableproject.com) to production URLs (*.lovable.app).
 * This ensures that public bid room links always point to the deployed domain
 * which doesn't require authentication.
 */
export function getPublicBaseUrl(): string {
  const hostname = window.location.hostname;
  
  // In preview environment, convert to production domain
  if (hostname.includes('lovableproject.com')) {
    const projectId = hostname.split('.')[0];
    return `https://${projectId}.lovable.app`;
  }
  
  // Already on deployed domain or localhost
  return window.location.origin;
}
