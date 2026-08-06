import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { extractImpersonationClaim, identitiesAgree, type ActorClaim } from "@/lib/auth/impersonation-policy";

export const ACTOR_TOKEN_TTL_SECONDS = 5 * 60;
export const IMPERSONATION_SESSION_MAX_SECONDS = 8 * 60 * 60;
const MASTER_LOGIN_AUDIT_REASON = "Master user login";

type AuthState = {
  userId: string | null;
  sessionId: string | null;
  actor: ActorClaim;
};

export type ImpersonationContext = {
  auditId: string;
  actorClerkId: string;
  targetClerkId: string;
  targetUserId: string;
  targetName: string;
  targetEmail: string;
  locationId: string;
  locationName: string;
  reason: string;
  sessionId: string;
  sessionExpiresAt: Date;
};

function primaryEmail(user: { primaryEmailAddressId: string | null; emailAddresses: Array<{ id: string; emailAddress: string }> }): string | null {
  return user.emailAddresses.find((entry) => entry.id === user.primaryEmailAddressId)?.emailAddress ?? null;
}

function displayName(user: { firstName: string | null; lastName: string | null; email: string }): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

export async function startImpersonation(input: { targetUserId: string; locationId: string }) {
  const authState = await auth();
  if (!authState.userId || authState.actor) throw new Error("Not authorized to use master login.");

  const [actor, target] = await Promise.all([
    db.user.findUnique({
      where: { clerkId: authState.userId },
      select: { id: true, clerkId: true, email: true, platformRole: true },
    }),
    db.user.findUnique({
      where: { id: String(input.targetUserId || "").trim() },
      select: {
        id: true, clerkId: true, email: true, firstName: true, lastName: true,
        locations: { where: { id: String(input.locationId || "").trim() }, select: { id: true, name: true } },
        locationRoles: { where: { locationId: String(input.locationId || "").trim() }, select: { locationId: true } },
      },
    }),
  ]);
  if (!actor || actor.platformRole !== "PLATFORM_ADMIN" || !actor.clerkId || !target?.clerkId) {
    throw new Error("Not authorized to use master login.");
  }
  if (actor.id === target.id || actor.clerkId === target.clerkId) throw new Error("You cannot impersonate your own account.");
  if (target.locations.length !== 1 || target.locationRoles.length !== 1) {
    throw new Error("The selected user is not an active member of this location.");
  }

  const clerk = await clerkClient();
  const [clerkActor, clerkTarget] = await Promise.all([
    clerk.users.getUser(actor.clerkId),
    clerk.users.getUser(target.clerkId),
  ]);
  if (!identitiesAgree({ authenticatedClerkId: authState.userId, localClerkId: actor.clerkId, localEmail: actor.email, clerkEmail: primaryEmail(clerkActor) })) {
    throw new Error("The platform administrator identity does not match Clerk.");
  }
  if (!identitiesAgree({ authenticatedClerkId: target.clerkId, localClerkId: target.clerkId, localEmail: target.email, clerkEmail: primaryEmail(clerkTarget) })) {
    throw new Error("The target identity does not match Clerk.");
  }

  const now = Date.now();
  const tokenExpiresAt = new Date(now + ACTOR_TOKEN_TTL_SECONDS * 1000);
  const sessionExpiresAt = new Date(now + IMPERSONATION_SESSION_MAX_SECONDS * 1000);
  const audit = await db.impersonationAudit.create({
    data: {
      actorUserId: actor.id,
      targetUserId: target.id,
      actorClerkId: actor.clerkId,
      targetClerkId: target.clerkId,
      locationId: target.locations[0].id,
      reason: MASTER_LOGIN_AUDIT_REASON,
      tokenExpiresAt,
      sessionExpiresAt,
    },
    select: { id: true },
  });

  let actorTokenId: string | null = null;
  try {
    const actorToken = await clerk.actorTokens.create({
      userId: target.clerkId,
      actor: { sub: actor.clerkId, additionalProperties: { auditId: audit.id, locationId: target.locations[0].id } },
      expiresInSeconds: ACTOR_TOKEN_TTL_SECONDS,
      sessionMaxDurationInSeconds: IMPERSONATION_SESSION_MAX_SECONDS,
    });
    actorTokenId = actorToken.id;
    if (!actorToken.url) throw new Error("Clerk did not return a master login URL.");
    await db.impersonationAudit.update({ where: { id: audit.id }, data: { clerkActorTokenId: actorToken.id } });

    const launchUrl = new URL(actorToken.url);
    launchUrl.searchParams.set("redirect_url", "/admin");
    return { auditId: audit.id, launchUrl: launchUrl.toString(), expiresAt: tokenExpiresAt.toISOString() };
  } catch (error) {
    if (actorTokenId) await clerk.actorTokens.revoke(actorTokenId).catch(() => undefined);
    await db.impersonationAudit.update({
      where: { id: audit.id },
      data: { status: "FAILED", endedAt: new Date(), endReason: "Actor token creation failed" },
    }).catch(() => undefined);
    throw error;
  }
}

export async function getImpersonationContextFromAuth(authState: AuthState): Promise<ImpersonationContext | null> {
  const claim = extractImpersonationClaim(authState.actor);
  if (!authState.userId || !authState.sessionId || !claim) return null;
  const audit = await db.impersonationAudit.findFirst({
    where: {
      id: claim.auditId,
      actorClerkId: claim.actorClerkId,
      targetClerkId: authState.userId,
      locationId: claim.locationId,
      status: { in: ["PENDING", "ACTIVE"] },
    },
    select: {
      id: true, actorClerkId: true, targetClerkId: true, targetUserId: true, locationId: true,
      reason: true, sessionExpiresAt: true,
      actor: { select: { clerkId: true, platformRole: true } },
      target: {
        select: {
          id: true, clerkId: true, email: true, firstName: true, lastName: true,
          locations: { where: { id: claim.locationId }, select: { id: true } },
          locationRoles: { where: { locationId: claim.locationId }, select: { locationId: true } },
        },
      },
      location: { select: { id: true, name: true } },
    },
  });
  if (!audit) return null;
  if (audit.sessionExpiresAt.getTime() <= Date.now()) {
    await db.impersonationAudit.updateMany({
      where: { id: audit.id, status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "EXPIRED", endedAt: new Date(), endReason: "Session expired" },
    });
    return null;
  }
  if (
    audit.actor.clerkId !== claim.actorClerkId
    || audit.actor.platformRole !== "PLATFORM_ADMIN"
    || audit.target.id !== audit.targetUserId
    || audit.target.clerkId !== authState.userId
    || audit.target.locations.length !== 1
    || audit.target.locationRoles.length !== 1
    || audit.location.id !== claim.locationId
  ) return null;

  return {
    auditId: audit.id,
    actorClerkId: audit.actorClerkId,
    targetClerkId: audit.targetClerkId,
    targetUserId: audit.targetUserId,
    targetName: displayName(audit.target),
    targetEmail: audit.target.email,
    locationId: audit.locationId,
    locationName: audit.location.name || "Unnamed location",
    reason: audit.reason,
    sessionId: authState.sessionId,
    sessionExpiresAt: audit.sessionExpiresAt,
  };
}

export async function getCurrentImpersonationContext(): Promise<ImpersonationContext | null> {
  const state = await auth();
  return getImpersonationContextFromAuth({ userId: state.userId, sessionId: state.sessionId, actor: state.actor });
}

export async function activateCurrentImpersonation(): Promise<ImpersonationContext> {
  const context = await getCurrentImpersonationContext();
  if (!context) throw new Error("Master login is invalid or expired.");
  await db.impersonationAudit.updateMany({
    where: { id: context.auditId, status: "PENDING" },
    data: { status: "ACTIVE", activatedAt: new Date(), targetSessionId: context.sessionId },
  });
  await db.impersonationAudit.updateMany({
    where: { id: context.auditId, status: "ACTIVE", targetSessionId: null },
    data: { targetSessionId: context.sessionId },
  });
  return context;
}

export async function endCurrentImpersonation(): Promise<void> {
  const state = await auth();
  const claim = extractImpersonationClaim(state.actor);
  if (!state.actor || !state.sessionId) throw new Error("Master login is invalid or already ended.");
  const audit = claim ? await db.impersonationAudit.findFirst({
    where: { id: claim.auditId, actorClerkId: claim.actorClerkId, targetClerkId: state.userId || undefined },
    select: { id: true, clerkActorTokenId: true },
  }) : null;
  if (audit) {
    await db.impersonationAudit.updateMany({
      where: { id: audit.id, status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "ENDED", endedAt: new Date(), endReason: "Master user ended the user session" },
    });
  }
  const clerk = await clerkClient();
  let revokedAt: Date | undefined;
  if (audit?.clerkActorTokenId) {
    const revoked = await clerk.actorTokens.revoke(audit.clerkActorTokenId).then(() => true).catch(() => false);
    if (revoked) revokedAt = new Date();
  }
  await clerk.sessions.revokeSession(state.sessionId).catch(() => undefined);
  if (audit && revokedAt) await db.impersonationAudit.update({ where: { id: audit.id }, data: { revokedAt } });
}
