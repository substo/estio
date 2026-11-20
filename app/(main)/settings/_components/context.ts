import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { resolveTenantContext } from "@/lib/auth/tenant-context";
import { getStudioAccess } from "@/lib/studio/access";

/** Bind shared settings to the active Location in the account's current realm. */
export const requireSettingsContext = cache(async () => {
  const context = await resolveTenantContext();
  if (!context || context.resolution.status === "unauthenticated") notFound();
  const { app, locationId, resolution } = context;
  const tenantHost = resolveHostBrand((await headers()).get("host"), getHostBrandConfig()) === "tenant";
  if (!locationId) return { app, tenantHost, access: null, locationId: null };

  // CRM settings remain available on Estio Clerk satellite hosts, which don't run Studio.
  if (tenantHost && resolution.location && resolution.clerkUserId && resolution.role) {
    return {
      app, tenantHost, locationId,
      access: { app, locationId, userId: resolution.clerkUserId, locationName: resolution.location.name?.trim() || "Unnamed location", role: resolution.role },
    };
  }

  const access = await getStudioAccess(locationId);
  if (!access) notFound();
  return { app, tenantHost, access, locationId: access.locationId };
});
