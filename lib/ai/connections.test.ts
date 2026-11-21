import assert from "node:assert/strict";
import test from "node:test";
import { assembleAiConnections, type AiConnectionInputs } from "./connections-model";

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
  const signedIn = { installed: true, authenticated: true, loginMethod: "claudeai" };
  const mac2 = (seenAt: string, claude: Record<string, unknown>, paused = false) => ({ ...none, devices: [{ name: "Studio Mac", revoked: false, paused, seenAt, draining: false, capabilities: { claude, capacity: { claude: true } } }] });
  const r = assembleAiConnections(mac2(recent, signedIn), now);
  assert.equal(r.available, true); assert.equal(r.sources.at(-1)!.label, "Claude on Studio Mac");
  assert.equal(assembleAiConnections(mac2(stale, signedIn), now).sources.at(-1)!.detail, "Mac offline");
  assert.equal(assembleAiConnections(mac2(recent, signedIn, true), now).available, false);
  assert.equal(assembleAiConnections(mac2(recent, { ...signedIn, ready: false }), now).available, false);
  // An API-key login on the Mac is not the business's subscription.
  assert.equal(assembleAiConnections(mac2(recent, { ...signedIn, loginMethod: "console" }), now).available, false);
});

test("the disk gate outranks allowance and an unreadable allowance is distinct from exhaustion", () => {
  const caps = {
    codex: { installed: true, authenticated: true, ready: true, loginMethod: "chatgpt" },
    capacity: { codex: false },
  };
  const connection = (capabilities: Record<string, unknown>) => assembleAiConnections({ ...none, devices: [{
    name: "Mac", revoked: false, paused: false, seenAt: recent, draining: false, capabilities,
  }] }, now).connections!.at(-1)!;
  const disk = connection({ ...caps, processingBlocked: ["low_disk_space"], hardware: { freeDiskGb: 18.2 } });
  assert.equal(disk.status, "unavailable");
  assert.match(disk.reason!, /Low disk space \(18.2 GB free\)/);
  assert.equal(connection(caps).status, "unavailable");
  assert.equal(connection({ ...caps, usage: { codex: { remaining: 0, windows: [], at: recent } } }).status, "limit_reached");
});

test("native CLI readiness admits unknown or low allowance and still reports real denials", () => {
  const native = { nativeSubscriptionVersion: 1, capacity: { codex: true, claude: true },
    codex: { installed: true, authenticated: true, ready: true, loginMethod: "chatgpt" },
    claude: { installed: true, authenticated: true, ready: true, loginMethod: "claudeai" } };
  const deviceConnections = (capabilities: Record<string, unknown>) => assembleAiConnections({ ...none, devices: [{
    name: "Mac", revoked: false, paused: false, seenAt: recent, draining: false, capabilities,
  }] }, now).connections!.filter(connection => connection.scope === "device");
  assert.deepEqual(deviceConnections(native).map(c => [c.status, c.remainingPercent]), [["ready", undefined], ["ready", undefined]]);
  const low = deviceConnections({ ...native, usage: { codex: { remaining: 2, windows: [], at: recent } } });
  assert.equal(low[0].status, "ready");
  assert.equal(low[0].remainingPercent, 2);
  const rejection = deviceConnections({ ...native, nativeRetryAt: { claude: now + 60_000 } });
  assert.equal(rejection[1].status, "limit_reached");
  assert.equal(rejection[1].resetsAt, undefined);
  const legacy = deviceConnections({ ...native, nativeSubscriptionVersion: undefined, capacity: { codex: false, claude: false } });
  assert.ok(legacy.every(connection => connection.status === "unavailable"));
});
