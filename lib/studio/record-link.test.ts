import assert from "node:assert/strict";
import test from "node:test";
import { createRecordLinkService } from "./record-link-service";
import { recordLinkCandidates, recordLinkKind, recordLinkPage, validRecordLinkChange } from "./record-link-policy";
const workspace = "10000000-0000-4000-8000-000000000001";
const source = "20000000-0000-4000-8000-000000000002";
const target = "30000000-0000-4000-8000-000000000003";
const other = "40000000-0000-4000-8000-000000000004";
function fixture(authorized = true, impersonating = false) {
  const calls: Array<{ path: string; init?: RequestInit }> = []; const responses: unknown[] = [];
  const service = createRecordLinkService({
    authorize: async (_id: string) => authorized ? { workspace: { id: workspace }, brand: "substo" as const, userId: "user_fixture" } : null,
    isImpersonating: async () => impersonating,
    request: async <T>(path: string, init?: RequestInit): Promise<T> => { calls.push({ path, init }); assert.ok(responses.length, "Unexpected request"); return responses.shift() as T; },
  });
  return { calls, responses, service };
}
const query = (path: string) => new URL(`https://fixture.invalid/${path}`).searchParams;
test("link policies reject malformed/repeated filters, self-links and unsafe versions", () => {
  assert.equal(recordLinkKind(["content", "reference"]), "all"); assert.equal(recordLinkKind("channel"), "channel");
  for (const page of ["-1", "1.2", "1e2", "100000", ["1", "2"]]) assert.equal(recordLinkPage(page), 0);
  assert.equal(recordLinkPage("2"), 2);
  assert.equal(validRecordLinkChange(source, target, 1, "add"), true);
  assert.equal(validRecordLinkChange(source, source.toUpperCase(), 1, "add"), false);
  for (const version of [0, -1, 1.1, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.equal(validRecordLinkChange(source, target, version, "remove"), false);
  assert.equal(validRecordLinkChange(source, target, 1, "replace"), false);
  const candidates = recordLinkCandidates(workspace, source, 2, "reference");
  assert.equal(candidates.workspace_id, `eq.${workspace}`); assert.equal(candidates.id, `neq.${source}`);
  assert.equal(candidates.kind, "eq.reference"); assert.equal(candidates.offset, "40"); assert.equal(candidates.limit, "21");
});
test("denied reads/writes and impersonated writes make no database request", async () => {
  const denied = fixture(false);
  assert.equal(await denied.service.list(workspace, source, { links: 0, candidates: 0 }, "all"), null);
  await assert.rejects(denied.service.change(workspace, source, target, 1, "add"), /authorized/);
  assert.equal(denied.calls.length, 0);
  const impersonated = fixture(true, true);
  await assert.rejects(impersonated.service.change(workspace, source, target, 1, "add"), /own authorized/);
  assert.equal(impersonated.calls.length, 0);
});
test("invalid source or page cannot cause an unbounded picker read", async () => {
  const f = fixture();
  assert.equal(await f.service.list(workspace, "bad", { links: 0, candidates: 0 }, "all"), null);
  assert.equal(await f.service.list(workspace, source, { links: -1, candidates: 0 }, "all"), null);
  await assert.rejects(f.service.change(workspace, source, source, 1, "add"), /Invalid record link/);
  assert.equal(f.calls.length, 0);
});
test("picker scopes all reads to resolved workspace and both lists use bounded pages", async () => {
  const f = fixture();
  const labels = Array.from({ length: 20 }, (_, i) => ({ id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000001`, title: `Target ${i}`, kind: "reference", archived: false }));
  f.responses.push([{ id: source, title: "Content", kind: "content", version: 3 }],
    [...labels.map(l => ({ target_id: l.id })), { target_id: other }],
    [...labels, { id: other, title: "sentinel", kind: "channel" }], labels, labels.map(l => ({ target_id: l.id })));
  const result = await f.service.list("untrusted-workspace-argument", source, { links: 2, candidates: 3 }, "all");
  assert.ok(result); assert.equal(result.links.length, 20); assert.equal(result.candidates.length, 20);
  assert.equal(result.hasMoreLinks, true); assert.equal(result.hasMoreCandidates, true);
  assert.ok(result.candidates.every(c => c.linked));
  for (const call of f.calls) {
    const q = query(call.path); assert.equal(q.get("workspace_id"), `eq.${workspace}`);
    assert.doesNotMatch(q.get("select")!, /payload|transcript|script/);
    assert.ok(Number(q.get("limit")) <= 21);
  }
  assert.equal(query(f.calls[1].path).get("source_id"), `eq.${source}`);
  assert.equal(query(f.calls[1].path).get("offset"), "40");
  assert.equal(query(f.calls[2].path).get("id"), `neq.${source}`);
  assert.equal(query(f.calls[2].path).get("offset"), "60");
  assert.equal(query(f.calls[4].path).get("source_id"), `eq.${source}`);
});
test("empty and missing records do not expand to workspace-wide data", async () => {
  const missing = fixture(); missing.responses.push([]);
  assert.equal(await missing.service.list(workspace, source, { links: 0, candidates: 0 }, "all"), null);
  assert.equal(missing.calls.length, 1);
  const empty = fixture(); empty.responses.push([{ id: source, version: 1 }], [], []);
  const result = await empty.service.list(workspace, source, { links: 0, candidates: 0 }, "content");
  assert.ok(result); assert.deepEqual(result.links, []); assert.deepEqual(result.candidates, []); assert.equal(empty.calls.length, 3);
});
test("link mutation uses server-derived identity/workspace and never sends replacement payloads", async () => {
  const f = fixture(); f.responses.push({ sourceId: source, targetId: target, version: 4, changed: true });
  assert.equal((await f.service.change("untrusted-workspace", source, target, 3, "add")).version, 4);
  assert.equal(f.calls[0].path, "rpc/studio_change_record_link"); assert.equal(f.calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), { p_workspace_id: workspace, p_source_id: source, p_target_id: target,
    p_action: "add", p_expected_version: 3, p_actor_brand: "substo", p_clerk_user_id: "user_fixture" });
});

test("incomplete linked-record labels fail instead of inventing a destination kind", async () => {
  const f = fixture(); f.responses.push([{ id: source, version: 1 }], [{ target_id: target }], [], []);
  await assert.rejects(f.service.list(workspace, source, { links: 0, candidates: 0 }, "all"), /incomplete link labels/);
});

test("mutation rejects an unconfirmed or mismatched RPC result", async () => {
  const f = fixture(); f.responses.push({ sourceId: source, targetId: other, version: 4, changed: true });
  await assert.rejects(f.service.change(workspace, source, target, 3, "add"), /did not confirm/);
});
