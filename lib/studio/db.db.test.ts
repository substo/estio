import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createStudioDb, StudioDbError } from "./db";

// Runs only from scripts/test-studio-schema.sh against its disposable cluster (Unix socket, no TCP).
const databaseUrl = process.env.STUDIO_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("STUDIO_TEST_DATABASE_URL is required; use bash scripts/test-studio-schema.sh");
if (!new URL(databaseUrl).searchParams.get("host")?.includes("estio-studio-test.")) throw new Error("Studio database tests only run against the disposable test cluster");

const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const db = createStudioDb(client);
after(() => client.$disconnect());
const location = "ab000000-0000-4000-8000-000000000001";
const record = "ab000000-0000-4000-8000-0000000000a1";

test("function calls bind named JSON arguments to the function's own types", async () => {
  assert.equal(await db.call("studio_create_substo_location", { p_location_id: location, p_name: "Db layer", p_clerk_user_id: "db-owner" }), location);
  const saved = await db.call<{ version: number; updated_at: string; payload: Record<string, unknown> }>("studio_save_record", {
    p_location_id: location, p_record_id: record, p_kind: "reference", p_title: "Source", p_payload_patch: { notes: "Original" },
    p_expected_version: 0, p_clerk_user_id: "db-owner", p_unused: undefined,
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.payload.notes, "Original");
  assert.match(saved.updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?[+-]\d\d:\d\d$/);
});

test("set-returning, void and missing functions", async () => {
  const claimed = await db.call<unknown[]>("studio_claim_jobs", { p_worker_id: "db-worker", p_limit: 1, p_lease_seconds: 60 });
  assert.ok(Array.isArray(claimed) && claimed.length <= 1);
  assert.equal(await db.call("studio_worker_heartbeat", { p_worker_id: "db-worker", p_release: "r1", p_started_at: new Date().toISOString() }), undefined);
  await assert.rejects(db.call("studio_not_a_function"), (error: unknown) => error instanceof StudioDbError && error.code === "42883" && error.status === 404);
  await assert.rejects(db.call("bad name;"), (error: unknown) => error instanceof StudioDbError && error.code === "22023");
});

test("SQLSTATEs from Studio functions reach callers", async () => {
  const edit = { p_location_id: location, p_record_id: record, p_kind: "reference", p_title: "Edited", p_payload_patch: {}, p_expected_version: 1, p_clerk_user_id: "db-owner" };
  await db.call("studio_save_record", edit);
  await assert.rejects(db.call("studio_save_record", edit), (error: unknown) => error instanceof StudioDbError && error.code === "40001" && error.status === 409);
  // Membership comes from the CRM team (UserLocationRole) through studio.studio_location_members.
  await assert.rejects(db.call("studio_member_job_action", {
    p_location_id: location, p_actor_app: "substo", p_clerk_user_id: "not-a-member", p_job_id: "ab000000-0000-4000-8000-0000000000b1", p_action: "retry",
  }), (error: unknown) => error instanceof StudioDbError && error.code === "42501" && error.status === 403);
});

test("reads return JSON rows in order, and one row or null", async () => {
  const rows = await db.rows<{ id: string; title: string; version: number; updated_at: string }>(
    Prisma.sql`select id, title, version, updated_at from studio.studio_records where location_id = ${location} order by updated_at desc`);
  assert.deepEqual(rows.map((row) => [row.id, row.title, row.version]), [[record, "Edited", 2]]);
  assert.equal(typeof rows[0].updated_at, "string");
  assert.equal((await db.one<{ id: string }>(Prisma.sql`select id from studio.studio_records where location_id = ${location}`))?.id, record);
  assert.equal(await db.one(Prisma.sql`select id from studio.studio_records where location_id = ${"elsewhere"}`), null);
});
