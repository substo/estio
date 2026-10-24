import { isSubstoCrmPage, isSubstoCrmApi } from "./substo-crm-policy";
import type { HostBrand } from "./host-brand";

function isPathOrNested(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export const CLERK_PROFILE_WEBHOOK_PATH = "/api/webhooks/clerk-profile";

export type SubstoRouteKind = "root" | "auth" | "studio" | "studio-api" | "brand" | "crm" | "crm-api" | "profile" | "webhook" | "blocked";

/** Substo reaches reviewed application routes and never the tenant-site resolver. */
export function classifySubstoRoute(pathname: string): SubstoRouteKind {
  if (pathname === CLERK_PROFILE_WEBHOOK_PATH) return "webhook";
  if (pathname === "/") return "root";
  if (isPathOrNested(pathname, "/sign-in") || isPathOrNested(pathname, "/sign-up")) return "auth";
  if (isPathOrNested(pathname, "/account/connections")) return "profile";
  if (isPathOrNested(pathname, "/studio")) return "studio";
  if (isSubstoCrmPage(pathname) || pathname === "/select-location") return "crm";
  if (isSubstoCrmApi(pathname)) return "crm-api";
  // Brand team management is shared with Studio.
  if (isPathOrNested(pathname, "/brand")) return "brand";
  if (isPathOrNested(pathname, "/api/studio")) return "studio-api";
  return "blocked";
}

/** Retain the existing Estio static/health bypass after enforcing Substo's boundary. */
export function skipsLegacyEstioMiddleware(pathname: string): boolean {
  // The previous matcher always included tRPC even when its path had a suffix.
  if (pathname.startsWith("/trpc")) return false;
  return pathname.startsWith("/api/health") || /\.(?:css|js|png|jpg|jpeg|gif|webp|svg|ico|csv|docx?|xlsx?|zip|webmanifest)/.test(pathname);
}

/** Ticket sign-in must stay on this origin and within the selected experience. */
export function safeAuthRedirect(value: string | null, brand: HostBrand): string {
  const fallback = brand === "substo" ? "/studio" : "/admin";
  if (!value?.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const target = new URL(value, "https://auth.invalid");
    if (target.origin !== "https://auth.invalid") return fallback;
    if (brand === "substo" && !isSubstoCrmPage(target.pathname) && !isPathOrNested(target.pathname, "/studio") && !isPathOrNested(target.pathname, "/brand") && !isPathOrNested(target.pathname, "/account/connections")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

/** A recent hard handoff that returned to sign-in means the server rejected the session. */
export const SIGNED_IN_HANDOFF_WINDOW_MS = 15_000;

/**
 * Substo leaves a signed-in sign-in page with a full document load: in-app
 * navigation can replay a redirect cached while signed out and loop forever.
 */
export function signedInHandoff(brand: HostBrand, lastAttemptAt: number | null, now: number): "none" | "redirect" | "stalled" {
  if (brand !== "substo") return "none";
  if (lastAttemptAt !== null && now - lastAttemptAt >= 0 && now - lastAttemptAt < SIGNED_IN_HANDOFF_WINDOW_MS) return "stalled";
  return "redirect";
}
