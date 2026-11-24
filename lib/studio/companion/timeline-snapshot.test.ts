import assert from "node:assert/strict";
import { test } from "node:test";
import { SERVER_HAS_TIMELINE_FIELD, snapshotTimeline, timelineField } from "./timeline-snapshot";

const project = { videoTracks: [{ name: "Text", clips: [{ name: "Title", start: 1, duration: 2, content: { text: { text: "Hi" } } }] }], audioTracks: [] };
test("snapshot runs the editor CLI with fixed argv and reduces its output", async () => {
  let seen: { command: string; args: string[] } | undefined;
  const t = await snapshotTimeline("/p/Video.substo", "/p", async r => { seen = r; return { stdout: JSON.stringify({ project }), stderr: "" }; });
  assert.deepEqual(seen!.args, ["timeline", "--json", "--project", "/p/Video.substo"]); assert.equal(seen!.command, "substo");
  assert.equal(t!.tracks[0].c[0].l, "Title");
});
test("a failing or malformed CLI gives no picture and never throws", async () => {
  assert.equal(await snapshotTimeline("/p", "/p", async () => { throw new Error("boom"); }), null);
  assert.equal(await snapshotTimeline("/p", "/p", async () => ({ stdout: "not json", stderr: "" })), null);
});
test("the field is withheld until the server accepts it", () => {
  assert.equal(SERVER_HAS_TIMELINE_FIELD, false);
  assert.deepEqual(timelineField({ d: 1, tracks: [] }), {});
});
