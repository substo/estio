import assert from "node:assert/strict";
import { test } from "node:test";
import { readGenerationSources, resolveSource } from "./sources";

test("only known kinds and choices are read from stored settings", () => {
  assert.deepEqual(readGenerationSources({ voice: "local", music: "hosted", effects: "bogus", extra: "x" }), { voice: "local", music: "hosted" });
  assert.deepEqual(readGenerationSources(null), {});
  assert.deepEqual(readGenerationSources([1]), {});
});
test("the user's choice wins, even when it cannot run yet", () => {
  assert.equal(resolveSource("music", "hosted", { localReady: true, hostedKey: false }).source, "hosted");
  assert.equal(resolveSource("voice", "local", { localReady: false, hostedKey: true }).source, "local");
});
test("with no choice: local when the Mac can, else hosted with a key, else nothing", () => {
  assert.equal(resolveSource("music", undefined, { localReady: true, hostedKey: true }).source, "local");
  assert.equal(resolveSource("music", undefined, { localReady: false, hostedKey: true }).source, "hosted");
  assert.equal(resolveSource("music", undefined, { localReady: false, hostedKey: false }).source, "none");
});
test("the label names where the sound is made", () => {
  assert.equal(resolveSource("music", "local", { localReady: true, hostedKey: false }).label, "Music: made on this Mac");
  assert.equal(resolveSource("effects", "hosted", { localReady: true, hostedKey: true }).label, "Sound effects: fal.ai or ElevenLabs");
});
