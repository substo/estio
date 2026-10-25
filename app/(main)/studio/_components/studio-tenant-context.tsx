"use client";
import { createContext, useContext, type ReactNode } from "react";
const StudioTenantContext = createContext<string | null>(null);
export function StudioTenantProvider({ locationId, children }: { locationId: string | null; children: ReactNode }) {
  return <StudioTenantContext.Provider value={locationId}>{children}</StudioTenantContext.Provider>;
}
export function useStudioTenantHeaders() {
  const locationId = useContext(StudioTenantContext);
  if (!locationId) throw new Error("Studio tenant context is required");
  return { "X-Studio-Tenant": locationId };
}
