import assert from "node:assert/strict";
import test from "node:test";
import { renderShot } from "./prompts";
import { STORYBOARD_CHARACTER, shotForBeat } from "./storyboard";

test("a beat's own visual note is its scene; without one the creator speaks the line", () => {
  const withNote = shotForBeat({ index: 2, narration: "Freeze there.", direction: "Open overhead on a blank page" });
  assert.equal(withNote.subject, "Open overhead on a blank page");
  const without = shotForBeat({ index: 3, narration: "Hey, today I am going to show you how to draw a straight line." });
  assert.match(without.subject, /^speaking to camera, mid-sentence, saying "Hey, today/);
});

test("every frame carries the same locked character and continuity; sizes rotate; portrait follows the canvas", () => {
  const shots = [1, 2, 3, 4, 5].map(i => shotForBeat({ index: i, narration: "x" }));
  assert.ok(shots.every(s => s.character === STORYBOARD_CHARACTER && /same clothing/.test(s.continuity ?? "")));
  assert.deepEqual(shots.slice(0, 4).map(s => s.size), ["medium", "wide", "close-up", "medium close-up"]);
  assert.equal(shots[4].size, "medium");
  assert.equal(shotForBeat({ index: 1, narration: "x" }, true).aspect, "9:16");
});

test("the edit prompt names the person by description, keeps the face, forbids text, and does not blow the length budget", () => {
  const { prompt } = renderShot(shotForBeat({ index: 1, narration: "Welcome back to the channel." }), "edit", { acceptsText: false });
  assert.match(prompt, /the person in the reference photo, same face, hair and clothing/);
  assert.match(prompt, /Keep .* exactly the same as in the reference image/);
  assert.match(prompt, /No text, no extra people, no watermark/);
  assert.ok(prompt.split(/\s+/).length < 140);
  assert.doesNotMatch(prompt, /\b(she|he|her|his)\b/i);
});
