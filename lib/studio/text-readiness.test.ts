import test from "node:test";
import assert from "node:assert/strict";
import { defaultDeviceConfig } from "./devices-policy";
import { deviceTextReadiness } from "./text-readiness";
const now = Date.now();
const input = { revoked: false, paused: false, processingEnabled: true, allowedKinds: ["studio.text_run"], seenAt: new Date(now-1000).toISOString(),
 capabilities: { handlers: ["studio.text_run"], codex: { ready: true, authenticated: true, loginMethod: "chatgpt" }, capacity: { codex: true } },
 config: { ...defaultDeviceConfig, features: { text: true, transcription: false }, textProvider: "codex" as const }, configVersion: 2, appliedVersion: 2, configStatus: "applied" };
test("text readiness is workflow-specific and requires selected subscription settings and fresh heartbeat", () => {
 assert.equal(deviceTextReadiness(input, now).ready, true);
 for (const patch of [{ revoked: true }, { paused: true }, { processingEnabled: false }, { allowedKinds: [] }, { capabilities: {} }, { appliedVersion: 1 }, { configStatus: "pending" }, { seenAt: new Date(now-91000).toISOString() }, { seenAt: new Date(now+1000).toISOString() }, { config: { ...input.config, textProvider: null } }, { config: { ...input.config, features: { text: false, transcription: false } } }, { config: { ...input.config, textProvider: "claude" as const } }])
  assert.equal(deviceTextReadiness({ ...input, ...patch }, now).ready, false, JSON.stringify(patch));
});
