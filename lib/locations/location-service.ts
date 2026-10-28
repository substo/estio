import { Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import { realmClerkIdWhere, type AuthRealm } from "../auth/auth-realm";
import { ensureRealmUser, type RealmUserStore } from "../auth/realm-user-link";
import {
  checkTeamChange,
  defaultLocationName,
  normalizeLocationName,
  normalizeInviteEmail,
  primaryVerifiedEmail,
  verifiedEmails,
  type LocationRole,
} from "./location-policy";

/**
 * Locations (Prisma `Location`) on Substo: sign-in preparation and team changes.
 * The location team is the only source of truth for CRM and Studio access: Studio
 * reads it from the same database (`UserLocationRole`). Dependencies are injected for tests.
 */

const REALM: AuthRealm = "substo";

export type ClerkIdentity = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string; verification?: { status?: string | null } | null }>;
};

/** Substo's Clerk application (never Estio's). */
export interface SubstoClerkPort {
  getUser(clerkUserId: string): Promise<ClerkIdentity | null>;
  findUserByEmail(email: string): Promise<ClerkIdentity | null>;
  createInvitation(input: { email: string; redirectUrl: string; locationInvitationId: string }): Promise<{ id: string }>;
  revokeInvitation(invitationId: string): Promise<void>;
}

export type LocationDeps = { db: PrismaClient; clerk: SubstoClerkPort };

type Tx = Prisma.TransactionClient;

export type LocationMembership = { id: string; name: string; role: LocationRole };

function userStore(db: PrismaClient | Tx): RealmUserStore {
  return {
    user: {
      findUnique: (args) => db.user.findUnique(args),
      update: (args) => db.user.update(args),
      create: (args) => db.user.create(args as Parameters<typeof db.user.create>[0]),
    },
  };
}

const isUniqueViolation = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Find or create the Substo Business user for a verified Clerk identity. */
export async function ensureSubstoUser(db: PrismaClient, identity: ClerkIdentity) {
  const email = primaryVerifiedEmail(identity);
  if (!email) return null;
  const input = { clerkId: identity.id, email, firstName: identity.firstName, lastName: identity.lastName };
  try {
    return await ensureRealmUser(userStore(db), REALM, input);
  } catch (error) {
    // A concurrent first request created the same user; resolve it again.
    if (!isUniqueViolation(error)) throw error;
    return ensureRealmUser(userStore(db), REALM, input);
  }
}

/** Connect a user to a location with a role. An existing member keeps their role. */
async function joinLocation(tx: Tx, input: { userId: string; locationId: string; role: LocationRole; invitedById?: string | null }) {
  await tx.location.update({ where: { id: input.locationId }, data: { users: { connect: { id: input.userId } } } });
  await tx.userLocationRole.upsert({
    where: { userId_locationId: { userId: input.userId, locationId: input.locationId } },
    update: {},
    create: {
      userId: input.userId,
      locationId: input.locationId,
      role: input.role,
      invitedById: input.invitedById ?? null,
      invitedAt: input.invitedById ? new Date() : null,
    },
  });
}

/** Locations the user is a member of: connected and holding exactly one role, in this realm only. */
export async function listUserLocations(db: PrismaClient, userId: string): Promise<LocationMembership[]> {
  const user = await db.user.findFirst({
    where: { id: userId, authRealm: REALM },
    select: {
      locations: { where: { authRealm: REALM }, select: { id: true, name: true } },
      locationRoles: { where: { location: { authRealm: REALM } }, select: { locationId: true, role: true } },
    },
  });
  if (!user) return [];
  return user.locations.flatMap((location) => {
    const roles = user.locationRoles.filter((role) => role.locationId === location.id);
    return roles.length === 1 ? [{ id: location.id, name: location.name || "Untitled brand", role: roles[0].role }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Accept every pending invitation addressed to one of the user's verified emails. */
export async function claimPendingInvitations(db: PrismaClient, userId: string, emails: string[]): Promise<number> {
  if (emails.length === 0) return 0;
  const invitations = await db.locationInvitation.findMany({
    where: { authRealm: REALM, status: "PENDING", email: { in: emails }, location: { authRealm: REALM } },
    select: { id: true, locationId: true, role: true, invitedById: true },
  });
  let claimed = 0;
  for (const invitation of invitations) {
    await db.$transaction(async (tx) => {
      const accepted = await tx.locationInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedById: userId, acceptedAt: new Date() },
      });
      if (accepted.count !== 1) return;
      await joinLocation(tx, { userId, locationId: invitation.locationId, role: invitation.role, invitedById: invitation.invitedById });
      claimed += 1;
    });
  }
  return claimed;
}

/**
 * Create the user's location at their first sign-in. It happens at most once per
 * user, and not when an invitation is waiting for or was accepted by them.
 */
export async function createAutoLocationIfNeeded(db: PrismaClient, user: { id: string; firstName: string | null; email: string }, emails: string[]) {
  if ((await listUserLocations(db, user.id)).length > 0) return null;
  const invited = await db.locationInvitation.count({ where: { authRealm: REALM, email: { in: emails }, status: { in: ["PENDING", "ACCEPTED"] } } });
  if (invited > 0) return null;
  try {
    return await db.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: { authRealm: REALM, name: defaultLocationName(user), autoCreatedForUserId: user.id },
        select: { id: true },
      });
      await joinLocation(tx, { userId: user.id, locationId: location.id, role: "ADMIN" });
      return location.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null; // created before (and possibly left since)
    throw error;
  }
}

/** Everything that happens when a user arrives on Substo: user, invitations, auto location. */
export async function prepareSubstoSignIn(deps: LocationDeps, identity: ClerkIdentity) {
  const user = await ensureSubstoUser(deps.db, identity);
  if (!user) return null;
  const emails = verifiedEmails(identity);
  await claimPendingInvitations(deps.db, user.id, emails);
  await createAutoLocationIfNeeded(deps.db, user, emails);
  return { user, locations: await listUserLocations(deps.db, user.id) };
}

/** Location role of a Substo user in one location, or null when they are not a member. */
export async function getLocationRole(db: PrismaClient, clerkUserId: string, locationId: string): Promise<LocationRole | null> {
  const user = await db.user.findUnique({
    where: realmClerkIdWhere(REALM, clerkUserId),
    select: {
      locations: { where: { id: locationId, authRealm: REALM }, select: { id: true } },
      locationRoles: { where: { locationId }, select: { role: true } },
    },
  });
  return user?.locations.length === 1 && user.locationRoles.length === 1 ? user.locationRoles[0].role : null;
}

export type TeamResult = { ok: true; message?: string } | { ok: false; error: string };

async function adminCount(db: PrismaClient | Tx, locationId: string) {
  return db.userLocationRole.count({ where: { locationId, role: "ADMIN", user: { locations: { some: { id: locationId } } } } });
}

async function memberOf(db: PrismaClient | Tx, locationId: string, userId: string) {
  const user = await db.user.findFirst({
    where: { id: userId, authRealm: REALM, locations: { some: { id: locationId } } },
    select: { id: true, clerkId: true, locationRoles: { where: { locationId }, select: { role: true } } },
  });
  return user && user.locationRoles.length === 1 ? { id: user.id, clerkId: user.clerkId, role: user.locationRoles[0].role } : null;
}

export type LocationActor = { userId: string; locationId: string; role: LocationRole };

/**
 * Invite someone to a location by email. An existing Substo account with that
 * verified email joins immediately; otherwise Substo's Clerk sends a sign-up
 * invitation and the first sign-in with that verified email claims it.
 */
export async function inviteToLocation(deps: LocationDeps, actor: LocationActor, input: { email: unknown; role: LocationRole; signUpUrl: string }): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can invite people." };
  const email = normalizeInviteEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const existingAccount = await deps.clerk.findUserByEmail(email);
  if (existingAccount && verifiedEmails(existingAccount).includes(email)) {
    const user = await ensureSubstoUser(deps.db, existingAccount);
    if (!user) return { ok: false, error: "That account has no verified email yet." };
    if (await memberOf(deps.db, actor.locationId, user.id)) return { ok: false, error: "This person is already on the team." };
    await deps.db.$transaction(async (tx) => {
      await tx.locationInvitation.upsert({
        where: { locationId_email: { locationId: actor.locationId, email } },
        update: { status: "ACCEPTED", role: input.role, invitedById: actor.userId, acceptedById: user.id, acceptedAt: new Date(), revokedAt: null },
        create: { locationId: actor.locationId, authRealm: REALM, email, role: input.role, status: "ACCEPTED", invitedById: actor.userId, acceptedById: user.id, acceptedAt: new Date() },
      });
      await joinLocation(tx, { userId: user.id, locationId: actor.locationId, role: input.role, invitedById: actor.userId });
    });
    return { ok: true, message: `${email} already has a Substo account and was added to the team.` };
  }

  const previous = await deps.db.locationInvitation.findUnique({ where: { locationId_email: { locationId: actor.locationId, email } } });
  const invitation = await deps.db.locationInvitation.upsert({
    where: { locationId_email: { locationId: actor.locationId, email } },
    update: { status: "PENDING", role: input.role, invitedById: actor.userId, acceptedById: null, acceptedAt: null, revokedAt: null, clerkInvitationId: null },
    create: { locationId: actor.locationId, authRealm: REALM, email, role: input.role, invitedById: actor.userId },
  });
  if (previous?.status === "PENDING" && previous.clerkInvitationId) {
    await deps.clerk.revokeInvitation(previous.clerkInvitationId).catch(() => undefined);
  }
  try {
    const sent = await deps.clerk.createInvitation({ email, redirectUrl: input.signUpUrl, locationInvitationId: invitation.id });
    await deps.db.locationInvitation.update({ where: { id: invitation.id }, data: { clerkInvitationId: sent.id } });
  } catch {
    return { ok: true, message: `Invitation saved, but the email to ${email} could not be sent. They can still sign up with that address.` };
  }
  return { ok: true, message: `Invitation sent to ${email}.` };
}

export async function revokeLocationInvitation(deps: LocationDeps, actor: LocationActor, invitationId: string): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can revoke invitations." };
  const invitation = await deps.db.locationInvitation.findFirst({ where: { id: invitationId, locationId: actor.locationId, status: "PENDING" } });
  if (!invitation) return { ok: false, error: "Invitation not found." };
  await deps.db.locationInvitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  if (invitation.clerkInvitationId) await deps.clerk.revokeInvitation(invitation.clerkInvitationId).catch(() => undefined);
  return { ok: true, message: "Invitation revoked." };
}

export async function changeMemberRole(deps: LocationDeps, actor: LocationActor, targetUserId: string, role: LocationRole): Promise<TeamResult> {
  const target = await memberOf(deps.db, actor.locationId, targetUserId);
  if (!target) return { ok: false, error: "Team member not found." };
  const check = checkTeamChange({ actorRole: actor.role, targetCurrentRole: target.role, change: { kind: "role", role }, adminCount: await adminCount(deps.db, actor.locationId) });
  if (!check.ok) return check;
  await deps.db.userLocationRole.update({ where: { userId_locationId: { userId: target.id, locationId: actor.locationId } }, data: { role: role as UserRole } });
  return { ok: true, message: "Role updated." };
}

export async function removeMember(deps: LocationDeps, actor: LocationActor, targetUserId: string): Promise<TeamResult> {
  const target = await memberOf(deps.db, actor.locationId, targetUserId);
  if (!target) return { ok: false, error: "Team member not found." };
  const check = checkTeamChange({ actorRole: target.id === actor.userId ? "ADMIN" : actor.role, targetCurrentRole: target.role, change: { kind: "remove" }, adminCount: await adminCount(deps.db, actor.locationId) });
  if (!check.ok) return check;
  await deps.db.$transaction(async (tx) => {
    await tx.userLocationRole.deleteMany({ where: { userId: target.id, locationId: actor.locationId } });
    await tx.location.update({ where: { id: actor.locationId }, data: { users: { disconnect: { id: target.id } } } });
  });
  return { ok: true, message: target.id === actor.userId ? "You left the brand." : "Team member removed." };
}

export async function renameLocation(deps: LocationDeps, actor: LocationActor, rawName: unknown): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can rename the brand." };
  const name = normalizeLocationName(rawName);
  if (!name) return { ok: false, error: "Enter a name up to 100 characters." };
  await deps.db.location.update({ where: { id: actor.locationId }, data: { name }, select: { id: true } });
  return { ok: true, message: "Brand renamed." };
}

export async function listLocationTeam(db: PrismaClient, locationId: string) {
  const [members, invitations] = await Promise.all([
    db.user.findMany({
      where: { authRealm: REALM, locations: { some: { id: locationId } }, locationRoles: { some: { locationId } } },
      select: { id: true, email: true, firstName: true, lastName: true, locationRoles: { where: { locationId }, select: { role: true } } },
      orderBy: [{ firstName: "asc" }, { email: "asc" }],
    }),
    db.locationInvitation.findMany({ where: { locationId, status: "PENDING" }, select: { id: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    members: members.map((member) => ({ id: member.id, email: member.email, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email, role: member.locationRoles[0].role })),
    invitations,
  };
}
