import assert from "node:assert/strict";
import test from "node:test";
import { applyProfileEdits, characterCard, freeAspects, sheetPrompt, singleViewPrompt, type CharacterProfile } from "./character-sheet";

const profile: CharacterProfile = { aspects: [
  { key: "hair", value: "short dark, side parting", locked: true }, { key: "facial hair", value: "light stubble", locked: true },
  { key: "glasses", value: "round tortoiseshell", locked: false }, { key: "clothing", value: "navy crew-neck sweater", locked: false } ], notes: "slim build" };

test("the card repeats only locked aspects and points at the photos instead of describing a face from memory", () => {
  assert.equal(characterCard(profile), "the person in the reference photos, hair: short dark, side parting; facial hair: light stubble; slim build");
  assert.equal(freeAspects(profile), "glasses: round tortoiseshell; clothing: navy crew-neck sweater");
  assert.equal(characterCard({ aspects: [] }), "the person in the reference photos");
});

test("every sheet is on a plain neutral background with no text or other people, and holds the same face", () => {
  for (const kind of ["turnaround", "expressions", "face", "outfits"] as const) {
    const p = sheetPrompt(kind, profile);
    assert.match(p, /plain light-grey studio background/); assert.match(p, /no text, no labels, no other people/); assert.match(p, /exact same face, hairstyle, skin tone and proportions as in the reference photos/);
    assert.match(p, /hair: short dark/);
  }
  assert.match(sheetPrompt("turnaround", profile), /five views in one row, left to right: front, three-quarter left, left side, three-quarter right, back/);
  assert.match(sheetPrompt("turnaround", profile), /\(glasses: round tortoiseshell; clothing: navy crew-neck sweater\)/);
  assert.match(sheetPrompt("expressions", profile), /3 by 3 grid[\s\S]*neutral, warm smile, laughing/);
});

test("a chosen outfit replaces the free aspects; the outfits sheet lists up to four", () => {
  assert.match(sheetPrompt("turnaround", profile, { outfit: "a charcoal suit and white shirt" }), /wearing a charcoal suit and white shirt/);
  const o = sheetPrompt("outfits", profile, { outfits: ["suit", "hoodie", "linen shirt", "gym kit", "fifth ignored"] });
  assert.match(o, /4 full-body panels/); assert.ok(!/fifth ignored/.test(o));
  assert.match(sheetPrompt("outfits", profile), /3 full-body panels[\s\S]*on-camera presenter look/);
});

test("one view at a time for fixing drift", () => {
  assert.match(singleViewPrompt("three-quarter left", profile, "a grey hoodie"), /Single full-body reference picture[\s\S]*wearing a grey hoodie[\s\S]*three-quarter left view/);
});

test("agent edits change aspects safely: set, lock, remove, notes; unknown keys and over-long values are dropped", () => {
  const next = applyProfileEdits(profile, [{ op: "set", key: "clothing", value: "a dark green jacket" }, { op: "lock", key: "glasses", locked: true }, { op: "remove", key: "facial hair" }, { op: "set", key: "accessories", value: "silver watch" }, { op: "notes", value: "  broad shoulders  " },
    { op: "set", key: "bogus" as never, value: "x" }, { op: "set", key: "style", value: "y".repeat(500) }]);
  assert.equal(next.aspects.find(a => a.key === "clothing")!.value, "a dark green jacket");
  assert.equal(next.aspects.find(a => a.key === "clothing")!.locked, false);
  assert.equal(next.aspects.find(a => a.key === "glasses")!.locked, true);
  assert.ok(!next.aspects.some(a => a.key === "facial hair" || (a.key as string) === "bogus"));
  assert.equal(next.aspects.find(a => a.key === "accessories")!.locked, false);   // clothing-like aspects default to free
  assert.equal(next.aspects.find(a => a.key === "style")!.value.length, 200);
  assert.equal(next.notes, "broad shoulders");
  assert.equal(profile.aspects.length, 4, "the original is not mutated");
});
