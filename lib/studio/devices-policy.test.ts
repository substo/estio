import test from "node:test";
import assert from "node:assert/strict";
import { readSheetResult, defaultDeviceConfig, normalizePairingCode, readDeviceCommand, readDeviceManagementCommand, readDevicePairPoll, readDevicePairStart, safeDeviceCapabilities } from "./devices-policy";
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

test("research kinds, capacity and local blocks are the only new report fields kept", async () => {
  const { safeDeviceCapabilities: safe } = await import("./devices-policy");
  assert.deepEqual(safe({ handlers: ["studio.diagnostic", "studio.onboarding_research", "studio.onboarding_research", "studio.library_summary", "x"],
    capacity: { codex: true, claude: "yes", other: true }, processingBlocked: ["on_battery_or_unknown_power", "rm -rf"] }),
    { handlers: ["studio.diagnostic", "studio.onboarding_research", "studio.library_summary"], capacity: { codex: true }, processingBlocked: ["on_battery_or_unknown_power"] });
});
test("Mac research results are bounded and carry no raw provider output", async () => {
  const { readDeviceCommand: read } = await import("./devices-policy");
  const base = { workerId: "mac", jobId: requestId, leaseToken: requestId };
  assert.deepEqual(read("complete", { ...base, result: { research: { fields: [] }, provider: "claude", model: "native-default" } }).result, { research: { fields: [] }, provider: "claude", model: "native-default" });
  assert.deepEqual(read("complete", { ...base, result: { research: { fields: [] }, provider: "codex", model: "gpt-5.5" } }).result, { research: { fields: [] }, provider: "codex", model: "gpt-5.5" });
  for (const result of [{ research: { fields: [] }, provider: "openai", model: "native-default" }, { research: { fields: [] }, provider: "codex", model: "--unsafe" },
    { research: "text", provider: "codex", model: "native-default" }, { research: {}, provider: "codex", model: "native-default", stdout: "x" },
    { research: { big: "x".repeat(30000) }, provider: "codex", model: "native-default" }]) assert.throws(() => read("complete", { ...base, result }));
  assert.equal(read("claim", { workerId: "mac", limit: 1, leaseSeconds: 60, researchReady: true }).researchReady, true);
  assert.equal(read("claim", { workerId: "mac", limit: 1, leaseSeconds: 60, researchReady: "true" }).researchReady, false);
});
test("a Mac is research-capable only while running, opted in, allowed, signed in and with capacity", async () => {
  const { deviceResearchReadiness } = await import("./devices-policy");
  const now = Date.parse("2026-11-06T12:00:00Z");
  const good = { revoked: false, paused: false, processingEnabled: true, allowedKinds: ["studio.diagnostic", "studio.library_summary", "studio.onboarding_research"],
    seenAt: "2026-11-06T11:59:30Z", capabilities: { handlers: ["studio.onboarding_research"], capacity: { codex: true, claude: true },
      codex: { authenticated: true, ready: true, loginMethod: "chatgpt" }, claude: { authenticated: true, ready: true, loginMethod: "console" } } };
  assert.deepEqual(deviceResearchReadiness(good, now), { online: true, ready: true, providers: ["codex"], reason: null });
  const reason = (patch: Record<string, unknown>, caps: Record<string, unknown> = {}) => deviceResearchReadiness({ ...good, ...patch, capabilities: { ...good.capabilities, ...caps } }, now).reason;
  assert.match(reason({ seenAt: "2026-11-06T11:55:00Z" })!, /No recent heartbeat/);
  assert.match(reason({}, { draining: true })!, /draining/);
  assert.equal(reason({ paused: true }), "Paused");
  assert.equal(reason({ processingEnabled: false }), "Processing is off");
  assert.match(reason({ allowedKinds: ["studio.diagnostic"] })!, /isn't allowed/);
  assert.match(reason({}, { handlers: ["studio.diagnostic"] })!, /Update the Studio companion/);
  assert.match(reason({}, { processingBlocked: ["on_battery_or_unknown_power"] })!, /battery/);
  assert.match(reason({}, { codex: { authenticated: true, ready: true, loginMethod: "api_key" } })!, /subscription/);
  assert.match(reason({}, { capacity: { codex: false } })!, /allowance/);
  assert.match(reason({}, { capacity: undefined })!, /allowance/);
});

test("YouTube Mac search capability is whitelisted and the claim flag is boolean-only", () => {
  const safe = safeDeviceCapabilities({ handlers: ["studio.youtube_search", "x"], youtubeSearch: { ready: true, signedIn: false, path: "/Applications/secret" } });
  assert.deepEqual(safe, { handlers: ["studio.youtube_search"], youtubeSearch: { ready: true, rank: false, signedIn: false } });
  assert.deepEqual(safeDeviceCapabilities({ youtubeSearch: { ready: "yes", rank: true } }), { youtubeSearch: { ready: false, rank: true } });
});

/* Regression: a search result was rejected by the device HTTP route ("Invalid command") because it fell through to the diagnostic reader,
 * so no Related-video search ever completed in production. These run the real result shapes through the route's own policy. */
const completeBody = (result: unknown) => ({ workerId: "mac:a01a0d5e:1", jobId: "11111111-1111-4111-8111-111111111111", leaseToken: "22222222-2222-4222-8222-222222222222", result });
const aVideo = (i: number) => ({ id: `v${String(i).padStart(10, "0")}`, title: `Candidate ${i} ${"t".repeat(60)}`, channelId: `UC${"a".repeat(22)}`, channelTitle: "Channel", publishedText: "2 years ago", viewsText: "1,234 views", description: "d".repeat(180),
  score: 80 - i, reason: "Same subject as the source.", band: "relevant" as const });
const aTrace = (videos: Array<{ id: string; score?: number | null; band?: string }>) => ({ version: 1 as const, route: "mac_browser" as const, mode: "plan_search_rank" as const, focus: "what the source is about",
  queries: [{ query: "how professionals start a YouTube channel", by: "model" as const, found: 8 }],
  planner: { provider: "codex" as const, model: "native-default", prompt: "p".repeat(8900), response: "{\"queries\":[]}", ms: 8000 }, ranker: { provider: "codex" as const, model: "native-default", prompt: "r".repeat(8900), response: "{\"rankings\":[]}", ms: 25000 },
  notes: ["note"], candidates: videos.map(v => ({ id: v.id, score: v.score ?? null, band: (v.band ?? "unranked") as "relevant" | "unranked" })) });

test("device route accepts a plain Related-video search result unchanged", () => {
  const result = { videos: [{ id: "aaaaaaaaaaa", title: "A video" }], signedIn: false };
  assert.deepEqual((readDeviceCommand("complete", completeBody(result)) as { result: unknown }).result, result);
  assert.deepEqual((readDeviceCommand("complete", completeBody({ videos: [] })) as { result: unknown }).result, { videos: [] });
});
test("device route accepts a full ranked result with prompts and a trace, without stripping anything", () => {
  const videos = Array.from({ length: 18 }, (_, i) => aVideo(i));
  const result = { videos, signedIn: false, trace: aTrace(videos) };
  assert.ok(JSON.stringify(result).length > 20000 && JSON.stringify(result).length <= 30000, `fixture is ${JSON.stringify(result).length} bytes`);
  assert.deepEqual((readDeviceCommand("complete", completeBody(result)) as { result: unknown }).result, result);
});
test("device route still rejects malformed, oversize or foreign-shaped search results", () => {
  const videos = Array.from({ length: 3 }, (_, i) => aVideo(i));
  for (const bad of [{ videos: [{ id: "short", title: "x" }] }, { videos: [], extra: true }, { videos: [{ ...aVideo(1), score: 101 }] }, { videos: [{ ...aVideo(1), band: "great" }] },
    { videos: [], trace: { secret: "x" } }, { videos, trace: { ...aTrace(videos), planner: { ...aTrace(videos).planner, prompt: "p".repeat(9001) } } },
    { videos: Array.from({ length: 25 }, (_, i) => aVideo(i)) }]) assert.throws(() => readDeviceCommand("complete", completeBody(bad)), /Invalid command/);
  const huge = Array.from({ length: 24 }, (_, i) => ({ ...aVideo(i), title: "t".repeat(300), description: "d".repeat(400), reason: "r".repeat(240), channelTitle: "c".repeat(200) }));
  assert.throws(() => readDeviceCommand("complete", completeBody({ videos: huge })), /Invalid command/);
});
test("other result kinds are routed as before (diagnostic still works, a diagnostic cannot smuggle a search)", () => {
  assert.deepEqual((readDeviceCommand("complete", completeBody({ ok: true, workerId: "mac", checkedAt: "2026-11-19T10:00:00.000Z" })) as { result: unknown }).result, { ok: true, workerId: "mac", checkedAt: "2026-11-19T10:00:00.000Z" });
  assert.throws(() => readDeviceCommand("complete", completeBody({ ok: true, trace: {} })), /Invalid command/);
});

import { readPreviewResult } from "./devices-policy";
test("voice preview: bounded audio result, previewReady claim flag, capability passthrough", () => {
  const audio = "QUJD".repeat(200);
  assert.deepEqual(readPreviewResult({ preview: { audioBase64: audio, speaker: "ryan", bytes: 100, seconds: 3.2 } }).preview.speaker, "ryan");
  assert.throws(() => readPreviewResult({ preview: { audioBase64: "short", speaker: "ryan" } }));
  assert.throws(() => readPreviewResult({ preview: { audioBase64: "A".repeat(24004), speaker: "ryan" } }));
  assert.throws(() => readPreviewResult({ preview: { audioBase64: audio, speaker: "../x" } }));
  assert.throws(() => readPreviewResult({ preview: { audioBase64: audio, speaker: "ryan", extra: 1 } }));
  assert.deepEqual(safeDeviceCapabilities({ voicePreview: { ready: true, junk: 1 } }).voicePreview, { ready: true });
});

test("the character-sheet readiness flag is kept as a bare boolean and nothing else from it", () => {
  const kept = safeDeviceCapabilities({ handlers: ["studio.character_sheet", "studio.bogus"], characterSheet: { ready: true, path: "/Users/x/.codex", token: "secret" } }) as { handlers?: string[]; characterSheet?: unknown };
  assert.deepEqual(kept.handlers, ["studio.character_sheet"]);
  assert.deepEqual(kept.characterSheet, { ready: true });
  assert.deepEqual((safeDeviceCapabilities({ characterSheet: { ready: "yes" } }) as { characterSheet?: unknown }).characterSheet, { ready: false });
  assert.equal((safeDeviceCapabilities({ characterSheet: "x" }) as { characterSheet?: unknown }).characterSheet, undefined);
});

test("the claim keeps the sheetReady flag as a bare boolean (without it a Mac never claims a character sheet)", () => {
  const base = { workerId: "mac", limit: 1, leaseSeconds: 120 };
  assert.equal(readDeviceCommand("claim", { ...base, sheetReady: true }).sheetReady, true);
  assert.equal(readDeviceCommand("claim", { ...base, sheetReady: "yes" }).sheetReady, false);
  assert.equal(readDeviceCommand("claim", base).sheetReady, false);
});

test("a character sheet result is accepted exactly as the Mac sends it, and nothing else gets through", () => {
  const base = { workerId: "mac", jobId: "11111111-1111-4111-8111-111111111111", leaseToken: "22222222-2222-4222-8222-222222222222" };
  const done = readDeviceCommand("complete", { ...base, result: { sheet: "turnaround", files: ["sheet-1.png"] } }) as { result: unknown };
  assert.deepEqual(done.result, { sheet: "turnaround", files: ["sheet-1.png"] });
  for (const bad of [{ sheet: "selfie", files: ["sheet-1.png"] }, { sheet: "face", files: [] }, { sheet: "face", files: ["../sheet-1.png"] }, { sheet: "face", files: ["https://x/sheet-1.png"] }, { sheet: "face", files: ["sheet-1.png"], extra: 1 }, { sheet: "face", files: ["sheet-1.png", "sheet-2.png", "sheet-3.png", "sheet-4.png", "sheet-1.png"] }])
    assert.throws(() => readSheetResult(bad), undefined, JSON.stringify(bad));
});

test("a storyboard result is frame-N.png files only, and sheet names are not frames", () => {
  assert.deepEqual(readSheetResult({ sheet: "storyboard", files: ["frame-1.png", "frame-6.png"] }), { sheet: "storyboard", files: ["frame-1.png", "frame-6.png"] });
  for (const bad of [{ sheet: "storyboard", files: ["sheet-1.png"] }, { sheet: "storyboard", files: ["frame-7.png"] }, { sheet: "storyboard", files: [] }, { sheet: "turnaround", files: ["frame-1.png"] }, { sheet: "storyboard", files: ["frame-1.png", "frame-2.png", "frame-3.png", "frame-4.png", "frame-5.png", "frame-6.png", "frame-6.png"] }])
    assert.throws(() => readSheetResult(bad), undefined, JSON.stringify(bad));
});
