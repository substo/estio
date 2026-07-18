
/**
 * Centralized Application Configuration
 * 
 * This file serves as the single source of truth for domain-related logic.
 * It reads from environment variables to allow flexibility across environments
 * (e.g., Development, Staging, Production).
 */

// The main domain of the application (e.g. "estio.co" or "localhost:3000")
export const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || "estio.co";

// The full base URL of the application (e.g. "https://estio.co" or "http://localhost:3000")
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || `https://${APP_DOMAIN}`;

// List of "System Domains" that are managed by the app infrastructure
// and should NOT be treated as tenant/custom domains.
export const SYSTEM_DOMAINS = [
  APP_DOMAIN,
  "localhost",
  "localhost:3000",
  "127.0.0.1",
  "clerk.estio.co", // Legacy/Internal
  process.env.NEXT_PUBLIC_CLERK_DOMAIN || "" // Include the Clerk domain as a system domain
].filter(Boolean);

/**
 * Checks if a given hostname is a System Domain.
 * Handles port stripping for localhost comparisons.
 */
export const isSystemDomain = (hostname: string | null | undefined): boolean => {
  if (!hostname) return false;
  
  const cleanHost = hostname.replace(/:\d+$/, ""); // Remove port
  return SYSTEM_DOMAINS.some(d => d.replace(/:\d+$/, "") === cleanHost);
};
