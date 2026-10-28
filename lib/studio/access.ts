import "server-only";
import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { studioRest } from "./rest";

import { auth } from "@clerk/nextjs/server";
import type { UserRole } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";
import { resolveActiveLocation, validateActiveLocationSelection, type ActiveLocationResolution } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";
import { isStudioLocationAllowedForSession } from "./access-policy";
import {
  getEstioStudioWorkspaceById,
  getSubstoStudioWorkspace,
  type StudioWorkspace,
  type SubstoStudioWorkspace,
} from "./supabase-service";
import { resolveLocationWorkspaceAccess } from "@/lib/locations/location-service";
import { substoLocationDeps } from "@/lib/locations/substo-locations";

type AuthState = Awaited<ReturnType<typeof auth>>;

export type EstioStudioLocationAccess = {
  userId: string;
  location: NonNullable<ActiveLocationResolution["location"]>;
  role: UserRole;
};

export type StudioWorkspaceAccess = {
  brand: "estio";
  userId: string;
  workspace: StudioWorkspace;
  role: UserRole;
  locationId: string;
} | {
  brand: "substo";
  userId: string;
  workspace: SubstoStudioWorkspace;
  role: SubstoStudioWorkspace["role"];
  /** The Location this workspace belongs to. */
  locationId: string;
};

async function requestBrand() {
  return resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
}

async function resolveEstioLocationAccess(locationId: string, state: AuthState): Promise<EstioStudioLocationAccess | null> {
  if (!state.userId || !locationId) return null;
  if (await isPlatformProfileDeleted(studioRest, "estio", state.userId)) return null;
  const impersonation = state.actor
    ? await getImpersonationContextFromAuth({ userId: state.userId, sessionId: state.sessionId, actor: state.actor })
    : null;
  if (!isStudioLocationAllowedForSession({
    locationId,
    isImpersonating: Boolean(state.actor),
    impersonationLocationId: impersonation?.locationId ?? null,
  })) return null;

  const resolution = await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || !resolution.location || !resolution.role) return null;
  return { userId: state.userId, location: resolution.location, role: resolution.role };
}

/** Authorize a location before creating its Studio mapping or changing selection. */
export async function getEstioStudioLocationAccess(locationId: string): Promise<EstioStudioLocationAccess | null> {
  if (await requestBrand() !== "estio") return null;
  return resolveEstioLocationAccess(locationId, await auth());
}

/**
 * Resolve every workspace ID against its host's identity realm and authority.
 * Cached per request: the layout, the page and its sections all ask.
 */
export const getStudioWorkspaceAccess = cache(async (workspaceId: string): Promise<StudioWorkspaceAccess | null> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) return null;
  const brand = await requestBrand();
  if (brand !== "estio" && brand !== "substo") return null;
  const state = await auth();
  if (!state.userId) return null;
  if (await isPlatformProfileDeleted(studioRest, brand, state.userId)) return null;

  const active = await resolveActiveLocation();
  if (active.status !== "authorized" || !active.location) return null;

  if (brand === "substo") {
    if (active.location.studioWorkspaceId !== workspaceId) return null;
    // The Location team decides; the Studio membership row is re-synced to it
    // (added, re-roled or removed) so Studio's SQL checks agree.
    const locationAccess = await resolveLocationWorkspaceAccess(substoLocationDeps(), workspaceId, state.userId);
    if (!locationAccess || locationAccess.location.id !== active.location.id) return null;
    const selection = await validateActiveLocationSelection(locationAccess.location.id);
    if (selection.status !== "authorized") return null;
    const workspace = await getSubstoStudioWorkspace(workspaceId);
    return workspace
      ? { brand, userId: state.userId, workspace: { ...workspace, name: locationAccess.location.name?.trim() || "Untitled brand", role: locationAccess.studioRole }, role: locationAccess.studioRole, locationId: locationAccess.location.id }
      : null;
  }

  const workspace = await getEstioStudioWorkspaceById(workspaceId);
  if (!workspace?.estio_location_id || workspace.estio_location_id !== active.location.id) return null;
  const access = await resolveEstioLocationAccess(workspace.estio_location_id, state);
  return access ? { brand, userId: access.userId, workspace: { ...workspace, name: access.location.name?.trim() || "Unnamed location" }, role: access.role, locationId: access.location.id } : null;
});
