import "server-only";

import { headers } from "next/headers";
import { resolveActiveLocation } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import type { StudioShellBrand } from "./studio-shell";

export type StudioShellData = {
  app: "estio" | "substo";
  brands: StudioShellBrand[];
  activeBrandId: string | null;
  activeLocationName: string | null;
  fallbackWorkspaceId: string | null;
};

/** Shell context for the request's app: brands (Substo) or the active location (Estio). */
export async function getStudioShellData(): Promise<StudioShellData | null> {
  const brand = resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
  if (brand !== "estio" && brand !== "substo") return null;
  const resolution = await resolveActiveLocation();
  const brands = resolution.availableLocations.map((location) => ({ id: location.id, name: location.name || "Untitled brand" }));
  return {
    app: brand,
    brands,
    activeBrandId: resolution.location?.id ?? null,
    activeLocationName: brand === "estio" ? resolution.location?.name ?? null : null,
    fallbackWorkspaceId: brand === "substo" ? resolution.location?.studioWorkspaceId ?? null : null,
  };
}
