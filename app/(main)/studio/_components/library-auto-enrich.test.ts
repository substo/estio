import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichmentAttempt, enrichmentCandidates, runLibraryEnrichment } from "./library-auto-enrich";
const record = (id: string, payload: Record<string, unknown> = {}) => ({ id, payload, kind: "reference", title: "Source", source_url: `https://youtube.com/watch?v=${id}`, summary: null, approved: false, archived: false });
test("only unattempted incomplete records qualify, without mistaking fallback images for metadata", () => {
  const records = [record("legacy"), record("tried", { importEvidence: { fetchedAt: "2026-11-05" } }), record("complete", { platform: "youtube", format: "video", channelName: "Creator", thumbnailUrl: "https://example.com/image.jpg", description: "Publisher description" })];
  assert.deepEqual(enrichmentCandidates(records).map(item => item.id), ["legacy"]);
});
test("blocked session storage is harmless and memory suppresses duplicate attempts", () => {
  const storage = { getItem: () => { throw Error("blocked"); }, setItem: () => { throw Error("blocked"); } };
  assert.equal(enrichmentAttempt("blocked-test", "record", storage, () => "uuid"), "uuid");
  assert.equal(enrichmentAttempt("blocked-test", "record", storage, () => "new-uuid"), null);
  assert.equal(enrichmentAttempt("another-tenant", "record", storage, () => "other-uuid"), "other-uuid");
});
test("stored attempts suppress requests and storage stays bounded", () => {
  let stored = JSON.stringify(Array.from({ length: 250 }, (_, n) => [`tenant:${n}`, "key"]));
  const storage = { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } };
  assert.equal(enrichmentAttempt("tenant", "249", storage, () => "new"), null);
  assert.equal(enrichmentAttempt("tenant", "new", storage, () => "new"), "new");
  assert.equal(JSON.parse(stored).length, 200);
});
test("batch caps at five, executes sequentially, tenant-fences and reuses UUID on retry", async () => {
  const calls: RequestInit[] = [];
  let active = 0, maximum = 0, progress = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    calls.push(init!); active++; maximum = Math.max(active, maximum);
    await Promise.resolve(); active--;
    return new Response(JSON.stringify({ recordId: "saved" }), { status: calls.length === 1 ? 503 : 200 });
  };
  const result = await runLibraryEnrichment({ records: Array.from({ length: 8 }, (_, n) => record(String(n))), locationId: "location", signal: new AbortController().signal, claim: id => `uuid-${id}`, fetcher, progress: () => { progress++; } });
  assert.deepEqual(result, { completed: 5, saved: 5 });
  assert.equal(maximum, 1); assert.equal(calls.length, 6); assert.equal(progress, 5);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal((calls[0].headers as Record<string, string>)["X-Studio-Tenant"], "location");
});
test("unmount cancellation stops the current request and prevents the rest of the batch", async () => {
  const controller = new AbortController(); let calls = 0;
  const result = await runLibraryEnrichment({ records: [record("a"), record("b")], locationId: "location", signal: controller.signal, claim: id => id,
    fetcher: async (_url, init) => { calls++; assert.equal(init?.signal, controller.signal); controller.abort(); throw Error("aborted"); },
    progress: () => assert.fail("no updates after unmount") });
  assert.equal(calls, 1); assert.equal(result.saved, 0);
});

test("persisted enrichment outcomes suppress retries across sessions even without top-level fetchedAt", () => {
  for (const enrichmentStatus of ["complete", "missing_description"]) {
    assert.deepEqual(enrichmentCandidates([record(enrichmentStatus, { importEvidence: { enrichmentStatus, enrichment: { fetchedAt: "2026-11-05" } } })]), []);
  }
});
