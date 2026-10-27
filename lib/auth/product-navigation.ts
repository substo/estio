import "server-only";
import { getRequestAuthRealm } from "./request-realm";
import { validateActiveLocationSelection } from "./active-location";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
import { ensureLocationWorkspace } from "@/lib/locations/location-service";
import { substoLocationDeps } from "@/lib/locations/substo-locations";

export type ProductDestination = { locationId: string; path: string };

/** Re-check the displayed workspace and its location; cookies and posted IDs are selectors only. */
export async function substoCrmDestination(workspaceId: string): Promise<ProductDestination | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || access.brand !== "substo") return null;
  const resolution = await validateActiveLocationSelection(access.locationId);
  if (resolution.status !== "authorized" || resolution.location?.authRealm !== "substo" || resolution.location.id !== access.locationId) return null;
  return { locationId: resolution.location.id, path: "/admin" };
}

export async function substoStudioDestination(locationId: string): Promise<ProductDestination | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const resolution = await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || resolution.location?.authRealm !== "substo" || resolution.location.id !== locationId || !resolution.user) return null;
  const workspaceId = await ensureLocationWorkspace(substoLocationDeps(), resolution.location, resolution.user.clerkId);
  return { locationId: resolution.location.id, path: `/studio` };
}

/** Shared Studio tenant selection; provisioning is explicit and follows authorization. */
export async function studioDestination(locationId: string): Promise<ProductDestination | null> {
  const realm = await getRequestAuthRealm();
  if (realm === "substo") return substoStudioDestination(locationId);
  if (realm !== "estio") return null;
  const { getEstioStudioLocationAccess } = await import("@/lib/studio/access");
  const access = await getEstioStudioLocationAccess(locationId);
  if (!access) return null;
  const { ensureEstioStudioWorkspace } = await import("@/lib/studio/supabase-service");
  const workspace = await ensureEstioStudioWorkspace(access.location);
  return { locationId: access.location.id, path: `/studio` };
}
