"use client"

import { useCrmRealm } from "./crm-realm"
import { ProductSwitcher } from "@/components/product-switcher"
import { openEstioStudioLocation } from "../../studio/actions"

/** CRM is active here; Studio opens the active location's workspace (access re-checked server-side). */
export function AdminProductSwitcher({ locationId, compact = false, className }: { locationId: string; compact?: boolean; className?: string }) {
  const realm = useCrmRealm()
  return (
    <ProductSwitcher
      active="crm"
      compact={compact}
      className={className}
      targets={{ crm: { href: "/admin" }, studio: realm === "substo" ? { formAction: "/api/studio/product-switch", fields: { product: "studio", brandId: locationId } } : { action: openEstioStudioLocation, fields: { locationId } } }}
    />
  )
}
