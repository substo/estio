import "server-only";
import { getRequestAuthRealm } from "./request-realm";
import { validateActiveLocationSelection } from "./active-location";

export type ProductDestination = { locationId: string; path: string };

/** Re-check the Location the screen showed; cookies and posted IDs are selectors only. */
async function substoDestination(locationId: string, path: string): Promise<ProductDestination | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const resolution = await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || resolution.location?.authRealm !== "substo" || resolution.location.id !== locationId) return null;
  return { locationId: resolution.location.id, path };
}

export function substoCrmDestination(locationId: string) { return substoDestination(locationId, "/admin"); }

/** Studio needs no setup: its data is keyed by the Location itself. */
export function substoStudioDestination(locationId: string) { return substoDestination(locationId, "/studio"); }

/** Shared Studio tenant selection for both apps. */
export async function studioDestination(locationId: string): Promise<ProductDestination | null> {
  const realm = await getRequestAuthRealm();
  if (realm === "substo") return substoStudioDestination(locationId);
  if (realm !== "estio") return null;
  const { getEstioStudioLocationAccess } = await import("@/lib/studio/access");
  const access = await getEstioStudioLocationAccess(locationId);
  return access ? { locationId: access.location.id, path: "/studio" } : null;
}
