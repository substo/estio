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

test('one preserves existing LIMIT/OFFSET and aggregate reads without appending conflicting SQL', async () => {
  assert.deepEqual(await db.one(Prisma.sql`select n from generate_series(1,3) n order by n desc limit 1`), { n: 3 });
  assert.deepEqual(await db.one(Prisma.sql`select n from generate_series(1,3) n order by n limit 1 offset 1`), { n: 2 });
  assert.deepEqual(await db.one(Prisma.sql`select count(*)::int total from generate_series(1,3)`), { total: 3 });
  assert.equal(await db.one(Prisma.sql`select 1 n where false limit 1`), null);
});

test("source-backed ideas commit both operations and roll back a failed link", async () => {
  const { createSourceIdeaService } = await import("./source-idea-service");
  const ideaId = "ab000000-0000-4000-8000-0000000000a2";
  const failedId = "ab000000-0000-4000-8000-0000000000a3";
  const authorize = async () => ({ locationId: location, app: "substo" as const, userId: "db-owner" });
  const service = createSourceIdeaService({ authorize, isImpersonating: async () => false,
    transaction: run => client.$transaction(tx => run(createStudioDb(tx))),
  });
  assert.equal(await service(location, record, ideaId, "Original angle", "A useful audience promise"), ideaId);
  const links = await db.rows<{ target_id: string }>(Prisma.sql`
    select target_id from studio.studio_record_links where location_id=${location} and source_id=${ideaId}::uuid`);
  assert.deepEqual(links, [{ target_id: record }]);
  const saved = await db.one<{ approved: boolean; version: number }>(Prisma.sql`
    select approved,version from studio.studio_records where location_id=${location} and id=${ideaId}::uuid`);
  assert.deepEqual(saved, { approved: false, version: 2 });
  const failingService = createSourceIdeaService({ authorize, isImpersonating: async () => false,
    transaction: run => client.$transaction(tx => {
      const transactionalDb = createStudioDb(tx);
      return run({ ...transactionalDb, call: async (fn, args) => {
        if (fn === "studio_change_record_link") throw new Error("Simulated link failure");
        return transactionalDb.call(fn, args);
      } });
    }),
  });
  await assert.rejects(failingService(location, record, failedId, "Rollback idea", "Must not remain"));
  assert.equal(await db.one(Prisma.sql`select id from studio.studio_records where location_id=${location} and id=${failedId}::uuid`), null);
});

test("related YouTube selection saves and links atomically, reuses bookmarks and rejects a missing anchor", async () => {
  const { saveLinkedYoutubeSelection } = await import("./youtube-bookmark");
  const access = { locationId: location, app: "substo" as const, userId: "db-owner" };
  const selection = {
    recordId: "ab000000-0000-4000-8000-0000000000c1", videoId: "9DBJXRy5dvk",
    provenance: { kind: "public_search", observedAt: "2026-11-18T00:00:00Z", provider: "youtube_data_api", rights: "research_link_only" } as const,
  };
  const save = (anchorId: string, candidate = selection) => client.$transaction(tx =>
    saveLinkedYoutubeSelection(createStudioDb(tx), access, anchorId, candidate, "Think Media reference"));
  assert.equal(await save(record), selection.recordId);
  assert.equal(await save(record, { ...selection, recordId: "ab000000-0000-4000-8000-0000000000c2" }), selection.recordId);
  assert.equal((await db.one<{ count: number }>(Prisma.sql`
    select count(*)::int as count from studio.studio_record_link_events where location_id = ${location}
      and source_id = ${record}::uuid and target_id = ${selection.recordId}::uuid`))?.count, 1);
  const missing = "ab000000-0000-4000-8000-0000000000c3";
  await assert.rejects(save(missing, { ...selection, recordId: "ab000000-0000-4000-8000-0000000000c4", videoId: "Zyx9876abcd" }), /active source or idea/);
  assert.equal(await db.one(Prisma.sql`select record_id from studio.studio_youtube_bookmarks where location_id = ${location} and video_id = 'Zyx9876abcd'`), null);
  await assert.rejects(save(selection.recordId), /already the starting source/);
});
