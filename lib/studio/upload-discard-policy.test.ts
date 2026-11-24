import assert from "node:assert/strict";
import { test } from "node:test";
import { discardConfirmText, readDiscardResult, readDiscardTarget } from "./upload-discard-policy";

const loc = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
test("a discard target is one valid upload or all of them", () => {
  assert.deepEqual(readDiscardTarget(null), { ok: true, uploadId: null });
  assert.deepEqual(readDiscardTarget(undefined), { ok: true, uploadId: null });
  assert.deepEqual(readDiscardTarget(id.toUpperCase()), { ok: true, uploadId: id });
  for (const bad of ["", "x", 5, {}, "../etc"]) assert.equal(readDiscardTarget(bad).ok, false);
});
test("only objects under this Location's own uploads prefix are ever removed from storage", () => {
  const good = { id, key: `${loc}/uploads/${id}/original` };
  const r = readDiscardResult({ discarded: 3, objects: [good, { id, key: `${loc}/voice-refs/${id}.wav` }, { id, key: `other/uploads/${id}/original` }, { id: "nope", key: "x" }, null] }, loc);
  assert.deepEqual(r.objects, [good]);
  assert.equal(r.discarded, 3);
  assert.deepEqual(readDiscardResult(null, loc), { discarded: 0, objects: [] });
  assert.equal(readDiscardResult({ discarded: -1, objects: [good] }, loc).discarded, 1);
});
test("the confirm text names what goes and what stays", () => {
  assert.match(discardConfirmText(["a.mp4"]), /unfinished upload a\.mp4.*Finished footage, narration and videos stay/);
  assert.match(discardConfirmText(["a", "b", "c", "d", "e"]), /5 unfinished uploads \(a, b, c, and 2 more\)/);
});
