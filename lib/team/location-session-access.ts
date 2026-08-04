import { auth, clerkClient } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getActiveContactsAccess, type ActiveContactsAccess } from "@/lib/contacts/active-location-access";

const TEAM_SESSIONS_UNAVAILABLE = "Session details are temporarily unavailable.";

type AuthState = { userId: string | null; sessionId: string | null };
type PresenceIdentity = { locationId: string; userId: string; clerkSessionId: string };

type PresenceDependencies = {
  getAuth: () => Promise<AuthState>;
  getAccess: (clerkUserId: string) => Promise<ActiveContactsAccess | null>;
  createFirstAccess: (identity: PresenceIdentity) => Promise<void>;
  touchAccess: (identity: PresenceIdentity) => Promise<void>;
};

export type LocationSessionDetail = {
  id: string;
  deviceType: string;
  browser: string;
  city: string;
  country: string;
  firstSeenAt: string;
  lastSeenAt: string;
  status: string;
};

type SessionDependencies = {
  getAuthUserId: () => Promise<string | null>;
  getAccess: (clerkUserId: string) => Promise<ActiveContactsAccess | null>;
  findMember: (targetUserId: string, locationId: string) => Promise<{ id: string; clerkId: string | null } | null>;
  findMappings: (targetUserId: string, locationId: string) => Promise<Array<{
    clerkSessionId: string;
    firstSeenAt: Date;
    lastSeenAt: Date;
  }>>;
  getClerkSessions: (clerkUserId: string) => Promise<Array<{
    id: string;
    status: string;
    latestActivity?: {
      ipAddress?: string;
      deviceType?: string;
      browserName?: string;
      city?: string;
      country?: string;
    };
  }>>;
};

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function createFirstAccess(identity: PresenceIdentity): Promise<void> {
  await db.$transaction(async (transaction) => {
    const location = await transaction.location.findUnique({
      where: { id: identity.locationId },
      select: { name: true },
    });
    const locationName = location?.name || "this location";

    await transaction.locationSessionActivity.create({ data: identity });
    await transaction.userNotification.create({
      data: {
        userId: identity.userId,
        locationId: identity.locationId,
        type: "security_location_session",
        title: `New device used with ${locationName}`,
        body: `A device signed in to Estio accessed ${locationName}. Review location access and sessions in Team Management.`,
        deepLinkUrl: "/admin/team",
        payload: { locationId: identity.locationId },
      },
    });
  });
}

async function touchAccess(identity: PresenceIdentity): Promise<void> {
  await db.locationSessionActivity.update({
    where: {
      locationId_clerkSessionId: {
        locationId: identity.locationId,
        clerkSessionId: identity.clerkSessionId,
      },
    },
    data: { lastSeenAt: new Date() },
  });
}

const defaultPresenceDependencies: PresenceDependencies = {
  getAuth: async () => {
    const state = await auth();
    return { userId: state.userId, sessionId: state.sessionId };
  },
  getAccess: (clerkUserId) => getActiveContactsAccess(null, {
    getAuthUserId: async () => clerkUserId,
  }),
  createFirstAccess,
  touchAccess,
};

export async function recordCurrentLocationSession(
  dependencies: PresenceDependencies = defaultPresenceDependencies,
): Promise<{ status: number; body: { ok: boolean } }> {
  const { userId, sessionId } = await dependencies.getAuth();
  if (!userId || !sessionId) return { status: 401, body: { ok: false } };

  const access = await dependencies.getAccess(userId);
  if (!access) return { status: 403, body: { ok: false } };

  const identity = {
    locationId: access.locationId,
    userId: access.internalUserId,
    clerkSessionId: sessionId,
  };

  try {
    await dependencies.createFirstAccess(identity);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    await dependencies.touchAccess(identity);
  }

  return { status: 200, body: { ok: true } };
}

const defaultSessionDependencies: SessionDependencies = {
  getAuthUserId: async () => (await auth()).userId,
  getAccess: (clerkUserId) => getActiveContactsAccess(null, {
    getAuthUserId: async () => clerkUserId,
  }),
  findMember: (targetUserId, locationId) => db.user.findFirst({
    where: {
      id: targetUserId,
      locations: { some: { id: locationId } },
      locationRoles: { some: { locationId } },
    },
    select: { id: true, clerkId: true },
  }),
  findMappings: (targetUserId, locationId) => db.locationSessionActivity.findMany({
    where: { userId: targetUserId, locationId },
    select: { clerkSessionId: true, firstSeenAt: true, lastSeenAt: true },
    orderBy: { lastSeenAt: "desc" },
  }),
  getClerkSessions: async (clerkUserId) => {
    const client = await clerkClient();
    const response = await client.sessions.getSessionList({ userId: clerkUserId, limit: 100 });
    return response.data;
  },
};

export async function getLocationMemberSessions(
  targetUserId: string,
  dependencies: SessionDependencies = defaultSessionDependencies,
): Promise<{
  status: number;
  body: { sessions: LocationSessionDetail[]; unavailable: boolean; message?: string };
}> {
  const clerkUserId = await dependencies.getAuthUserId();
  if (!clerkUserId) return { status: 401, body: { sessions: [], unavailable: false } };

  const access = await dependencies.getAccess(clerkUserId);
  if (!access || access.role !== "ADMIN") {
    return { status: 403, body: { sessions: [], unavailable: false } };
  }

  const member = await dependencies.findMember(targetUserId, access.locationId);
  if (!member?.clerkId) return { status: 404, body: { sessions: [], unavailable: false } };

  const mappings = await dependencies.findMappings(member.id, access.locationId);
  if (mappings.length === 0) return { status: 200, body: { sessions: [], unavailable: false } };

  try {
    const clerkSessions = await dependencies.getClerkSessions(member.clerkId);
    const sessionsById = new Map(clerkSessions.map((session) => [session.id, session]));
    const sessions = mappings.flatMap((mapping): LocationSessionDetail[] => {
      const session = sessionsById.get(mapping.clerkSessionId);
      if (!session) return [];
      return [{
        id: session.id,
        deviceType: session.latestActivity?.deviceType || "Unknown device",
        browser: session.latestActivity?.browserName || "Unknown browser",
        city: session.latestActivity?.city || "Unknown city",
        country: session.latestActivity?.country || "Unknown country",
        firstSeenAt: mapping.firstSeenAt.toISOString(),
        lastSeenAt: mapping.lastSeenAt.toISOString(),
        status: session.status,
      }];
    });
    return { status: 200, body: { sessions, unavailable: false } };
  } catch {
    return {
      status: 200,
      body: { sessions: [], unavailable: true, message: TEAM_SESSIONS_UNAVAILABLE },
    };
  }
}
