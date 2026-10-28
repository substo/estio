import "server-only";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import { getRequestAuthRealm } from "./request-realm";
import { resolveActiveLocation, validateActiveLocationSelection } from "./active-location";
import { getEstioStudioWorkspace, getEstioStudioWorkspaceById, getSubstoStudioWorkspace } from "@/lib/studio/supabase-service";
import { isPlatformProfileDeleted } from "@/lib/platform/profile-lifecycle";
import { studioRest } from "@/lib/studio/rest";

/** Pure mapping/authority lookup: never provisions workspaces or mirrors membership. */
export async function resolveWorkspaceTenant(workspaceId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) return null;
  const realm = await getRequestAuthRealm();
  if (realm !== "estio" && realm !== "substo") return null;
  const { userId } = await auth();
  if (!userId || await isPlatformProfileDeleted(studioRest, realm, userId)) return null;
  const workspace = realm === "estio" ? await getEstioStudioWorkspaceById(workspaceId) : await getSubstoStudioWorkspace(workspaceId);
  if (!workspace) return null;
  const locationId = realm === "estio" ? workspace.estio_location_id : (await db.location.findFirst({
    where: { authRealm: realm, studioWorkspaceId: workspaceId }, select: { id: true },
  }))?.id;
  if (!locationId) return null;
  const resolution = await validateActiveLocationSelection(locationId);
  return resolution.status === "authorized" && resolution.location?.authRealm === realm ? resolution : null;
}

export function resolveTenantContext(input: { workspaceId?: string; locationId?: string } = {}) {
  return resolveTenantContextCached(input.workspaceId, input.locationId);
}

/** Cached per request by its primitive inputs (the layout and the page both resolve it). */
const resolveTenantContextCached = cache(async (workspaceId: string | undefined, locationId: string | undefined) => {
  const input = { workspaceId, locationId };
  const realm = await getRequestAuthRealm();
  if (realm !== "estio" && realm !== "substo") return null;
  const resolution = input.workspaceId !== undefined ? await resolveWorkspaceTenant(input.workspaceId)
    : input.locationId !== undefined ? await validateActiveLocationSelection(input.locationId) : await resolveActiveLocation();
  if (!resolution || ((input.workspaceId !== undefined || input.locationId !== undefined) && resolution.status !== "authorized")) return null;
  const location = resolution.location;
  const resolvedWorkspaceId = input.workspaceId ?? (location ? realm === "substo" ? location.studioWorkspaceId : (await getEstioStudioWorkspace(location.id))?.id : null);
  return { app: realm, resolution, workspaceId: resolvedWorkspaceId ?? null };
});
