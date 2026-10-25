import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type UserRole } from "@prisma/client";
import { realmClerkIdWhere, type AuthRealm } from "../auth/auth-realm";
import { ensureRealmUser, type RealmUserStore } from "../auth/realm-user-link";
import {
  brandRoleForLegacyStudioRole,
  checkTeamChange,
  defaultBrandName,
  normalizeBrandName,
  normalizeInviteEmail,
  primaryVerifiedEmail,
  studioRoleForBrandRole,
  verifiedEmails,
  type BrandRole,
  type StudioMemberRole,
} from "./brand-policy";

/**
 * Brands (Prisma `Location`) on Substo: sign-in preparation, Studio workspace
 * attachment and team changes. The brand team is the only source of truth;
 * Studio membership rows are a mirror kept in step so that Studio's SQL
 * checks keep enforcing access. Dependencies are injected for tests.
 */

const REALM: AuthRealm = "substo";

export type ClerkIdentity = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddressId: string | null;
  emailAddresses: Array<{ id: string; emailAddress: string; verification?: { status?: string | null } | null }>;
};

/** Substo Studio database operations used by brands. */
export interface StudioBrandPort {
  /** Pre-brand Substo workspaces this Clerk user is a member of. */
  listMemberWorkspaces(clerkUserId: string): Promise<Array<{ id: string; name: string; role: StudioMemberRole }>>;
  listWorkspaceMembers(workspaceId: string): Promise<Array<{ clerkUserId: string; role: StudioMemberRole }>>;
  workspaceExists(workspaceId: string): Promise<boolean>;
  /** Idempotent: creates the workspace with the creator as owner. */
  createWorkspace(workspaceId: string, name: string, creatorClerkUserId: string): Promise<void>;
  renameWorkspace(workspaceId: string, name: string): Promise<void>;
  getMembership(workspaceId: string, clerkUserId: string): Promise<StudioMemberRole | null>;
  upsertMembership(workspaceId: string, clerkUserId: string, role: StudioMemberRole): Promise<void>;
  deleteMembership(workspaceId: string, clerkUserId: string): Promise<void>;
}

/** Substo's Clerk application (never Estio's). */
export interface SubstoClerkPort {
  getUser(clerkUserId: string): Promise<ClerkIdentity | null>;
  findUserByEmail(email: string): Promise<ClerkIdentity | null>;
  createInvitation(input: { email: string; redirectUrl: string; brandInvitationId: string }): Promise<{ id: string }>;
  revokeInvitation(invitationId: string): Promise<void>;
}

export type BrandDeps = { db: PrismaClient; studio: StudioBrandPort; clerk: SubstoClerkPort };

type Tx = Prisma.TransactionClient;

export type BrandMembership = { id: string; name: string; role: BrandRole; studioWorkspaceId: string | null };

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

/** Connect a user to a brand with a role. An existing member keeps their role. */
async function joinBrand(tx: Tx, input: { userId: string; locationId: string; role: BrandRole; invitedById?: string | null }) {
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

/** Brands the user is a member of: connected and holding exactly one role, in this realm only. */
export async function listUserBrands(db: PrismaClient, userId: string): Promise<BrandMembership[]> {
  const user = await db.user.findFirst({
    where: { id: userId, authRealm: REALM },
    select: {
      locations: { where: { authRealm: REALM }, select: { id: true, name: true, studioWorkspaceId: true } },
      locationRoles: { where: { location: { authRealm: REALM } }, select: { locationId: true, role: true } },
    },
  });
  if (!user) return [];
  return user.locations.flatMap((location) => {
    const roles = user.locationRoles.filter((role) => role.locationId === location.id);
    return roles.length === 1 ? [{ id: location.id, name: location.name || "Untitled brand", role: roles[0].role, studioWorkspaceId: location.studioWorkspaceId }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Accept every pending invitation addressed to one of the user's verified emails. */
export async function claimPendingInvitations(db: PrismaClient, userId: string, emails: string[]): Promise<number> {
  if (emails.length === 0) return 0;
  const invitations = await db.brandInvitation.findMany({
    where: { authRealm: REALM, status: "PENDING", email: { in: emails }, location: { authRealm: REALM } },
    select: { id: true, locationId: true, role: true, invitedById: true },
  });
  let claimed = 0;
  for (const invitation of invitations) {
    await db.$transaction(async (tx) => {
      const accepted = await tx.brandInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedById: userId, acceptedAt: new Date() },
      });
      if (accepted.count !== 1) return;
      await joinBrand(tx, { userId, locationId: invitation.locationId, role: invitation.role, invitedById: invitation.invitedById });
      claimed += 1;
    });
  }
  return claimed;
}

/**
 * Turn pre-brand Substo Studio workspaces into brands. The first member to
 * sign in adopts a workspace: one brand is created for it and all its current
 * Studio members are imported once. Afterwards the brand team alone decides.
 */
export async function adoptLegacyWorkspaces(deps: BrandDeps, clerkUserId: string): Promise<number> {
  const workspaces = await deps.studio.listMemberWorkspaces(clerkUserId);
  let adopted = 0;
  for (const workspace of workspaces) {
    if (await deps.db.location.findUnique({ where: { studioWorkspaceId: workspace.id }, select: { id: true } })) continue;
    const members = await deps.studio.listWorkspaceMembers(workspace.id);
    const resolved: Array<{ userId: string; role: BrandRole }> = [];
    for (const member of members) {
      const identity = await deps.clerk.getUser(member.clerkUserId);
      const user = identity ? await ensureSubstoUser(deps.db, identity) : null;
      if (user) resolved.push({ userId: user.id, role: brandRoleForLegacyStudioRole(member.role) });
    }
    if (!resolved.some((member) => member.role === "ADMIN")) continue;
    try {
      await deps.db.$transaction(async (tx) => {
        const brand = await tx.location.create({
          data: { authRealm: REALM, name: workspace.name, studioWorkspaceId: workspace.id },
          select: { id: true },
        });
        for (const member of resolved) await joinBrand(tx, { userId: member.userId, locationId: brand.id, role: member.role });
      });
      adopted += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error; // adopted concurrently by another member
    }
  }
  return adopted;
}

/**
 * Create the user's brand at their first sign-in. It happens at most once per
 * user, and not when an invitation is waiting for or was accepted by them.
 */
export async function createAutoBrandIfNeeded(db: PrismaClient, user: { id: string; firstName: string | null; email: string }, emails: string[]) {
  if ((await listUserBrands(db, user.id)).length > 0) return null;
  const invited = await db.brandInvitation.count({ where: { authRealm: REALM, email: { in: emails }, status: { in: ["PENDING", "ACCEPTED"] } } });
  if (invited > 0) return null;
  try {
    return await db.$transaction(async (tx) => {
      const brand = await tx.location.create({
        data: { authRealm: REALM, name: defaultBrandName(user), autoCreatedForUserId: user.id },
        select: { id: true },
      });
      await joinBrand(tx, { userId: user.id, locationId: brand.id, role: "ADMIN" });
      return brand.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) return null; // created before (and possibly left since)
    throw error;
  }
}

/** Everything that happens when a user arrives on Substo: user, invitations, adoption, auto brand. */
export async function prepareSubstoSignIn(deps: BrandDeps, identity: ClerkIdentity) {
  const user = await ensureSubstoUser(deps.db, identity);
  if (!user) return null;
  const emails = verifiedEmails(identity);
  await claimPendingInvitations(deps.db, user.id, emails);
  await adoptLegacyWorkspaces(deps, identity.id);
  await createAutoBrandIfNeeded(deps.db, user, emails);
  return { user, brands: await listUserBrands(deps.db, user.id) };
}

/** Attach (once) and return the Studio workspace of a Substo brand. */
export async function ensureBrandWorkspace(deps: BrandDeps, brand: { id: string; name: string | null }, actorClerkUserId: string): Promise<string> {
  const current = await deps.db.location.findFirst({ where: { id: brand.id, authRealm: REALM }, select: { studioWorkspaceId: true } });
  if (!current) throw new Error("Brand not found.");
  let workspaceId = current.studioWorkspaceId;
  if (!workspaceId) {
    const candidate = randomUUID();
    const reserved = await deps.db.location.updateMany({ where: { id: brand.id, studioWorkspaceId: null }, data: { studioWorkspaceId: candidate } });
    workspaceId = reserved.count === 1
      ? candidate
      : (await deps.db.location.findUniqueOrThrow({ where: { id: brand.id }, select: { studioWorkspaceId: true } })).studioWorkspaceId;
    if (!workspaceId) throw new Error("Studio workspace could not be reserved.");
  }
  if (!(await deps.studio.workspaceExists(workspaceId))) {
    try {
      await deps.studio.createWorkspace(workspaceId, brand.name?.trim() || "Studio", actorClerkUserId);
    } catch (error) {
      if (!(await deps.studio.workspaceExists(workspaceId))) throw error; // created concurrently otherwise
    }
  }
  return workspaceId;
}

/** Brand role of a Substo user in one brand, or null when they are not a member. */
export async function getBrandRole(db: PrismaClient, clerkUserId: string, locationId: string): Promise<BrandRole | null> {
  const user = await db.user.findUnique({
    where: realmClerkIdWhere(REALM, clerkUserId),
    select: {
      locations: { where: { id: locationId, authRealm: REALM }, select: { id: true } },
      locationRoles: { where: { locationId }, select: { role: true } },
    },
  });
  return user?.locations.length === 1 && user.locationRoles.length === 1 ? user.locationRoles[0].role : null;
}

/** Make the Studio membership mirror the brand role (or remove it). Returns the Studio role. */
export async function syncStudioMembership(studio: StudioBrandPort, workspaceId: string, clerkUserId: string, role: BrandRole | null): Promise<StudioMemberRole | null> {
  const current = await studio.getMembership(workspaceId, clerkUserId);
  if (!role) {
    if (current) await studio.deleteMembership(workspaceId, clerkUserId);
    return null;
  }
  const desired = studioRoleForBrandRole(role, current);
  if (desired !== current) await studio.upsertMembership(workspaceId, clerkUserId, desired);
  return desired;
}

/** Resolve Studio access to a Substo brand workspace from the brand team. */
export async function resolveBrandWorkspaceAccess(deps: BrandDeps, workspaceId: string, clerkUserId: string) {
  const brand = await deps.db.location.findFirst({ where: { studioWorkspaceId: workspaceId, authRealm: REALM }, select: { id: true, name: true } });
  if (!brand) return null;
  const brandRole = await getBrandRole(deps.db, clerkUserId, brand.id);
  const studioRole = await syncStudioMembership(deps.studio, workspaceId, clerkUserId, brandRole);
  return brandRole && studioRole ? { brand, brandRole, studioRole } : null;
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

export type BrandActor = { userId: string; locationId: string; role: BrandRole };

/**
 * Invite someone to a brand by email. An existing Substo account with that
 * verified email joins immediately; otherwise Substo's Clerk sends a sign-up
 * invitation and the first sign-in with that verified email claims it.
 */
export async function inviteToBrand(deps: BrandDeps, actor: BrandActor, input: { email: unknown; role: BrandRole; signUpUrl: string }): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can invite people." };
  const email = normalizeInviteEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const existingAccount = await deps.clerk.findUserByEmail(email);
  if (existingAccount && verifiedEmails(existingAccount).includes(email)) {
    const user = await ensureSubstoUser(deps.db, existingAccount);
    if (!user) return { ok: false, error: "That account has no verified email yet." };
    if (await memberOf(deps.db, actor.locationId, user.id)) return { ok: false, error: "This person is already on the team." };
    await deps.db.$transaction(async (tx) => {
      await tx.brandInvitation.upsert({
        where: { locationId_email: { locationId: actor.locationId, email } },
        update: { status: "ACCEPTED", role: input.role, invitedById: actor.userId, acceptedById: user.id, acceptedAt: new Date(), revokedAt: null },
        create: { locationId: actor.locationId, authRealm: REALM, email, role: input.role, status: "ACCEPTED", invitedById: actor.userId, acceptedById: user.id, acceptedAt: new Date() },
      });
      await joinBrand(tx, { userId: user.id, locationId: actor.locationId, role: input.role, invitedById: actor.userId });
    });
    return { ok: true, message: `${email} already has a Substo account and was added to the team.` };
  }

  const previous = await deps.db.brandInvitation.findUnique({ where: { locationId_email: { locationId: actor.locationId, email } } });
  const invitation = await deps.db.brandInvitation.upsert({
    where: { locationId_email: { locationId: actor.locationId, email } },
    update: { status: "PENDING", role: input.role, invitedById: actor.userId, acceptedById: null, acceptedAt: null, revokedAt: null, clerkInvitationId: null },
    create: { locationId: actor.locationId, authRealm: REALM, email, role: input.role, invitedById: actor.userId },
  });
  if (previous?.status === "PENDING" && previous.clerkInvitationId) {
    await deps.clerk.revokeInvitation(previous.clerkInvitationId).catch(() => undefined);
  }
  try {
    const sent = await deps.clerk.createInvitation({ email, redirectUrl: input.signUpUrl, brandInvitationId: invitation.id });
    await deps.db.brandInvitation.update({ where: { id: invitation.id }, data: { clerkInvitationId: sent.id } });
  } catch {
    return { ok: true, message: `Invitation saved, but the email to ${email} could not be sent. They can still sign up with that address.` };
  }
  return { ok: true, message: `Invitation sent to ${email}.` };
}

export async function revokeBrandInvitation(deps: BrandDeps, actor: BrandActor, invitationId: string): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can revoke invitations." };
  const invitation = await deps.db.brandInvitation.findFirst({ where: { id: invitationId, locationId: actor.locationId, status: "PENDING" } });
  if (!invitation) return { ok: false, error: "Invitation not found." };
  await deps.db.brandInvitation.update({ where: { id: invitation.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  if (invitation.clerkInvitationId) await deps.clerk.revokeInvitation(invitation.clerkInvitationId).catch(() => undefined);
  return { ok: true, message: "Invitation revoked." };
}

/** Studio is updated first, so a failure leaves the brand team (the source of truth) unchanged. */
export async function changeMemberRole(deps: BrandDeps, actor: BrandActor, targetUserId: string, role: BrandRole): Promise<TeamResult> {
  const target = await memberOf(deps.db, actor.locationId, targetUserId);
  if (!target) return { ok: false, error: "Team member not found." };
  const check = checkTeamChange({ actorRole: actor.role, targetCurrentRole: target.role, change: { kind: "role", role }, adminCount: await adminCount(deps.db, actor.locationId) });
  if (!check.ok) return check;
  const workspaceId = (await deps.db.location.findUnique({ where: { id: actor.locationId }, select: { studioWorkspaceId: true } }))?.studioWorkspaceId;
  if (workspaceId && target.clerkId && await deps.studio.workspaceExists(workspaceId)) {
    await syncStudioMembership(deps.studio, workspaceId, target.clerkId, role);
  }
  await deps.db.userLocationRole.update({ where: { userId_locationId: { userId: target.id, locationId: actor.locationId } }, data: { role: role as UserRole } });
  return { ok: true, message: "Role updated." };
}

export async function removeMember(deps: BrandDeps, actor: BrandActor, targetUserId: string): Promise<TeamResult> {
  const target = await memberOf(deps.db, actor.locationId, targetUserId);
  if (!target) return { ok: false, error: "Team member not found." };
  const check = checkTeamChange({ actorRole: target.id === actor.userId ? "ADMIN" : actor.role, targetCurrentRole: target.role, change: { kind: "remove" }, adminCount: await adminCount(deps.db, actor.locationId) });
  if (!check.ok) return check;
  const workspaceId = (await deps.db.location.findUnique({ where: { id: actor.locationId }, select: { studioWorkspaceId: true } }))?.studioWorkspaceId;
  if (workspaceId && target.clerkId) await syncStudioMembership(deps.studio, workspaceId, target.clerkId, null);
  await deps.db.$transaction(async (tx) => {
    await tx.userLocationRole.deleteMany({ where: { userId: target.id, locationId: actor.locationId } });
    await tx.location.update({ where: { id: actor.locationId }, data: { users: { disconnect: { id: target.id } } } });
  });
  return { ok: true, message: target.id === actor.userId ? "You left the brand." : "Team member removed." };
}

export async function renameBrand(deps: BrandDeps, actor: BrandActor, rawName: unknown): Promise<TeamResult> {
  if (actor.role !== "ADMIN") return { ok: false, error: "Only brand admins can rename the brand." };
  const name = normalizeBrandName(rawName);
  if (!name) return { ok: false, error: "Enter a name up to 100 characters." };
  const brand = await deps.db.location.update({ where: { id: actor.locationId }, data: { name }, select: { studioWorkspaceId: true } });
  if (brand.studioWorkspaceId && await deps.studio.workspaceExists(brand.studioWorkspaceId)) {
    await deps.studio.renameWorkspace(brand.studioWorkspaceId, name).catch(() => undefined);
  }
  return { ok: true, message: "Brand renamed." };
}

export async function listBrandTeam(db: PrismaClient, locationId: string) {
  const [members, invitations] = await Promise.all([
    db.user.findMany({
      where: { authRealm: REALM, locations: { some: { id: locationId } }, locationRoles: { some: { locationId } } },
      select: { id: true, email: true, firstName: true, lastName: true, locationRoles: { where: { locationId }, select: { role: true } } },
      orderBy: [{ firstName: "asc" }, { email: "asc" }],
    }),
    db.brandInvitation.findMany({ where: { locationId, status: "PENDING" }, select: { id: true, email: true, role: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    members: members.map((member) => ({ id: member.id, email: member.email, name: [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email, role: member.locationRoles[0].role })),
    invitations,
  };
}
