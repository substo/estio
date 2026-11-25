import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITIES, CONNECTIONS, CONNECTION_IDS, modelAllowed, offersFor, platformsFor, purposesOf, readConnectionPrefs, usedFor } from "./connections";

test("every platform supports something, every model belongs to a capability it supports, ids are unique per platform", () => {
  for (const id of CONNECTION_IDS) {
    const p = CONNECTIONS[id];
    assert.ok(p.supports.length > 0 && p.keyUrl.startsWith("https://"), id);
    assert.equal(new Set(p.models.map(m => m.id)).size, p.models.length, `${id} repeats a model`);
    for (const m of p.models) assert.ok(p.supports.includes(m.capability), `${id}/${m.id}`);
  }
  assert.deepEqual(CONNECTIONS.fal.supports, ["music", "effects", "images"]);
  assert.ok(CONNECTIONS.elevenlabs.models.some(m => m.id === "eleven_v3" && m.capability === "voice"));
});

test("saved preferences are validated: unknown platforms, capabilities and models are dropped", () => {
  const prefs = readConnectionPrefs({ fal: { purposes: ["images", "voice", "bogus"], disabledModels: ["flux-kontext-pro", "nope", "x; drop"] }, evil: { purposes: ["images"] }, fish: "x" });
  assert.deepEqual(prefs, { fal: { purposes: ["images"], disabledModels: ["flux-kontext-pro"] } });
  assert.deepEqual(readConnectionPrefs(null), {});
  assert.deepEqual(readConnectionPrefs({ fal: {} }), {});
});

test("defaults: used for everything it supports, every model allowed; switching off removes it from offers", () => {
  assert.deepEqual(purposesOf("fal", {}), ["music", "effects", "images"]);
  assert.ok(usedFor("fal", "images", {}) && modelAllowed("fal", "flux-2-pro", {}));
  const on = offersFor("images", { fal: true }, {});
  assert.ok(on.length >= 6 && on.every(o => o.platform === "fal"));
  assert.equal(offersFor("images", { fal: true }, { fal: { purposes: ["music", "effects"] } }).length, 0);
  const noKontext = offersFor("images", { fal: true }, { fal: { disabledModels: ["flux-kontext-pro", "flux-kontext-max"] } });
  assert.ok(!noKontext.some(o => o.model.id.startsWith("flux-kontext")));
  assert.equal(offersFor("images", {}, {}).length, 0);
});

test("the same model is offered on every connected platform that runs it", () => {
  const offers = offersFor("images", { fal: true, replicate: true, bfl: true }, {});
  assert.deepEqual(offers.filter(o => o.model.id === "flux-kontext-max").map(o => o.platform).sort(), ["bfl", "fal", "replicate"]);
});

test("a type's page lists every platform that can serve it, with connected and switched-on state", () => {
  const rows = platformsFor("music", { fal: true }, { elevenlabs: { purposes: ["voice"] } });
  assert.deepEqual(rows.map(r => r.id).sort(), ["elevenlabs", "fal"]);
  assert.deepEqual(rows.find(r => r.id === "fal"), { id: "fal", connected: true, enabled: true });
  assert.equal(rows.find(r => r.id === "elevenlabs")!.enabled, false);
  for (const c of CAPABILITIES) assert.ok(platformsFor(c, {}, {}).length > 0, c);
});
