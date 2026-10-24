import assert from "node:assert/strict";
import test, { after } from "node:test";
import { PrismaClient } from "@prisma/client";
import type { StudioMemberRole } from "./brand-policy";
import {
  changeMemberRole,
  ensureBrandWorkspace,
  inviteToBrand,
  listUserBrands,
  prepareSubstoSignIn,
  removeMember,
  resolveBrandWorkspaceAccess,
  type BrandDeps,
  type ClerkIdentity,
  type StudioBrandPort,
  type SubstoClerkPort,
} from "./brand-service";

// Runs only from scripts/test-user-auth-realm-db.sh against its disposable cluster.
const databaseUrl = process.env.BRANDS_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("BRANDS_TEST_DATABASE_URL is required; use bash scripts/test-user-auth-realm-db.sh");
const parsed = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || parsed.pathname !== "/estio_user_auth_realm_test") {
  throw new Error("Brand database tests only run against the disposable estio_user_auth_realm_test database");
}

const db = new PrismaClient({ datasourceUrl: databaseUrl });
after(() => db.$disconnect());
const quiet = () => { const original = console.log; console.log = () => undefined; return () => { console.log = original; }; };
const restoreLog = quiet();
after(restoreLog);

let sequence = 0;
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(sequence += 1)}`;

function identity(email: string, options: { verified?: boolean; firstName?: string } = {}): ClerkIdentity {
  const id = unique("user");
  return {
    id,
    firstName: options.firstName ?? null,
    lastName: null,
    primaryEmailAddressId: `${id}-email`,
    emailAddresses: [{ id: `${id}-email`, emailAddress: email, verification: { status: options.verified === false ? "unverified" : "verified" } }],
  };
}

function fakeStudio() {
  const workspaces = new Map<string, { name: string; members: Map<string, StudioMemberRole> }>();
  const port: StudioBrandPort = {
    listMemberWorkspaces: async (clerkUserId) => [...workspaces].flatMap(([id, ws]) => ws.members.has(clerkUserId) ? [{ id, name: ws.name, role: ws.members.get(clerkUserId)! }] : []),
    listWorkspaceMembers: async (id) => [...(workspaces.get(id)?.members ?? [])].map(([clerkUserId, role]) => ({ clerkUserId, role })),
    workspaceExists: async (id) => workspaces.has(id),
    createWorkspace: async (id, name, creator) => { if (!workspaces.has(id)) workspaces.set(id, { name, members: new Map([[creator, "owner"]]) }); },
    renameWorkspace: async (id, name) => { const ws = workspaces.get(id); if (ws) ws.name = name; },
    getMembership: async (id, clerkUserId) => workspaces.get(id)?.members.get(clerkUserId) ?? null,
    upsertMembership: async (id, clerkUserId, role) => { workspaces.get(id)!.members.set(clerkUserId, role); },
    deleteMembership: async (id, clerkUserId) => { workspaces.get(id)?.members.delete(clerkUserId); },
  };
  return { workspaces, port };
}

function fakeClerk(accounts: ClerkIdentity[] = []) {
  const invitations: Array<{ id: string; email: string; brandInvitationId: string; revoked: boolean }> = [];
  const port: SubstoClerkPort = {
    getUser: async (id) => accounts.find((account) => account.id === id) ?? null,
    findUserByEmail: async (email) => accounts.find((account) => account.emailAddresses.some((entry) => entry.emailAddress === email)) ?? null,
    createInvitation: async ({ email, brandInvitationId }) => { const id = unique("inv"); invitations.push({ id, email, brandInvitationId, revoked: false }); return { id }; },
    revokeInvitation: async (id) => { const found = invitations.find((invitation) => invitation.id === id); if (found) found.revoked = true; },
  };
  return { accounts, invitations, port };
}

function deps(studio = fakeStudio(), clerk = fakeClerk()): BrandDeps & { fakes: { studio: ReturnType<typeof fakeStudio>; clerk: ReturnType<typeof fakeClerk> } } {
  return { db, studio: studio.port, clerk: clerk.port, fakes: { studio, clerk } };
}

const actorFor = async (userId: string, locationId: string) => {
  const role = await db.userLocationRole.findUniqueOrThrow({ where: { userId_locationId: { userId, locationId } } });
  return { userId, locationId, role: role.role };
};

test("first Substo sign-in creates exactly one brand, even when requests race", async () => {
  const context = deps();
  const person = identity(`${unique("first")}@example.com`, { firstName: "Ada" });
  const [one, two] = await Promise.all([prepareSubstoSignIn(context, person), prepareSubstoSignIn(context, person)]);
  const again = await prepareSubstoSignIn(context, person);
  for (const result of [one, two, again]) {
    assert.equal(result?.brands.length, 1);
    assert.equal(result?.brands[0].role, "ADMIN");
    assert.equal(result?.brands[0].name, "Ada's brand");
  }
  assert.equal(await db.location.count({ where: { autoCreatedForUserId: one!.user.id } }), 1);
  const brand = await db.location.findUniqueOrThrow({ where: { id: one!.brands[0].id } });
  assert.equal(brand.authRealm, "substo");
});

test("an Estio user with the same email keeps their own user and brands", async () => {
  const email = `${unique("shared")}@example.com`;
  const estioUser = await db.user.create({ data: { email, clerkId: unique("user_estio"), authRealm: "estio" } });
  const estioBrand = await db.location.create({ data: { name: "Estio agency", users: { connect: { id: estioUser.id } } } });
  await db.userLocationRole.create({ data: { userId: estioUser.id, locationId: estioBrand.id, role: "ADMIN" } });

  const result = await prepareSubstoSignIn(deps(), identity(email));
  assert.ok(result);
  assert.notEqual(result.user.id, estioUser.id);
  assert.equal(result.user.authRealm, "substo");
  assert.ok(result.brands.every((brand) => brand.id !== estioBrand.id));
  const estio = await db.user.findUniqueOrThrow({ where: { id: estioUser.id }, include: { locations: true } });
  assert.deepEqual(estio.locations.map((location) => location.id), [estioBrand.id]);
  await assert.rejects(
    db.location.update({ where: { id: estioBrand.id }, data: { users: { connect: { id: result.user.id } } } }),
    /different apps/,
  );
});

test("an invitation is claimed by the invited verified email, once, without an extra brand", async () => {
  const context = deps();
  const admin = await prepareSubstoSignIn(context, identity(`${unique("admin")}@example.com`));
  const brandId = admin!.brands[0].id;
  const email = `${unique("invitee")}@example.com`;
  const sent = await inviteToBrand(context, await actorFor(admin!.user.id, brandId), { email: email.toUpperCase(), role: "MEMBER", signUpUrl: "https://substo.example/sign-up" });
  assert.equal(sent.ok, true);
  assert.equal(context.fakes.clerk.invitations.length, 1);
  assert.equal((await db.brandInvitation.findFirstOrThrow({ where: { locationId: brandId } })).status, "PENDING");

  const unverified = await prepareSubstoSignIn(context, identity(email, { verified: false }));
  assert.equal(unverified, null);

  const invitee = identity(email);
  const joined = await prepareSubstoSignIn(context, invitee);
  assert.deepEqual(joined!.brands.map((brand) => [brand.id, brand.role]), [[brandId, "MEMBER"]]);
  const again = await prepareSubstoSignIn(context, invitee);
  assert.equal(again!.brands.length, 1);
  assert.equal((await db.brandInvitation.findFirstOrThrow({ where: { locationId: brandId } })).status, "ACCEPTED");
});

test("inviting an existing Substo account adds it immediately", async () => {
  const existing = identity(`${unique("existing")}@example.com`);
  const context = deps(fakeStudio(), fakeClerk([existing]));
  const admin = await prepareSubstoSignIn(context, identity(`${unique("admin")}@example.com`));
  const brandId = admin!.brands[0].id;
  const result = await inviteToBrand(context, await actorFor(admin!.user.id, brandId), { email: existing.emailAddresses[0].emailAddress, role: "ADMIN", signUpUrl: "https://substo.example/sign-up" });
  assert.equal(result.ok, true);
  assert.equal(context.fakes.clerk.invitations.length, 0);
  const user = await db.user.findUniqueOrThrow({ where: { authRealm_clerkId: { authRealm: "substo", clerkId: existing.id } } });
  assert.deepEqual((await listUserBrands(db, user.id)).map((brand) => [brand.id, brand.role]), [[brandId, "ADMIN"]]);
});

test("Studio access follows the brand team, and removal revokes Studio first", async () => {
  const context = deps();
  const admin = identity(`${unique("admin")}@example.com`);
  const prepared = await prepareSubstoSignIn(context, admin);
  const brand = prepared!.brands[0];
  const workspaceId = await ensureBrandWorkspace(context, brand, admin.id);
  assert.equal(await ensureBrandWorkspace(context, brand, admin.id), workspaceId);
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.get(admin.id), "owner");

  const member = identity(`${unique("member")}@example.com`);
  await inviteToBrand(context, await actorFor(prepared!.user.id, brand.id), { email: member.emailAddresses[0].emailAddress, role: "MEMBER", signUpUrl: "https://substo.example/sign-up" });
  const memberUser = (await prepareSubstoSignIn(context, member))!.user;

  const access = await resolveBrandWorkspaceAccess(context, workspaceId, member.id);
  assert.equal(access?.studioRole, "member");
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.get(member.id), "member");

  const promoted = await changeMemberRole(context, await actorFor(prepared!.user.id, brand.id), memberUser.id, "ADMIN");
  assert.equal(promoted.ok, true);
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.get(member.id), "admin");

  const removed = await removeMember(context, await actorFor(prepared!.user.id, brand.id), memberUser.id);
  assert.equal(removed.ok, true);
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.has(member.id), false);
  assert.equal(await resolveBrandWorkspaceAccess(context, workspaceId, member.id), null);

  // A stale Studio row (e.g. a failed earlier sync) is removed on the next access check.
  context.fakes.studio.workspaces.get(workspaceId)!.members.set(member.id, "admin");
  assert.equal(await resolveBrandWorkspaceAccess(context, workspaceId, member.id), null);
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.has(member.id), false);

  // Signing in again neither re-adds them nor creates a new brand for them.
  const back = await prepareSubstoSignIn(context, member);
  assert.equal(back!.brands.length, 0);
});

test("a brand always keeps an admin", async () => {
  const context = deps();
  const prepared = await prepareSubstoSignIn(context, identity(`${unique("solo")}@example.com`));
  const actor = await actorFor(prepared!.user.id, prepared!.brands[0].id);
  assert.deepEqual(await changeMemberRole(context, actor, prepared!.user.id, "MEMBER"), { ok: false, error: "A brand needs at least one admin." });
  assert.deepEqual(await removeMember(context, actor, prepared!.user.id), { ok: false, error: "A brand needs at least one admin." });
});

test("members cannot manage the team", async () => {
  const context = deps();
  const admin = await prepareSubstoSignIn(context, identity(`${unique("admin")}@example.com`));
  const brandId = admin!.brands[0].id;
  const member = identity(`${unique("member")}@example.com`);
  await inviteToBrand(context, await actorFor(admin!.user.id, brandId), { email: member.emailAddresses[0].emailAddress, role: "MEMBER", signUpUrl: "https://substo.example/sign-up" });
  const memberUser = (await prepareSubstoSignIn(context, member))!.user;
  const memberActor = await actorFor(memberUser.id, brandId);
  assert.equal((await inviteToBrand(context, memberActor, { email: "x@example.com", role: "ADMIN", signUpUrl: "https://substo.example/sign-up" })).ok, false);
  assert.equal((await changeMemberRole(context, memberActor, admin!.user.id, "MEMBER")).ok, false);
  assert.equal((await removeMember(context, memberActor, admin!.user.id)).ok, false);
});

test("pre-brand Studio workspaces are adopted once with their members", async () => {
  const owner = identity(`${unique("owner")}@example.com`);
  const member = identity(`${unique("member")}@example.com`);
  const studio = fakeStudio();
  const workspaceId = crypto.randomUUID();
  studio.workspaces.set(workspaceId, { name: "Legacy channel", members: new Map<string, StudioMemberRole>([[owner.id, "owner"], [member.id, "member"]]) });
  const context = deps(studio, fakeClerk([owner, member]));

  const prepared = await prepareSubstoSignIn(context, owner);
  assert.deepEqual(prepared!.brands.map((brand) => [brand.name, brand.role, brand.studioWorkspaceId]), [["Legacy channel", "ADMIN", workspaceId]]);
  const memberBrands = await prepareSubstoSignIn(context, member);
  assert.deepEqual(memberBrands!.brands.map((brand) => [brand.studioWorkspaceId, brand.role]), [[workspaceId, "MEMBER"]]);
  assert.equal(await db.location.count({ where: { studioWorkspaceId: workspaceId } }), 1);

  // After adoption the brand team decides: a removed member is not re-imported.
  const memberUser = memberBrands!.user;
  await removeMember(context, await actorFor(prepared!.user.id, prepared!.brands[0].id), memberUser.id);
  studio.workspaces.get(workspaceId)!.members.set(member.id, "member");
  const after = await prepareSubstoSignIn(context, member);
  assert.ok(after!.brands.every((brand) => brand.studioWorkspaceId !== workspaceId));
});

test("Estio brands are never resolved as Substo Studio workspaces", async () => {
  const context = deps();
  const estioUser = await db.user.create({ data: { email: `${unique("estio")}@example.com`, clerkId: unique("user_estio"), authRealm: "estio" } });
  const workspaceId = crypto.randomUUID();
  const estioBrand = await db.location.create({ data: { name: "Estio", studioWorkspaceId: workspaceId, users: { connect: { id: estioUser.id } } } });
  await db.userLocationRole.create({ data: { userId: estioUser.id, locationId: estioBrand.id, role: "ADMIN" } });
  context.fakes.studio.workspaces.set(workspaceId, { name: "Estio", members: new Map() });
  assert.equal(await resolveBrandWorkspaceAccess(context, workspaceId, estioUser.clerkId!), null);
  assert.equal(context.fakes.studio.workspaces.get(workspaceId)?.members.size, 0);
});

test("a foreign push endpoint cannot be reassigned by the scoped upsert, including concurrent attempts", async () => {
  const email = `${unique("push")}@example.com`;
  const estio = await db.user.create({ data: { email, clerkId: unique("push-estio"), authRealm: "estio" } });
  const substo = await db.user.create({ data: { email, clerkId: unique("push-substo"), authRealm: "substo" } });
  const endpoint = `https://push.example.com/${unique("endpoint")}`;
  const original = await db.webPushSubscription.create({ data: { userId: estio.id, endpoint, p256dh: "estio-key", auth: "estio-auth" } });
  const attempts = await Promise.allSettled([1, 2].map(() => db.webPushSubscription.upsert({
    where: { endpoint, userId: substo.id },
    update: { userId: substo.id, p256dh: "substo-key" },
    create: { userId: substo.id, endpoint, p256dh: "substo-key", auth: "substo-auth" },
  })));
  assert.ok(attempts.every((result) => result.status === "rejected" && ["P2002", "P2025"].includes(result.reason.code)), JSON.stringify(attempts.map((result) => result.status === "fulfilled" ? { status: result.status, userId: result.value.userId } : { status: result.status, code: result.reason.code, message: result.reason.message })));
  assert.deepEqual(await db.webPushSubscription.findUniqueOrThrow({ where: { endpoint } }), original);
});
