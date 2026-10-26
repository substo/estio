import test from "node:test";
import assert from "node:assert/strict";
import { readDeviceCommand, readDeviceManagementCommand, safeDeviceCapabilities } from "./devices-policy";
const requestId = "da000000-0000-4000-8000-000000000001";
test("pairing and CLI selection reject unsafe inputs", () => {
  assert.equal(readDeviceManagementCommand({ action: "create", requestId, name: " Mac " }).name, "Mac");
  assert.deepEqual(readDeviceManagementCommand({ action: "diagnostic", requestId, deviceId: requestId, provider: "codex", model: "gpt-5" }).provider, "codex");
  for (const input of [{ action: "create", requestId, name: "" }, { action: "diagnostic", requestId, deviceId: requestId, provider: "other" },
    { action: "diagnostic", requestId, deviceId: requestId, provider: "claude", model: "--secret=$(env)" }, { action: "diagnostic", requestId, deviceId: requestId, model: "gpt-5" }]) assert.throws(() => readDeviceManagementCommand(input));
});
test("heartbeat persists only safe capability metadata", () => {
  assert.deepEqual(safeDeviceCapabilities({ token: "secret", env: { key: "secret" }, codex: { authenticated: true, token: "secret", models: ["gpt-5", "--bad"] }, handlers: ["studio.diagnostic", "studio.script_brief"] }),
    { codex: { authenticated: true, models: ["gpt-5"] }, handlers: ["studio.diagnostic"] });
});
test("queue bounds and failure shape are validated", () => {
  assert.throws(() => readDeviceCommand("complete", { workerId: "mac", jobId: requestId, leaseToken: requestId, result: { token: "secret" } }));
  assert.throws(() => readDeviceCommand("claim", { workerId: "mac", limit: 51, leaseSeconds: 60 }));
  assert.throws(() => readDeviceCommand("extend", { workerId: "mac", jobId: requestId, leaseToken: requestId, leaseSeconds: 9 }));
  assert.throws(() => readDeviceCommand("complete", { workerId: "mac", jobId: requestId, leaseToken: requestId, result: { text: "a".repeat(4096) } }));
  assert.throws(() => readDeviceCommand("fail", { workerId: "mac", jobId: requestId, leaseToken: requestId, failure: { code: "bad", message: "safe", retryable: "yes" } }));
});
