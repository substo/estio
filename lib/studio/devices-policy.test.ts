import test from "node:test";
import assert from "node:assert/strict";
import { defaultDeviceConfig, normalizePairingCode, readDeviceCommand, readDeviceManagementCommand, readDevicePairPoll, readDevicePairStart, safeDeviceCapabilities } from "./devices-policy";
const requestId = "da000000-0000-4000-8000-000000000001";
test("management commands validate pairing codes, CLI selection and setup", () => {
  assert.deepEqual(readDeviceManagementCommand({ action: "approve_pairing", userCode: "abcd-efgh", requestId }), { action: "approve_pairing", userCode: "ABCDEFGH", requestId });
  assert.deepEqual(readDeviceManagementCommand({ action: "diagnostic", requestId, deviceId: requestId, provider: "codex", model: "gpt-5" }), { action: "diagnostic", requestId, deviceId: requestId, provider: "codex", model: "gpt-5" });
  assert.equal(readDeviceManagementCommand({ action: "save_config", deviceId: requestId, expectedVersion: 0, config: defaultDeviceConfig }).action, "save_config");
  assert.deepEqual(readDeviceManagementCommand({ action: "provider_login", deviceId: requestId, requestId, provider: "claude" }), { action: "provider_login", deviceId: requestId, requestId, provider: "claude" });
  for (const input of [{ action: "create", requestId, name: "Mac" }, { action: "approve_pairing", userCode: "ABCD-EFG0", requestId }, { action: "approve_pairing", userCode: "ABCDEFGH" },
    { action: "diagnostic", requestId, deviceId: requestId, provider: "other" }, { action: "set_processing", deviceId: requestId, enabled: "true" },
    { action: "save_config", deviceId: requestId, expectedVersion: 0, config: { ...defaultDeviceConfig, secret: 1 } }, { action: "provider_login", deviceId: requestId, requestId },
    { action: "diagnostic", requestId, deviceId: requestId, provider: "claude", model: "--secret=$(env)" }, { action: "diagnostic", requestId, deviceId: requestId, model: "gpt-5" }]) assert.throws(() => readDeviceManagementCommand(input));
});
test("pairing bodies and normalized codes", () => {
  assert.equal(normalizePairingCode(" abcd-efgh "), "ABCDEFGH");
  assert.deepEqual(readDevicePairStart({ name: " My Mac ", platform: "darwin" }), { name: "My Mac", platform: "darwin" });
  assert.throws(() => readDevicePairStart({ name: "Mac\u0007", platform: "darwin" }));
  assert.throws(() => readDevicePairPoll({ pairingId: requestId, deviceCode: "short" }));
  assert.equal(readDevicePairPoll({ pairingId: requestId, deviceCode: "a".repeat(43) }).deviceCode.length, 43);
});
test("provider sign-in status accepts only allowlisted links and safe codes", () => {
  const base = { workerId: "mac", commandId: requestId };
  assert.deepEqual(readDeviceCommand("command", { ...base, status: "waiting_for_user", display: { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" } }).display,
    { verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-1234" });
  assert.ok(readDeviceCommand("command", { ...base, status: "waiting_for_user", display: { verificationUrl: `https://claude.ai/oauth/authorize?${"x=1&".repeat(400)}` } }));
  for (const display of [{ verificationUrl: "http://auth.openai.com/x" }, { verificationUrl: "https://evil.example/claude.ai" }, { verificationUrl: "https://auth.openai.com.evil.example" },
    { verificationUrl: "https://claude.ai/x", token: "secret" }, { verificationUrl: "https://claude.ai/x", userCode: "a b" }, { verificationUrl: `https://claude.ai/${"x".repeat(2000)}` }])
    assert.throws(() => readDeviceCommand("command", { ...base, status: "waiting_for_user", display }));
  assert.throws(() => readDeviceCommand("command", { ...base, status: "running", display: { verificationUrl: "https://claude.ai/x" } }));
  assert.throws(() => readDeviceCommand("command", { ...base, status: "succeeded", error: "x" }));
  assert.throws(() => readDeviceCommand("command", { ...base, status: "cancelled" }));
});
test("heartbeat reports hardware/runtimes safely and validates config acks", () => {
  const report = safeDeviceCapabilities({ hardware: { chip: "Apple M1", arch: "arm64", osVersion: "15.1", memoryGb: 8, gpu: "apple-metal", freeDiskGb: 120.55, totalDiskGb: 494,
    power: { source: "battery", batteryPercent: 80, serial: "x" }, timeZone: "Europe/Athens", serial: "secret" }, runtimes: { ollama: "0.5.1", evil: "1", ffmpeg: "$(rm)" },
    localModels: ["llama3.2:3b", "../etc"], codex: { installed: true, loginMethod: "chatgpt" } });
  assert.deepEqual(report, { hardware: { chip: "Apple M1", arch: "arm64", osVersion: "15.1", memoryGb: 8, gpu: "apple-metal", freeDiskGb: 120.6, totalDiskGb: 494,
    power: { source: "battery", batteryPercent: 80 }, timeZone: "Europe/Athens" }, runtimes: { ollama: "0.5.1" }, localModels: ["llama3.2:3b"], codex: { installed: true, loginMethod: "chatgpt" } });
  const big = safeDeviceCapabilities({ localModels: Array.from({ length: 100 }, (_, i) => `m${i}`.padEnd(100, "x")), codex: { models: Array.from({ length: 50 }, (_, i) => `c${i}`.padEnd(100, "x")) }, claude: { models: Array.from({ length: 50 }, (_, i) => `k${i}`.padEnd(100, "x")) } });
  assert.ok(JSON.stringify(big).length <= 16384);
  const hb = { workerId: "mac", release: null, startedAt: new Date().toISOString() };
  assert.deepEqual(readDeviceCommand("heartbeat", { ...hb, configAck: { version: 2, status: "applied", unsupported: { "resources.launchAtLogin": "Needs the installed Mac app (not built yet)" } } }).configAck,
    { version: 2, status: "applied", unsupported: { "resources.launchAtLogin": "Needs the installed Mac app (not built yet)" } });
  for (const configAck of [{ version: -1, status: "applied" }, { version: 1, status: "done" }, { version: 1, status: "error", error: "x".repeat(301) }, { version: 1, status: "applied", unsupported: { k: "x".repeat(201) } }])
    assert.throws(() => readDeviceCommand("heartbeat", { ...hb, configAck }));
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

test("the Connected-computer page refreshes fast only during a command and stops after its window", async () => {
  const { companionRefreshDelay, COMPANION_REFRESH_WINDOW_MS } = await import("./devices-policy");
  assert.equal(companionRefreshDelay(true, 0), 3_000);
  assert.equal(companionRefreshDelay(false, 0), 60_000);
  assert.equal(companionRefreshDelay(false, COMPANION_REFRESH_WINDOW_MS - 1), 60_000);
  assert.equal(companionRefreshDelay(true, COMPANION_REFRESH_WINDOW_MS), null);
});
