import "server-only";

import { auth } from "@clerk/nextjs/server";
import type { UserRole } from "@prisma/client";
import { headers } from "next/headers";
import { cache } from "react";
import { resolveActiveLocation, validateActiveLocationSelection, type ActiveLocationResolution } from "@/lib/auth/active-location";
import { getHostBrandConfig, resolveHostBrand } from "@/lib/auth/host-brand";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";
import { isPlatformProfileDeleted } from "../platform/profile-lifecycle";
import { isStudioLocationAllowedForSession } from "./access-policy";
import { studioDb } from "./studio-db";

type AuthState = Awaited<ReturnType<typeof auth>>;

export type EstioStudioLocationAccess = {
  userId: string;
  location: NonNullable<ActiveLocationResolution["location"]>;
  role: UserRole;
};

/** A signed-in account's access to Studio for one Location: the Location team role decides. */
export type StudioAccess = {
  app: "estio" | "substo";
  /** Clerk user ID of the account (per app). */
  userId: string;
  locationId: string;
  locationName: string;
  role: UserRole;
};

async function requestApp() {
  return resolveHostBrand((await headers()).get("host"), getHostBrandConfig());
}

async function sessionAllows(state: AuthState, locationId: string) {
  const impersonation = state.actor
    ? await getImpersonationContextFromAuth({ userId: state.userId, sessionId: state.sessionId, actor: state.actor })
    : null;
  return isStudioLocationAllowedForSession({
    locationId,
    isImpersonating: Boolean(state.actor),
    impersonationLocationId: impersonation?.locationId ?? null,
  });
}

async function resolveEstioLocationAccess(locationId: string, state: AuthState): Promise<EstioStudioLocationAccess | null> {
  if (!state.userId || !locationId) return null;
  if (await isPlatformProfileDeleted(studioDb, "estio", state.userId)) return null;
  if (!(await sessionAllows(state, locationId))) return null;
  const resolution = await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || !resolution.location || !resolution.role) return null;
  return { userId: state.userId, location: resolution.location, role: resolution.role };
}

/** Authorize an Estio Location before selecting it for Studio. */
export async function getEstioStudioLocationAccess(locationId: string): Promise<EstioStudioLocationAccess | null> {
  if (await requestApp() !== "estio") return null;
  return resolveEstioLocationAccess(locationId, await auth());
}

/**
 * Studio access to the active Location in this app. Cached per request: the layout,
 * the page and its sections all ask.
 */
export const getStudioAccess = cache(async (locationId: string): Promise<StudioAccess | null> => {
  if (!locationId || locationId.length > 255) return null;
  const app = await requestApp();
  if (app !== "estio" && app !== "substo") return null;
  const state = await auth();
  if (!state.userId) return null;
  if (await isPlatformProfileDeleted(studioDb, app, state.userId)) return null;
  const active = await resolveActiveLocation();
  if (active.status !== "authorized" || !active.location || !active.role) return null;
  if (active.location.id !== locationId || active.location.authRealm !== app) return null;
  if (!(await sessionAllows(state, locationId))) return null;
  return {
    app,
    userId: state.userId,
    locationId,
    locationName: active.location.name?.trim() || (app === "substo" ? "Untitled brand" : "Unnamed location"),
    role: active.role,
  };
});
