import assert from "node:assert/strict";
import test from "node:test";
import { assembleAiConnections, type AiConnectionInputs } from "./connections-model";
import { planPlaintextKeyMoves } from "./plaintext-key-move";

const none: AiConnectionInputs = { geminiKey: false, openAiKey: false, chatGpt: { enabled: false, health: null, hasCredential: false }, devices: [] };
const now = Date.parse("2026-11-05T10:00:00Z"), recent = "2026-11-05T09:59:30Z", stale = "2026-11-05T09:00:00Z";

test("nothing connected means AI is not available", () => {
  const r = assembleAiConnections(none, now);
  assert.equal(r.available, false);
  assert.deepEqual(r.sources.map(s => s.kind), ["gemini_key", "openai_key"]);
});

test("any one ready source makes AI available: a key, a connected ChatGPT subscription, or a signed-in online Mac", () => {
  assert.equal(assembleAiConnections({ ...none, openAiKey: true }, now).available, true);
  assert.equal(assembleAiConnections({ ...none, chatGpt: { enabled: true, health: "connected", hasCredential: true } }, now).available, true);
  assert.equal(assembleAiConnections({ ...none, chatGpt: { enabled: true, health: "needs_attention", hasCredential: true } }, now).available, false);
  const mac = (seenAt: string, claude: Record<string, unknown>, paused = false) => ({ ...none, devices: [{ name: "Studio Mac", revoked: false, paused, seenAt, draining: false, capabilities: { claude } }] });
  const signedIn = { installed: true, authenticated: true, loginMethod: "claudeai" };
  const r = assembleAiConnections(mac(recent, signedIn), now);
  assert.equal(r.available, true); assert.equal(r.sources.at(-1)!.label, "Claude on Studio Mac");
  assert.equal(assembleAiConnections(mac(stale, signedIn), now).sources.at(-1)!.detail, "Mac offline");
  assert.equal(assembleAiConnections(mac(recent, signedIn, true), now).available, false);
  // An API-key login on the Mac is not the business's subscription.
  assert.equal(assembleAiConnections(mac(recent, { ...signedIn, loginMethod: "console" }), now).available, false);
});

test("plaintext key retirement copies only when no encrypted key exists, and always clears the column", () => {
  assert.deepEqual(planPlaintextKeyMoves([
    { locationId: "a", hasPlaintext: true, hasSecret: false },
    { locationId: "b", hasPlaintext: true, hasSecret: true },
    { locationId: "c", hasPlaintext: false, hasSecret: false },
  ]), [{ locationId: "a", action: "copy-then-clear" }, { locationId: "b", action: "clear-only" }]);
});
