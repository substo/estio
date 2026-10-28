import "server-only";
import db from "@/lib/db";
import { canAccessAiUsageView } from "@/lib/ai/usage-summary-scope";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { listPlatformLocationLoginOptions } from "@/lib/auth/platform-location-options";
import type { ActiveLocationResolution } from "@/lib/auth/active-location";
import type { AppShellData, ShellApp } from "./types";

/**
 * Shell data for CRM and Studio from one resolved tenant, so the header, its widgets
 * and the product switch all describe the same Location in both products.
 */
export async function getAppShellData({ app, resolution, studioLocationId, impersonation }: {
  app: ShellApp;
  resolution: Pick<ActiveLocationResolution, "location" | "availableLocations" | "role">;
  studioLocationId: string | null;
  impersonation: AppShellData["impersonation"];
}): Promise<AppShellData> {
  const location = resolution.location;
  const platformAdmin = await getPlatformAdminContext();
  const [siteConfig, platformLoginLocations] = await Promise.all([
    location ? db.siteConfig.findUnique({ where: { locationId: location.id }, select: { theme: true } }) : null,
    platformAdmin ? listPlatformLocationLoginOptions(platformAdmin.internalUserId) : null,
  ]);
  const theme = siteConfig?.theme as { logo?: { url?: string; lightUrl?: string } } | null | undefined;
  return {
    app,
    activeLocationId: location?.id ?? null,
    locations: resolution.availableLocations.map((option) => ({ id: option.id, name: option.name })),
    platformLoginLocations,
    impersonation,
    logoUrl: theme?.logo?.url,
    lightUrl: theme?.logo?.lightUrl,
    // Same rule as getLocationAiUsageSummary: location-wide spend is for location admins.
    canViewAiUsage: Boolean(location) && canAccessAiUsageView("location", resolution.role === "ADMIN"),
    studioLocationId,
  };
}
