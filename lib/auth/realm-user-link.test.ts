import assert from "node:assert/strict";
import test from "node:test";
import { authRealmForHostBrand, businessClerkIdWhere, isBusinessRealm, type AuthRealm } from "./auth-realm";
import { claimInvitedRealmUser } from "./clerk-business-webhook";
import { ensureRealmUser, type RealmUserStore } from "./realm-user-link";

type Row = { id: string; authRealm: AuthRealm; email: string; clerkId: string | null; firstName: string | null; lastName: string | null; locationIds: string[] };

/**
 * In-memory User table enforcing the database's unique indexes. "expand" is
 * the state after the additive migration (global email unique still present);
 * "contract" is after User_email_key is dropped. clerkId stays globally unique.
 */
function fakeUsers(phase: "expand" | "contract", seed: Omit<Row, "locationIds">[] = []) {
  const rows: Row[] = seed.map((row) => ({ ...row, locationIds: [] }));
  let next = rows.length + 1;
  const assertUnique = (candidate: Row) => {
    for (const row of rows) {
      if (row.id === candidate.id) continue;
      if (candidate.clerkId && row.clerkId === candidate.clerkId) throw Object.assign(new Error("Unique constraint failed on clerkId"), { code: "P2002" });
      if (row.email === candidate.email && (phase === "expand" || row.authRealm === candidate.authRealm)) {
        throw Object.assign(new Error("Unique constraint failed on email"), { code: "P2002" });
      }
    }
  };
  const find = (where: Record<string, any>) => {
    if (where.id) return rows.find((row) => row.id === where.id) ?? null;
    if (where.authRealm_clerkId) return rows.find((row) => row.authRealm === where.authRealm_clerkId.authRealm && row.clerkId === where.authRealm_clerkId.clerkId) ?? null;
    if (where.authRealm_email) return rows.find((row) => row.authRealm === where.authRealm_email.authRealm && row.email === where.authRealm_email.email) ?? null;
    throw new Error(`Realm-free lookup is not allowed: ${JSON.stringify(where)}`);
  };
  const apply = (row: Row, data: Record<string, any>) => {
    const updated = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (key === "locations") updated.locationIds = [...new Set([...updated.locationIds, value.connect.id])];
      else (updated as any)[key] = value;
    }
    assertUnique(updated);
    rows[rows.indexOf(row)] = updated;
    return updated;
  };
  const insert = (data: Record<string, any>) => {
    const row: Row = { id: `u${next++}`, authRealm: "estio", clerkId: null, firstName: null, lastName: null, locationIds: [], email: "" };
    const created = { ...row };
    for (const [key, value] of Object.entries(data)) {
      if (key === "locations") created.locationIds = [value.connect.id];
      else (created as any)[key] = value;
    }
    assertUnique(created);
    rows.push(created);
    return created;
  };
  const store = {
    user: {
      findUnique: async ({ where }: { where: Record<string, any> }) => find(where),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => apply(find(where)!, data),
      create: async ({ data }: { data: Record<string, any> }) => insert(data),
      upsert: async ({ where, update, create }: { where: Record<string, any>; update: Record<string, any>; create: Record<string, any> }) => {
        const existing = find(where);
        return existing ? apply(existing, update) : insert(create);
      },
    },
  };
  return { rows, store: store as unknown as RealmUserStore & typeof store };
}

const legacyEstio = { id: "estio-1", authRealm: "estio" as const, email: "shared@example.com", clerkId: "user_estio", firstName: "Ada", lastName: "Estio" };

test("host brands map to realms; tenant satellites are Estio; only Estio has Business access in slice 1", () => {
  assert.equal(authRealmForHostBrand("estio"), "estio");
  assert.equal(authRealmForHostBrand("tenant"), "estio");
  assert.equal(authRealmForHostBrand("substo"), "substo");
  assert.equal(isBusinessRealm("estio"), true);
  assert.equal(isBusinessRealm("substo"), false);
  assert.deepEqual(businessClerkIdWhere("user_x"), { clerkId: "user_x", authRealm: { in: ["estio"] } });
});

test("legacy Estio users resolve by (estio, clerkId) and keep their identity", async () => {
  const { rows, store } = fakeUsers("expand", [legacyEstio]);
  const user = await ensureRealmUser(store, "estio", { clerkId: "user_estio", email: "shared@example.com", firstName: "Ada" });
  assert.equal(user?.id, "estio-1");
  assert.equal(rows.length, 1);
  const renamed = await ensureRealmUser(store, "estio", { clerkId: "user_estio", email: "shared@example.com", firstName: "Ada", lastName: "Lovelace" });
  assert.equal(renamed?.lastName, "Lovelace");
  assert.equal(renamed?.authRealm, "estio");
});

test("same email in both realms creates a separate Substo user and never touches the Estio user", async () => {
  const { rows, store } = fakeUsers("contract", [legacyEstio]);
  const substo = await ensureRealmUser(store, "substo", { clerkId: "user_substo", email: "shared@example.com", firstName: "Other" });
  assert.notEqual(substo?.id, "estio-1");
  assert.equal(substo?.authRealm, "substo");
  assert.equal(substo?.clerkId, "user_substo");
  assert.deepEqual(rows.find((row) => row.id === "estio-1"), { ...legacyEstio, locationIds: [] });
  // Each realm keeps resolving to its own row afterwards.
  assert.equal((await ensureRealmUser(store, "estio", { clerkId: "user_estio", email: "shared@example.com" }))?.id, "estio-1");
  assert.equal((await ensureRealmUser(store, "substo", { clerkId: "user_substo", email: "shared@example.com" }))?.id, substo?.id);
});

test("before the contract step a same-email Substo sign-in fails closed instead of linking the Estio user", async () => {
  const { rows, store } = fakeUsers("expand", [legacyEstio]);
  await assert.rejects(ensureRealmUser(store, "substo", { clerkId: "user_substo", email: "shared@example.com" }), /email/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].clerkId, "user_estio");
});

test("same-realm invite claim links the invited placeholder by email", async () => {
  const { rows, store } = fakeUsers("contract", [{ id: "invited", authRealm: "estio", email: "new@example.com", clerkId: null, firstName: null, lastName: null }]);
  const user = await ensureRealmUser(store, "estio", { clerkId: "user_new", email: "new@example.com", firstName: "New" });
  assert.equal(user?.id, "invited");
  assert.equal(rows[0].clerkId, "user_new");
  assert.equal(rows.length, 1);
});

test("an invited placeholder in one realm is never claimed from the other realm", async () => {
  const { rows, store } = fakeUsers("contract", [{ id: "estio-invite", authRealm: "estio", email: "new@example.com", clerkId: null, firstName: null, lastName: null }]);
  const substo = await ensureRealmUser(store, "substo", { clerkId: "user_substo_new", email: "new@example.com" });
  assert.notEqual(substo?.id, "estio-invite");
  assert.equal(rows.find((row) => row.id === "estio-invite")?.clerkId, null);
});

test("a Clerk ID already owned by another realm's row is not resolved or re-linked", async () => {
  const { rows, store } = fakeUsers("contract", [legacyEstio]);
  await assert.rejects(ensureRealmUser(store, "substo", { clerkId: "user_estio", email: "different@example.com" }), /clerkId/);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].authRealm, "estio");
});

test("missing Clerk ID or email resolves nothing", async () => {
  const { rows, store } = fakeUsers("contract");
  assert.equal(await ensureRealmUser(store, "estio", { clerkId: "user_x", email: null }), null);
  assert.equal(await ensureRealmUser(store, "estio", { clerkId: "", email: "x@example.com" }), null);
  assert.equal(rows.length, 0);
});

test("webhook invite claim is scoped to the signing realm", async () => {
  const { rows, store } = fakeUsers("contract", [legacyEstio, { id: "estio-invite", authRealm: "estio", email: "invitee@example.com", clerkId: null, firstName: null, lastName: null }]);
  const claimed = await claimInvitedRealmUser(store, "estio", { clerkId: "user_invitee", email: "invitee@example.com", firstName: "In", locationId: "loc-estio" });
  assert.equal(claimed.id, "estio-invite");
  assert.deepEqual(rows.find((row) => row.id === "estio-invite")?.locationIds, ["loc-estio"]);

  const substo = await claimInvitedRealmUser(store, "substo", { clerkId: "user_substo_shared", email: "shared@example.com", locationId: "loc-substo" });
  assert.notEqual(substo.id, "estio-1");
  const estio = rows.find((row) => row.id === "estio-1")!;
  assert.equal(estio.clerkId, "user_estio");
  assert.deepEqual(estio.locationIds, []);
});
