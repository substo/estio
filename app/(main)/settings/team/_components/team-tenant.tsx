"use client";
import { createContext, useContext, type ReactNode } from "react";
const TeamTenantContext = createContext<string | null>(null);
export function TeamTenantProvider({ locationId, children }: { locationId: string; children: ReactNode }) {
  return <TeamTenantContext.Provider value={locationId}>{children}</TeamTenantContext.Provider>;
}
export function useTeamTenant() {
  const locationId = useContext(TeamTenantContext);
  if (!locationId) throw new Error("Team tenant context is required");
  return locationId;
}
