import assert from "node:assert/strict";
import test from "node:test";
import type { ActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { getLocationMemberSessions, recordCurrentLocationSession } from "./location-session-access";

function access(locationId: string, role: "ADMIN" | "MEMBER" = "ADMIN"): ActiveContactsAccess {
  return {
    userId: "clerk-actor",
    internalUserId: "actor-user",
    locationId,
    role,
    contactAccessScope: "LOCATION_WIDE",
  };
}

function sessionDependencies(overrides: Record<string, unknown> = {}) {
  return {
    getAuthUserId: async () => "clerk-actor",
    getAccess: async () => access("location-a"),
    findMember: async (targetUserId: string) => ({ id: targetUserId, clerkId: "clerk-target" }),
    findMappings: async () => [{
      clerkSessionId: "session-shared",
      firstSeenAt: new Date("2026-08-01T10:00:00.000Z"),
      lastSeenAt: new Date("2026-08-04T10:00:00.000Z"),
    }],
    getClerkSessions: async () => [{
      id: "session-shared",
      status: "active",
      latestActivity: {
        ipAddress: "203.0.113.42",
        deviceType: "Desktop",
        browserName: "Firefox",
        city: "Nicosia",
        country: "Cyprus",
      },
    }],
    ...overrides,
  };
}

test("unauthenticated and MEMBER actors cannot view team session data", async () => {
  const unauthenticated = await getLocationMemberSessions("target", sessionDependencies({
    getAuthUserId: async () => null,
  }));
  assert.equal(unauthenticated.status, 401);

  const member = await getLocationMemberSessions("target", sessionDependencies({
    getAccess: async () => access("location-a", "MEMBER"),
  }));
  assert.equal(member.status, 403);
  assert.deepEqual(member.body.sessions, []);
});

test("an ADMIN can view only a current member of the server-resolved active location", async () => {
  let resolvedLocation = "";
  const result = await getLocationMemberSessions("member-a", sessionDependencies({
    findMember: async (targetUserId: string, locationId: string) => {
      resolvedLocation = locationId;
      return targetUserId === "member-a" && locationId === "location-a"
        ? { id: targetUserId, clerkId: "clerk-target" }
        : null;
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(resolvedLocation, "location-a");
  assert.equal(result.body.sessions.length, 1);
});

test("a foreign target user returns no session information", async () => {
  let clerkCalled = false;
  const result = await getLocationMemberSessions("foreign-user", sessionDependencies({
    findMember: async () => null,
    getClerkSessions: async () => {
      clerkCalled = true;
      return [];
    },
  }));
  assert.equal(result.status, 404);
  assert.deepEqual(result.body.sessions, []);
  assert.equal(clerkCalled, false);
});

test("a Clerk session is returned only for active locations with a local mapping", async () => {
  const forLocationA = await getLocationMemberSessions("member", sessionDependencies());
  const forLocationB = await getLocationMemberSessions("member", sessionDependencies({
    getAccess: async () => access("location-b"),
    findMappings: async () => [],
  }));
  assert.deepEqual(forLocationA.body.sessions.map((session) => session.id), ["session-shared"]);
  assert.deepEqual(forLocationB.body.sessions, []);
});

test("full IP addresses are never returned in session details", async () => {
  const result = await getLocationMemberSessions("member", sessionDependencies());
  assert.equal(JSON.stringify(result.body).includes("203.0.113.42"), false);
  assert.equal("ipAddress" in result.body.sessions[0], false);
});

test("presence recording derives identifiers from auth and access and is idempotent", async () => {
  const rows = new Set<string>();
  const recorded: Array<{ locationId: string; userId: string; clerkSessionId: string }> = [];
  let notifications = 0;
  let touches = 0;
  const dependencies = {
    getAuth: async () => ({ userId: "clerk-real", sessionId: "session-real" }),
    getAccess: async () => ({ ...access("location-real"), internalUserId: "user-real" }),
    createFirstAccess: async (identity: { locationId: string; userId: string; clerkSessionId: string }) => {
      const key = `${identity.locationId}:${identity.clerkSessionId}`;
      if (rows.has(key)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
      rows.add(key);
      recorded.push(identity);
      notifications += 1;
    },
    touchAccess: async () => { touches += 1; },
  };

  await recordCurrentLocationSession(dependencies);
  await recordCurrentLocationSession(dependencies);

  assert.deepEqual(recorded, [{
    locationId: "location-real",
    userId: "user-real",
    clerkSessionId: "session-real",
  }]);
  assert.equal(rows.size, 1);
  assert.equal(touches, 1);
  assert.equal(notifications, 1);
});

test("Clerk failure returns a non-breaking unavailable state", async () => {
  const result = await getLocationMemberSessions("member", sessionDependencies({
    getClerkSessions: async () => { throw new Error("Clerk unavailable"); },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.unavailable, true);
  assert.equal(result.body.message, "Session details are temporarily unavailable.");
});
