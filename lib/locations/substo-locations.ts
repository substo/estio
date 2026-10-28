import "server-only";

import { auth, createClerkClient, currentUser, type User } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import db from "@/lib/db";
import { resolveActiveLocation, validateActiveLocationSelection } from "@/lib/auth/active-location";
import { getClerkBrandKeys } from "@/lib/auth/clerk-runtime";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { prepareSubstoSignIn, type LocationActor, type LocationDeps, type ClerkIdentity, type SubstoClerkPort } from "./location-service";

export function toClerkIdentity(user: User): ClerkIdentity {
  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    primaryEmailAddressId: user.primaryEmailAddressId,
    emailAddresses: user.emailAddresses.map((entry) => ({ id: entry.id, emailAddress: entry.emailAddress, verification: { status: entry.verification?.status ?? null } })),
  };
}

/** Always Substo's own Clerk application, never the request default. */
function substoClerk(): SubstoClerkPort {
  const keys = getClerkBrandKeys("substo");
  if (!keys) throw new Error("Substo Clerk keys are not configured.");
  const client = createClerkClient({ secretKey: keys.secretKey, publishableKey: keys.publishableKey });
  return {
    getUser: async (id) => {
      try { return toClerkIdentity(await client.users.getUser(id)); } catch (error) {
        if ((error as { status?: number }).status === 404) return null;
        throw error;
      }
    },
    findUserByEmail: async (email) => {
      const result = await client.users.getUserList({ emailAddress: [email], limit: 2 });
      return result.data.length === 1 ? toClerkIdentity(result.data[0]) : null;
    },
    createInvitation: async ({ email, redirectUrl, locationInvitationId }) => {
      const invitation = await client.invitations.createInvitation({
        emailAddress: email, redirectUrl, notify: true, ignoreExisting: true,
        publicMetadata: { source: "location_invite", locationInvitationId },
      });
      return { id: invitation.id };
    },
    revokeInvitation: async (id) => { await client.invitations.revokeInvitation(id); },
  };
}

export function substoLocationDeps(): LocationDeps {
  return { db, clerk: substoClerk() };
}

/**
 * Run at every Substo entry: links the Business user, claims invitations,
 * and creates the first location if needed.
 */
export async function prepareCurrentSubstoUser() {
  if (await getRequestAuthRealm() !== "substo") return null;
  const user = await currentUser();
  if (!user) return null;
  return prepareSubstoSignIn(substoLocationDeps(), toClerkIdentity(user));
}

/**
 * Entry setup for CRM pages. It needs the Clerk API and several queries, so a user who
 * completed it in this process within the last minute is not prepared again; invitations
 * sent meanwhile are claimed on the next page after that.
 */
const SUBSTO_ENTRY_TTL_MS = 60_000;
const preparedUntil = new Map<string, number>();

export async function prepareCurrentSubstoUserOnEntry() {
  if (await getRequestAuthRealm() !== "substo") return;
  const { userId } = await auth();
  if (!userId) return;
  const now = Date.now();
  if ((preparedUntil.get(userId) ?? 0) > now) return;
  await prepareCurrentSubstoUser();
  if (preparedUntil.size > 5_000) preparedUntil.clear();
  preparedUntil.set(userId, now + SUBSTO_ENTRY_TTL_MS);
}

/** The signed-in user acting on their active Substo location. */
export async function getSubstoLocationActor(locationId?: string): Promise<(LocationActor & { locationName: string; clerkUserId: string }) | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const resolution = locationId === undefined ? await resolveActiveLocation() : await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || !resolution.user || !resolution.location || !resolution.role) return null;
  return {
    userId: resolution.user.id,
    clerkUserId: resolution.user.clerkId,
    locationId: resolution.location.id,
    role: resolution.role,
    locationName: resolution.location.name || "Untitled brand",
  };
}

/** Where invited people sign up: this Substo host. */
export async function substoSignUpUrl(): Promise<string | null> {
  const origin = getHostOrigin((await headers()).get("host"));
  return origin ? `${origin}/sign-up` : null;
}
