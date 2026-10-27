import "server-only";
import { getRequestAuthRealm } from "./request-realm";
import { validateActiveLocationSelection } from "./active-location";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
import { ensureLocationWorkspace } from "@/lib/locations/location-service";
import { substoLocationDeps } from "@/lib/locations/substo-locations";
import { isStudioProviderUnavailable, unlessStudioUnavailable } from "@/lib/studio/rest";

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
  const location = resolution.location, clerkUserId = resolution.user.clerkId;
  await unlessStudioUnavailable(() => ensureLocationWorkspace(substoLocationDeps(), location, clerkUserId));
  return { locationId: resolution.location.id, path: `/studio` };
}

/** Shared Studio tenant selection; provisioning is explicit and follows authorization. */
export async function studioDestination(locationId: string): Promise<ProductDestination | null> {
  const realm = await getRequestAuthRealm();
  if (realm === "substo") return substoStudioDestination(locationId);
  if (realm !== "estio") return null;
  const { getEstioStudioLocationAccess } = await import("@/lib/studio/access");
  let access;
  try { access = await getEstioStudioLocationAccess(locationId); }
  catch (error) {
    // Studio's database is restricted: authorize from the CRM alone; Studio shows its unavailable state.
    if (!isStudioProviderUnavailable(error)) throw error;
    const resolution = await validateActiveLocationSelection(locationId);
    return resolution.status === "authorized" && resolution.location ? { locationId: resolution.location.id, path: "/studio" } : null;
  }
  if (!access) return null;
  const location = access.location;
  const { ensureEstioStudioWorkspace } = await import("@/lib/studio/supabase-service");
  await unlessStudioUnavailable(() => ensureEstioStudioWorkspace(location));
  return { locationId: access.location.id, path: `/studio` };
}
