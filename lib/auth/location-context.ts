import type { Location } from "@prisma/client";

/** Compatibility facade for the authoritative active tenant. Onboarding writes belong elsewhere. */
export async function getLocationContext(): Promise<Location | null> {
  const { resolveActiveLocation } = await import("@/lib/auth/active-location");
  return (await resolveActiveLocation()).location;
}
