import assert from "node:assert/strict";
import { test } from "node:test";
import { interpret } from "./assistant";
import type { Availability, LibraryVoice } from "./library";

const v = (id: string, name: string, provider: LibraryVoice["provider"], tags: string[], o: Partial<LibraryVoice> = {}): LibraryVoice => ({ id, providerVoiceId: id, name, provider, kind: "preset", language: null, persona: null, isDefault: false, tags, description: `${name} desc`, ...o });
const voices = [v("liam", "Liam - Energetic, Social Media Creator", "elevenlabs", ["gender:male", "tone:energetic", "use:social"]), v("alice", "Alice - Clear Educator", "elevenlabs", ["gender:female", "tone:clear", "use:narration"]),
  v("mark", "Mark", "fish", ["gender:male"], { kind: "clone" }), v("ryan", "Ryan", "local", ["gender:male", "tone:energetic"])];
const a: Availability = { fish: false, elevenlabs: true, local: "ready" };

test("finding by traits applies facet filters and names the best usable matches", () => {
  const t = interpret("find a warm female narrator", voices, a);
  assert.equal(t.action.kind, "filter"); assert.deepEqual((t.action as { tags: string[] }).tags.sort(), ["gender:female", "use:narration"]);
  assert.deepEqual(t.voiceIds, ["alice"]);
  assert.deepEqual(interpret("which voices need a key", voices, a).action, { kind: "filter", text: "", tags: [], quick: ["needs_key"] });
  assert.equal(interpret("show me on-device voices", voices, a).voiceIds[0], "ryan");
});
test("compare, preview and default use voice names and respect availability", () => {
  assert.deepEqual(interpret("compare Liam and Alice", voices, a).action, { kind: "compare", ids: ["liam", "alice"] });
  assert.deepEqual(interpret("preview ryan", voices, a).action, { kind: "preview", id: "ryan" });
  assert.deepEqual(interpret("make Alice the default", voices, a).action, { kind: "default", id: "alice" });
  const blocked = interpret("make Mark my default voice", voices, a);
  assert.equal(blocked.action.kind, "unknown"); assert.match(blocked.reply, /Add your Fish Audio key/);
  assert.match(interpret("preview Mark", voices, a).reply, /not available yet/);
});
test("design requests prefill the Design form and never spend on their own", () => {
  const t = interpret("design a calm British man in his fifties, speaking slowly", voices, a);
  assert.equal(t.action.kind, "design");
  assert.deepEqual({ ...(t.action as { fields: Record<string, string> }).fields, notes: "" }, { notes: "", gender: "man", accent: "British", tone: "calm", pace: "slow" });
  assert.match(t.reply, /uses your ElevenLabs credits/);
});
test("help, empty and gibberish answer without acting", () => {
  assert.equal(interpret("help", voices, a).action.kind, "help");
  assert.equal(interpret("", voices, a).action.kind, "unknown");
  assert.equal(interpret("xyzzy", voices, a).action.kind, "unknown");
  assert.match(interpret("find a purple voice", voices, a).reply, /No voice matches/);
});
