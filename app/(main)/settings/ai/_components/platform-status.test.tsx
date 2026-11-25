import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlatformStatus } from "./platform-status";

const states = (hints: Record<string, string>) => (["openai", "google", "fal", "elevenlabs", "fish", "replicate", "bfl", "ideogram", "stability"] as const).map(id => ({ id, hint: hints[id] ?? null, prefs: {} }));

test("images page: connected platforms show the key tail, unconnected ones ask for a key on Connections", () => {
  const html = renderToStaticMarkup(<PlatformStatus capabilities={["images"]} states={states({ fal: "ab12" })} prefs={{}} />);
  assert.match(html, /fal\.ai/); assert.match(html, /Connected · key ends ab12/);
  assert.match(html, /Needs a key: add it/); assert.match(html, /href="\/settings\/ai\/connections#replicate"/);
  assert.match(html, /1 ready/);
  assert.doesNotMatch(html, /ElevenLabs/);   // does not make images
});

test("a connected platform switched off for this type says so and links to turn it on", () => {
  const html = renderToStaticMarkup(<PlatformStatus capabilities={["images"]} states={states({ fal: "ab12" })} prefs={{ fal: { purposes: ["music"] } }} />);
  assert.match(html, /Switched off for this: turn it on/); assert.match(html, /0 ready/);
});

test("music and sound effects together list each platform once", () => {
  const html = renderToStaticMarkup(<PlatformStatus capabilities={["music", "effects"]} states={states({ fal: "ab12", elevenlabs: "zz99" })} prefs={{}} />);
  assert.equal((html.match(/ElevenLabs/g) ?? []).length, 1); assert.equal((html.match(/fal\.ai/g) ?? []).length, 1); assert.match(html, /2 ready/);
});
