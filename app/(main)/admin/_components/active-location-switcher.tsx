"use client";

import { useCrmVocabulary } from "./crm-realm";
import { TenantSelector, type TenantOption } from "@/components/tenant-selector";

export function ActiveLocationSwitcher({ activeLocationId, locations }: { activeLocationId: string; locations: TenantOption[] }) {
  const vocabulary = useCrmVocabulary();
  return <TenantSelector activeLocationId={activeLocationId} locations={locations} noun={vocabulary.tenantTitle === "Brand" ? "brand" : "location"} onSelect={async (locationId) => {
    const response = await fetch("/api/active-location", {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || `${vocabulary.tenantTitle} could not be changed.`);
    // A detail URL from another tenant must not survive a selection change.
    window.location.assign("/admin");
  }} />;
}
