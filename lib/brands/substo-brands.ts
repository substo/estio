import "server-only";

import { createClerkClient, currentUser, type User } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import db from "@/lib/db";
import { resolveActiveLocation, validateActiveLocationSelection } from "@/lib/auth/active-location";
import { getClerkBrandKeys } from "@/lib/auth/clerk-runtime";
import { getHostOrigin } from "@/lib/auth/host-brand";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import {
  createSubstoStudioWorkspace,
  deleteSubstoMembership,
  getSubstoMembershipRole,
  listSubstoStudioWorkspaces,
  listSubstoWorkspaceMembers,
  renameSubstoStudioWorkspace,
  substoStudioWorkspaceExists,
  upsertSubstoMembership,
} from "@/lib/studio/supabase-service";
import { prepareSubstoSignIn, type BrandActor, type BrandDeps, type ClerkIdentity, type StudioBrandPort, type SubstoClerkPort } from "./brand-service";

const studio: StudioBrandPort = {
  listMemberWorkspaces: async (clerkUserId) => (await listSubstoStudioWorkspaces(clerkUserId)).map((workspace) => ({ id: workspace.id, name: workspace.name, role: workspace.role })),
  listWorkspaceMembers: listSubstoWorkspaceMembers,
  workspaceExists: substoStudioWorkspaceExists,
  createWorkspace: async (workspaceId, name, creator) => { await createSubstoStudioWorkspace(name.slice(0, 100), creator, workspaceId); },
  renameWorkspace: renameSubstoStudioWorkspace,
  getMembership: getSubstoMembershipRole,
  upsertMembership: upsertSubstoMembership,
  deleteMembership: deleteSubstoMembership,
};

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
    createInvitation: async ({ email, redirectUrl, brandInvitationId }) => {
      const invitation = await client.invitations.createInvitation({
        emailAddress: email, redirectUrl, notify: true, ignoreExisting: true,
        publicMetadata: { source: "brand_invite", brandInvitationId },
      });
      return { id: invitation.id };
    },
    revokeInvitation: async (id) => { await client.invitations.revokeInvitation(id); },
  };
}

export function substoBrandDeps(): BrandDeps {
  return { db, studio, clerk: substoClerk() };
}

/**
 * Run at every Substo entry: links the Business user, claims invitations,
 * adopts pre-brand Studio workspaces, and creates the first brand if needed.
 */
export async function prepareCurrentSubstoUser() {
  if (await getRequestAuthRealm() !== "substo") return null;
  const user = await currentUser();
  if (!user) return null;
  return prepareSubstoSignIn(substoBrandDeps(), toClerkIdentity(user));
}

/** The signed-in user acting on their active Substo brand. */
export async function getSubstoBrandActor(locationId?: string): Promise<(BrandActor & { brandName: string; clerkUserId: string; studioWorkspaceId: string | null }) | null> {
  if (await getRequestAuthRealm() !== "substo") return null;
  const resolution = locationId === undefined ? await resolveActiveLocation() : await validateActiveLocationSelection(locationId);
  if (resolution.status !== "authorized" || !resolution.user || !resolution.location || !resolution.role) return null;
  return {
    userId: resolution.user.id,
    clerkUserId: resolution.user.clerkId,
    locationId: resolution.location.id,
    role: resolution.role,
    brandName: resolution.location.name || "Untitled brand",
    studioWorkspaceId: resolution.location.studioWorkspaceId,
  };
}

/** Where invited people sign up: this Substo host. */
export async function substoSignUpUrl(): Promise<string | null> {
  const origin = getHostOrigin((await headers()).get("host"));
  return origin ? `${origin}/sign-up` : null;
}
