import type { HostBrand } from "@/lib/auth/host-brand";
import { appIdentity } from "@/lib/branding/app-identity";

export interface StudioDeviceBrand { app: "estio" | "substo"; name: string; iconUrl: string | null }

/** App brand the Studio Mac app shows for a connection. No tenant/Location data. */
export function studioDeviceBrand(brand: HostBrand, origin: string | null): StudioDeviceBrand | null {
  if (brand === "tenant" || !origin) return null;
  const identity = appIdentity(brand);
  return { app: brand, name: identity.name, iconUrl: new URL(identity.icon, origin).href };
}
