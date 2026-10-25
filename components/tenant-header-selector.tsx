"use client";

import { TenantSelector, type TenantOption } from "@/components/tenant-selector";
import { PlatformLocationLoginSwitcher } from "@/app/(main)/admin/_components/platform-location-login-switcher";
import type { PlatformLocationLoginOption } from "@/lib/auth/platform-location-options";

/** Shared product header: one tenant identity, with the same access choices in either product. */
export function TenantHeaderSelector({ app, product, activeLocationId, locations, platformLoginLocations }: {
  app: "estio" | "substo";
  product: "crm" | "studio";
  activeLocationId: string | null;
  locations: TenantOption[];
  platformLoginLocations?: PlatformLocationLoginOption[] | null;
}) {
  async function select(locationId: string) {
    // Native navigation also clears cached layouts and foreign-tenant detail URLs.
    const form = document.createElement("form");
    form.method = "post"; form.action = "/api/studio/tenant-switch";
    for (const [name, value] of Object.entries({ locationId, product })) {
      const input = document.createElement("input"); input.type = "hidden"; input.name = name; input.value = value; form.appendChild(input);
    }
    document.body.appendChild(form); form.submit();
  }
  return <div className="min-w-0" aria-label={`${app === "substo" ? "Substo" : "Estio"} tenant`}>
    {platformLoginLocations && activeLocationId
      ? <PlatformLocationLoginSwitcher activeLocationId={activeLocationId} locations={platformLoginLocations} product={product} directLocationIds={locations.map((location) => location.id)} onDirectSelection={select} />
      : <TenantSelector activeLocationId={activeLocationId} locations={locations} noun={app === "substo" ? "brand" : "location"} onSelect={select} />}
  </div>;
}
