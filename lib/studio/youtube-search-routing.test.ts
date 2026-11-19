import assert from "node:assert/strict";
import test from "node:test";
import { YoutubeError } from "../google/youtube-api";
import { startRelatedSearchJob, type SearchRpc } from "./youtube-search-routing";

const access = { locationId: "loc", app: "substo" as const, userId: "u" };
const rpc = (script: Record<string, string | { code: string }>) => { const calls: string[] = [];
  const db: SearchRpc = { call: async <T,>(fn: string) => { calls.push(fn); const r = script[fn]; if (!r) throw new Error("unexpected " + fn); if (typeof r === "object") throw Object.assign(new Error("db"), r); return { jobId: r } as T; } };
  return { db, calls }; };
const run = (db: SearchRpc, deviceNetwork: boolean) => startRelatedSearchJob(db, access, "ads", 6, "k", { deviceNetwork });

test("a ready Mac is always used first and nothing else is called", async () => {
  const { db, calls } = rpc({ studio_enqueue_youtube_search: "mac-job", studio_enqueue_youtube_search_egress: "egress-job" });
  assert.equal(await run(db, true), "mac-job"); assert.deepEqual(calls, ["studio_enqueue_youtube_search"]);
});
test("Mac not ready and a device network online: the egress job is used", async () => {
  const { db, calls } = rpc({ studio_enqueue_youtube_search: { code: "YS004" }, studio_enqueue_youtube_search_egress: "egress-job" });
  assert.equal(await run(db, true), "egress-job"); assert.deepEqual(calls, ["studio_enqueue_youtube_search", "studio_enqueue_youtube_search_egress"]);
});
test("Mac not ready and no device network: signals the caller to fall back, without queueing an egress job", async () => {
  for (const code of ["YS001", "YS002", "YS003", "YS004"]) {
    const { db, calls } = rpc({ studio_enqueue_youtube_search: { code } });
    await assert.rejects(run(db, false), (e: unknown) => e instanceof YoutubeError && e.code === "mac_not_ready" && e.message.length > 10);
    assert.deepEqual(calls, ["studio_enqueue_youtube_search"]);
  }
});
test("a failed egress admission still reports the Mac's own reason for the fallback", async () => {
  const { db } = rpc({ studio_enqueue_youtube_search: { code: "YS003" }, studio_enqueue_youtube_search_egress: { code: "42501" } });
  await assert.rejects(run(db, true), (e: unknown) => e instanceof YoutubeError && e.code === "mac_not_ready" && /Chrome/.test(e.message));
});
test("rate limits and missing authority never fall back to the paid-looking paths", async () => {
  for (const code of ["YS005", "42501"]) {
    const { db, calls } = rpc({ studio_enqueue_youtube_search: { code } });
    await assert.rejects(run(db, true), (e: unknown) => e instanceof YoutubeError && e.code === "mac_search_unavailable");
    assert.deepEqual(calls, ["studio_enqueue_youtube_search"]);
  }
});
test("unexpected errors propagate unchanged", async () => {
  const { db } = rpc({ studio_enqueue_youtube_search: { code: "XX000" } });
  await assert.rejects(run(db, true), (e: unknown) => !(e instanceof YoutubeError));
});
