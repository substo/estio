import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseOutputOrientation, parseVideoShape, probeOutputOrientation } from "./orientation";

test("video shape honours display rotation and rejects unusable probe output", () => {
  assert.deepEqual(parseVideoShape(JSON.stringify({ streams: [{ width: 1080, height: 1920 }] })), { width: 1080, height: 1920 });
  assert.deepEqual(parseVideoShape(JSON.stringify({ streams: [{ width: 1920, height: 1080, tags: { rotate: "90" } }] })), { width: 1080, height: 1920 });
  assert.equal(parseVideoShape("not json"), null);
  assert.equal(parseVideoShape(JSON.stringify({ streams: [{ width: 0, height: 1080 }] })), null);
});

test("explicit vertical wins; otherwise footage majority wins and portrait is the tie-breaker", () => {
  const portrait = { width: 1080, height: 1920 }, landscape = { width: 1920, height: 1080 };
  assert.equal(chooseOutputOrientation(true, [landscape]), "portrait");
  assert.equal(chooseOutputOrientation(false, [portrait, portrait, landscape]), "portrait");
  assert.equal(chooseOutputOrientation(false, [landscape, portrait]), "portrait");
  assert.equal(chooseOutputOrientation(false, [landscape]), "landscape");
  assert.equal(chooseOutputOrientation(false, []), "landscape");
});

test("the Mac probes downloaded footage and defaults safely when a file is unreadable", async () => {
  const run = async (request: { args: string[] }) => ({
    stdout: request.args.at(-1)?.endsWith("portrait.mov") ? JSON.stringify({ streams: [{ width: 1080, height: 1920 }] }) : "bad",
    stderr: "",
  });
  assert.equal(await probeOutputOrientation(["/clips/portrait.mov", "/clips/bad.mov"], false, run as never), "portrait");
  assert.equal(await probeOutputOrientation(["/clips/bad.mov"], false, run as never), "landscape");
});
