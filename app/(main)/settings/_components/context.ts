import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { resolveTenantContext } from "@/lib/auth/tenant-context";
import { getStudioAccess } from "@/lib/studio/access";

/**
 * The Location for every /settings page, resolved exactly as CRM and Studio do: the session's active Location in this app's
 * realm (resolveTenantContext → resolveActiveLocation), then Location membership via getStudioAccess (realm, deleted profile
 * and impersonation checks). Editing authority stays with each section's own server check (Location ADMIN, not impersonated).
 */
export const requireSettingsContext = cache(async () => {
  const context = await resolveTenantContext();
  if (!context || context.resolution.status === "unauthenticated") notFound();
  if (!context.locationId) return { app: context.app, access: null, locationId: null };
  const access = await getStudioAccess(context.locationId);
  if (!access) notFound();
  return { app: context.app, access, locationId: access.locationId };
});
