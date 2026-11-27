import assert from "node:assert/strict";
import test from "node:test";
import { renderShot } from "./prompts";
import { STORYBOARD_CHARACTER, shotForBeat, storyboardBeatNeedsPerson } from "./storyboard";

test("a beat's own visual note is its scene; without one the creator speaks the line", () => {
  const withNote = shotForBeat({ index: 2, narration: "Freeze there.", direction: "Open overhead on a blank page" });
  assert.equal(withNote.subject, "Open overhead on a blank page");
  assert.equal(withNote.noCharacter, true);
  const without = shotForBeat({ index: 3, narration: "Hey, today I am going to show you how to draw a straight line." });
  assert.match(without.subject, /^speaking to camera, mid-sentence, saying "Hey, today/);
  assert.equal(without.character, STORYBOARD_CHARACTER);
});

test("object and interface notes stay person-free while explicit presenter notes keep the creator", () => {
  for (const note of ["Dark phone screen with four grey paragraphs", "JSON beside rendered choice chips", "A locked component row lights up"]) {
    assert.equal(storyboardBeatNeedsPerson(note), false);
    const shot = shotForBeat({ index: 1, narration: "x", direction: note });
    assert.equal(shot.character, undefined); assert.equal(shot.noCharacter, true);
    const prompt = renderShot(shot, "edit", { acceptsText: false }).prompt;
    assert.match(prompt, /[Nn]o(?:t show)? any? ?person|No people/); assert.match(prompt, /presenter/); assert.doesNotMatch(prompt, /reference photo|reference image/);
  }
  assert.equal(storyboardBeatNeedsPerson("Medium shot of the presenter seated at a desk"), true);
  assert.equal(shotForBeat({ index: 1, narration: "x", direction: "I am standing beside the screen" }).character, STORYBOARD_CHARACTER);
});

test("spoken frames carry the locked character and continuity; sizes rotate; portrait follows the canvas", () => {
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

test("a screen or graphic visual note is drawn as a flat graphic, a person note as the creator", async () => {
  const { shotForBeat, isGraphicNote } = await import("./storyboard");
  const { renderShot } = await import("./prompts");
  assert.equal(isGraphicNote("Dark phone screen. A chatbot reply fills it as four grey paragraphs."), true);
  assert.equal(isGraphicNote("I am seated at a desk facing the camera, phone on screen"), false);
  const graphic = renderShot(shotForBeat({ index: 2, narration: "x", direction: "Split screen. JSON on the left and chips on the right." }), "edit", { acceptsText: false }).prompt;
  assert.match(graphic, /flat motion-graphic frame/);
  assert.match(graphic, /Do not show any person/);
  const person = renderShot(shotForBeat({ index: 1, narration: "x", direction: "Presenter at a desk, hands resting on it" }), "edit", { acceptsText: false }).prompt;
  assert.doesNotMatch(person, /flat motion-graphic/);
});
