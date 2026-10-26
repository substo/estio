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
test("device config validator normalizes and rejects unsafe setups", async () => {
  const { readDeviceConfig, defaultDeviceConfig } = await import("./devices-policy");
  assert.deepEqual(readDeviceConfig(defaultDeviceConfig), defaultDeviceConfig);
  const config = readDeviceConfig({ ...defaultDeviceConfig, languages: ["en", "EN", "en-gb", "el"], textProvider: "codex", textModel: "gpt-5",
    resources: { ...defaultDeviceConfig.resources, workingHours: { start: "09:00", end: "18:00", timeZone: "Europe/Athens" } } });
  assert.deepEqual(config.languages, ["en", "en-GB", "el"]);
  assert.equal(config.resources.workingHours?.timeZone, "Europe/Athens");
  for (const bad of [{ ...defaultDeviceConfig, extra: true }, { ...defaultDeviceConfig, languages: [] }, { ...defaultDeviceConfig, languages: ["$(rm)"] },
    { ...defaultDeviceConfig, textModel: "gpt-5" }, { ...defaultDeviceConfig, preference: "fast" },
    { ...defaultDeviceConfig, resources: { ...defaultDeviceConfig.resources, maxConcurrentJobs: 2 } },
    { ...defaultDeviceConfig, resources: { ...defaultDeviceConfig.resources, minFreeDiskGb: 1 } },
    { ...defaultDeviceConfig, resources: { ...defaultDeviceConfig.resources, workingHours: { start: "9:00", end: "18:00", timeZone: "Mars/Base" } } },
    { ...defaultDeviceConfig, translationTargets: Array.from({ length: 21 }, () => "en") }]) assert.throws(() => readDeviceConfig(bad));
});
