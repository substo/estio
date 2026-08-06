import "server-only";

import { auth } from "@clerk/nextjs/server";
import type { Location, PlatformRole } from "@prisma/client";
import { cookies } from "next/headers";
import db from "@/lib/db";
import {
  chooseActiveLocation,
  intersectAuthorizedLocations,
  scopeDirectLocationsForSession,
  type AuthorizedLocation,
} from "@/lib/auth/active-location-policy";
import { extractImpersonationClaim } from "@/lib/auth/impersonation-policy";
import { getImpersonationContextFromAuth } from "@/lib/auth/impersonation";

export const ACTIVE_LOCATION_COOKIE = "active_location_id";
export const ACTIVE_LOCATION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

type LocalIdentity = {
  id: string;
  clerkId: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  timeZone: string | null;
  platformRole: PlatformRole;
};

export type ActiveLocationResolution = {
  status: "unauthenticated" | "no_access" | "selection_required" | "authorized";
  clerkUserId: string | null;
  user: LocalIdentity | null;
  location: (Location & { membershipRole: AuthorizedLocation["role"]; contactAccessScope: AuthorizedLocation["contactAccessScope"] }) | null;
  role: AuthorizedLocation["role"] | null;
  availableLocations: AuthorizedLocation[];
  locationCount: number;
};

export async function resolveActiveLocation(): Promise<ActiveLocationResolution> {
  const authState = await auth();
  const { userId: clerkUserId } = authState;
  if (!clerkUserId) {
    return { status: "unauthenticated", clerkUserId: null, user: null, location: null, role: null, availableLocations: [], locationCount: 0 };
  }

  const user = await db.user.findUnique({
    where: { clerkId: clerkUserId },
    select: {
      id: true, clerkId: true, firstName: true, lastName: true, phone: true, timeZone: true, platformRole: true,
      locations: { select: { id: true, name: true, isPlatformMaster: true } },
      locationRoles: { select: { locationId: true, role: true, contactAccessScope: true } },
    },
  });
  if (!user?.clerkId || user.clerkId !== clerkUserId) {
    return { status: "no_access", clerkUserId, user: null, location: null, role: null, availableLocations: [], locationCount: 0 };
  }

  const authorizedLocations = intersectAuthorizedLocations({ connectedLocations: user.locations, roles: user.locationRoles });
  const actorClaim = extractImpersonationClaim(authState.actor);
  const impersonation = actorClaim
    ? await getImpersonationContextFromAuth({ userId: authState.userId, sessionId: authState.sessionId, actor: authState.actor })
    : null;
  if (authState.actor && !impersonation) {
    return { status: "no_access", clerkUserId, user: null, location: null, role: null, availableLocations: [], locationCount: 0 };
  }
  const availableLocations = scopeDirectLocationsForSession(authorizedLocations, {
    platformRole: user.platformRole,
    isImpersonating: Boolean(impersonation),
  });
  const requestedLocationId = impersonation?.locationId ?? (await cookies()).get(ACTIVE_LOCATION_COOKIE)?.value;
  const selection = chooseActiveLocation(availableLocations, requestedLocationId);
  const localIdentity: LocalIdentity = {
    id: user.id, clerkId: user.clerkId, firstName: user.firstName, lastName: user.lastName,
    phone: user.phone, timeZone: user.timeZone, platformRole: user.platformRole,
  };
  if (selection.status !== "authorized") {
    return { status: selection.status, clerkUserId, user: localIdentity, location: null, role: null, availableLocations, locationCount: availableLocations.length };
  }

  const fullLocation = await db.location.findUnique({ where: { id: selection.location.id } });
  if (!fullLocation) {
    return { status: "no_access", clerkUserId, user: localIdentity, location: null, role: null, availableLocations: [], locationCount: 0 };
  }
  return {
    status: "authorized", clerkUserId, user: localIdentity,
    location: { ...fullLocation, membershipRole: selection.location.role, contactAccessScope: selection.location.contactAccessScope },
    role: selection.location.role, availableLocations, locationCount: availableLocations.length,
  };
}

export async function validateActiveLocationSelection(locationId: string): Promise<ActiveLocationResolution> {
  const resolution = await resolveActiveLocation();
  const selected = resolution.availableLocations.find((location) => location.id === String(locationId || "").trim());
  if (!resolution.user || !resolution.clerkUserId || !selected) {
    return { ...resolution, status: resolution.clerkUserId ? "no_access" : "unauthenticated", location: null, role: null };
  }
  const fullLocation = await db.location.findUnique({ where: { id: selected.id } });
  if (!fullLocation) return { ...resolution, status: "no_access", location: null, role: null };
  return {
    ...resolution, status: "authorized",
    location: { ...fullLocation, membershipRole: selected.role, contactAccessScope: selected.contactAccessScope },
    role: selected.role,
  };
}
