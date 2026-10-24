import "server-only";
import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { studioRest } from "./rest";

import { auth } from "@clerk/nextjs/server";
import type { UserRole } from "@prisma/client";
import { headers } from "next/headers";
import { validateActiveLocationSelection, type ActiveLocationResolution } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";
import { isStudioLocationAllowedForSession } from "./access-policy";
import {
  getEstioStudioWorkspaceById,
  getSubstoStudioWorkspaceForUser,
  type StudioWorkspace,
  type SubstoStudioWorkspace,
} from "./supabase-service";

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

/** Resolve every workspace ID against its host's identity realm and authority. */
export async function getStudioWorkspaceAccess(workspaceId: string): Promise<StudioWorkspaceAccess | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceId)) return null;
  const brand = await requestBrand();
  if (brand !== "estio" && brand !== "substo") return null;
  const state = await auth();
  if (!state.userId) return null;
  if (await isPlatformProfileDeleted(studioRest, brand, state.userId)) return null;

  if (brand === "substo") {
    const workspace = await getSubstoStudioWorkspaceForUser(workspaceId, state.userId);
    return workspace ? { brand, userId: state.userId, workspace, role: workspace.role } : null;
  }

  const workspace = await getEstioStudioWorkspaceById(workspaceId);
  if (!workspace?.estio_location_id) return null;
  const access = await resolveEstioLocationAccess(workspace.estio_location_id, state);
  return access ? { brand, userId: access.userId, workspace, role: access.role, locationId: access.location.id } : null;
}
