import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDesignPrompt, consentSpeech, designError, elevenLabsMeta, facetCounts, filterVoices, fishMeta, normalizeTag, splitByAvailability, voiceStatus, type LibraryVoice, LOCAL_SPEAKER_CATALOG } from "./library";
import { LOCAL_SPEAKERS } from "./policy";

const v = (o: Partial<LibraryVoice> & { id: string; provider: LibraryVoice["provider"]; name: string }): LibraryVoice => ({ providerVoiceId: o.id, kind: "preset", language: null, persona: null, isDefault: false, ...o });
const voices: LibraryVoice[] = [
  v({ id: "a", provider: "elevenlabs", name: "Liam", tags: ["gender:male", "tone:energetic", "use:social"], description: "Energetic, social media creator" }),
  v({ id: "b", provider: "elevenlabs", name: "Alice", tags: ["gender:female", "tone:clear"], isDefault: true }),
  v({ id: "c", provider: "fish", name: "Fish Mark", kind: "clone", tags: ["gender:male"] }),
  v({ id: "d", provider: "local", name: "Ryan", tags: ["gender:male", "tone:energetic"] }),
];
const both = { fish: false, elevenlabs: true, local: "not_installed" as const };

test("elevenlabs labels and fish tags become normalized facet tags", () => {
  assert.deepEqual(elevenLabsMeta({ description: "Warm  voice", labels: { gender: "female", age: "middle_aged", descriptive: "Warm & calm", use_case: "narration", accent: "British", language: "en" } }),
    { description: "Warm  voice", tags: ["gender:female", "age:middle_aged", "tone:warm_calm", "use:narration", "accent:british"] });
  assert.deepEqual(fishMeta({ tags: ["Female", "young", "Soft Spoken", 3], description: "x" }).tags, ["gender:female", "age:young", "tone:soft_spoken"]);
  assert.equal(normalizeTag("color", "red"), null);
});
test("availability: hosted needs a key, local needs the model and a Mac", () => {
  assert.deepEqual(voiceStatus(voices[2], both), { usable: false, need: "key", message: "Add your Fish Audio key in Settings → AI." });
  assert.equal(voiceStatus(voices[0], both).usable, true);
  assert.equal((voiceStatus(voices[3], both) as { need: string }).need, "install");
  assert.equal((voiceStatus(voices[3], { ...both, local: "mac_offline" }) as { need: string }).need, "mac");
  const split = splitByAvailability(voices, both);
  assert.deepEqual(split.usable.map(x => x.id), ["b", "a"]);
  assert.deepEqual(split.unavailable.map(x => x.id), ["c", "d"]);
});
test("filtering: text across fields, quick filters AND, facet tags OR within a facet", () => {
  assert.deepEqual(filterVoices(voices, both, { text: "social energetic" }).map(x => x.id), ["a"]);
  assert.deepEqual(filterVoices(voices, both, { quick: ["available"] }).map(x => x.id), ["a", "b"]);
  assert.deepEqual(filterVoices(voices, both, { quick: ["needs_key"] }).map(x => x.id), ["c"]);
  assert.deepEqual(filterVoices(voices, both, { quick: ["cloned"] }).map(x => x.id), ["c"]);
  assert.deepEqual(filterVoices(voices, both, { tags: ["gender:male"], quick: ["hosted"] }).map(x => x.id), ["a", "c"]);
  assert.deepEqual(filterVoices(voices, both, { tags: ["gender:male", "gender:female"], text: "alice" }).map(x => x.id), ["b"]);
  assert.deepEqual(facetCounts(voices).find(f => f.facet === "gender")!.values[0], { tag: "gender:male", count: 3 });
});
test("every built-in speaker has a descriptor", () => { for (const s of LOCAL_SPEAKERS) assert.ok(LOCAL_SPEAKER_CATALOG[s].description && LOCAL_SPEAKER_CATALOG[s].tags.length); });
test("design prompt is structured, bounded and validated; consent speech is bound to the name", () => {
  const p = buildDesignPrompt({ gender: "woman", age: "young", accent: "British", tone: "warm and upbeat", pace: "medium", notes: "Sounds like a friendly tutorial host." });
  assert.equal(p, "A young woman with a British accent. Tone: warm and upbeat. Pace: medium. Sounds like a friendly tutorial host.");
  assert.equal(designError("short"), "Describe the voice in at least 20 characters.");
  assert.equal(designError(p), null);
  assert.match(consentSpeech("Mark"), /called Mark/);
});
