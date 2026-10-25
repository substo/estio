import "server-only";
import { getRequestAuthRealm } from "./request-realm";
import { validateActiveLocationSelection } from "./active-location";
import { getStudioWorkspaceAccess } from "@/lib/studio/access";
import { ensureBrandWorkspace } from "@/lib/brands/brand-service";
import { substoBrandDeps } from "@/lib/brands/substo-brands";

export type ProductDestination = { locationId: string; path: string };

/** Re-check the displayed workspace and its brand; cookies and posted IDs are selectors only. */
export async function substoCrmDestination(workspaceId: string): Promise<ProductDestination | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const access = await getStudioWorkspaceAccess(workspaceId);
  if (!access || access.brand !== "substo") return null;
  const resolution = await validateActiveLocationSelection(access.brandId);
  if (resolution.status !== "authorized" || resolution.location?.authRealm !== "substo" || resolution.location.id !== access.brandId) return null;
  return { locationId: resolution.location.id, path: "/admin" };
}

export async function substoStudioDestination(brandId: string): Promise<ProductDestination | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const resolution = await validateActiveLocationSelection(brandId);
  if (resolution.status !== "authorized" || resolution.location?.authRealm !== "substo" || resolution.location.id !== brandId || !resolution.user) return null;
  const workspaceId = await ensureBrandWorkspace(substoBrandDeps(), resolution.location, resolution.user.clerkId);
  return { locationId: resolution.location.id, path: `/studio/workspace/${workspaceId}` };
}
