import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, chmod, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, readFile } from "node:fs/promises";
import { appOrigin, saveConfig, loadConfig, defaultConfigDir, type CompanionConfig } from "./config";
import { createDeviceStudioQueue, postCommandStatus, type HeartbeatState } from "./http-queue";
import { createKeychainStore, keychainService, loadCredentials, type DeviceTokenStore } from "./keychain";
import { pairDevice } from "./pairing";
import { parseDf, parseGpu, parseMemoryGb, parseOsVersion, parsePmset, versionOf, discoverHardware, discoverLocalModels, discoverRuntimes } from "./discovery";
import { applyDesiredConfig, DeviceSettings, localGate, withinWorkingHours } from "./settings";
import { executeProviderCommand, parseLoginOutput, runLoginProcess, type LoginProcessRunner } from "./commands";
import { defaultDeviceConfig } from "../devices-policy";
import { createLocalTextAdapter } from "./providers";
import { createCompanionDiagnostic, diagnosticMessage } from "./diagnostic";
import { nativeLoginEnvironment, runNativeProcess, type ProcessRunner, type ProcessRequest } from "./process";

const id = "00000000-0000-4000-8000-000000000001";
const config: CompanionConfig = { version: 2, origin: "https://studio.example", name: "Test Mac", deviceId: id };
const token = `studio_device_${"a".repeat(43)}`;
const credentials = { origin: config.origin, token };
const job = { id, workspace_id: id, kind: "studio.diagnostic", payload: {}, lease_token: id, lease_expires_at: new Date(Date.now() + 120000).toISOString(), attempts: 1, max_attempts: 2 };
const context = { workerId: "mac:test", signal: new AbortController().signal };
const envelope = (data: unknown) => Response.json({ ok: true, data });

test("origin accepts HTTPS and local test HTTP only, with no credential-bearing URL parts", () => {
  assert.equal(appOrigin("https://studio.example/"), "https://studio.example");
  assert.equal(appOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  for (const origin of ["http://studio.example", "https://u:p@studio.example", "https://studio.example/path", "https://studio.example/?token=a", "https://studio.example/#a", "file:///tmp/a"])
    assert.throws(() => appOrigin(origin));
});
test("config is private, round trips and rejects permissive or symlink files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-config-test-"));
  try {
    await saveConfig(config, dir);
    assert.equal((await stat(join(dir, "config.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await loadConfig(dir), config);
    await chmod(join(dir, "config.json"), 0o644);
    await assert.rejects(loadConfig(dir), /unsafe_config_file/);
    await rm(join(dir, "config.json"));
    await symlink("/etc/passwd", join(dir, "config.json"));
    await assert.rejects(loadConfig(dir));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("HTTP uses exact outbound contract and existing retry_scheduled result", async () => {
  const requests: { operation: string; body: Record<string, unknown> }[] = [];
  const queue = createDeviceStudioQueue(credentials, { capabilities: () => ({ codex: { installed: true, models: [] } }), fetcher: async (url, init) => {
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
    const operation = String(url).split("/").at(-1)!;
    requests.push({ operation, body: JSON.parse(String(init?.body)) });
    return envelope(operation === "claim" ? [job] : operation === "heartbeat" ? null : operation === "fail" ? "retry_scheduled" : true);
  } });
  await queue.heartbeat("mac:test", null, new Date(0));
  assert.deepEqual(requests[0].body.report, { codex: { installed: true, models: [] } });
  assert.deepEqual(await queue.claim("mac:test", 1, 120), [job]);
  assert.equal(await queue.extend(id, "mac:test", 120, id), true);
  assert.equal(await queue.complete(id, "mac:test", { ok: true }, id), true);
  assert.equal(await queue.fail(id, "mac:test", { code: "cli_failed", message: "safe", retryable: true }, id), "retry_scheduled");
  assert.deepEqual(requests[2].body, { jobId: id, workerId: "mac:test", leaseSeconds: 120, leaseToken: id });
});
test("HTTP rejects bad envelopes, claims and excessive output without reflecting secrets", async () => {
  for (const response of [envelope({}), envelope([{ ...job, lease_token: "wrong" }]), envelope([{ ...job, kind: "studio.script_brief" }]), Response.json({ ok: false, error: token }), new Response("a".repeat(300000), { headers: { "content-type": "application/json" } })]) {
    const queue = createDeviceStudioQueue(credentials, { fetcher: async () => response });
    await assert.rejects(queue.claim("mac:test", 1, 120), error => error instanceof Error && error.message === "device_claim_failed");
  }
});
test("HTTP rejects redirects without forwarding credentials and times out", async () => {
  const queue = createDeviceStudioQueue(credentials, { timeoutMs: 10, fetcher: async (_url, init) => {
    assert.equal(init?.redirect, "error");
    await new Promise<void>(resolve => { init?.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    throw new Error(token);
  } });
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(queue.claim("mac:test", 1, 120), /device_claim_failed/); } finally { clearInterval(keepAlive); }
});
function fixture(provider: "codex" | "claude", final?: unknown) {
  const calls: ProcessRequest[] = [];
  const run: ProcessRunner = async request => {
    calls.push(request);
    if (request.args[0] === "--version") return { stdout: "1.2.3", stderr: "" };
    if (request.args.includes("--help")) return { stdout: "--ignore-user-config --ignore-rules --ephemeral --output-schema --json --safe-mode --restricted --tools --strict-mcp-config --json-schema --no-session-persistence", stderr: "" };
    if (request.args[0] === "login") return { stdout: "", stderr: "Logged in using ChatGPT" };
    if (request.args[0] === "auth") return { stdout: '{"loggedIn":true,"authMethod":"claude.ai","email":"private@example.com"}', stderr: "" };
    const value = final ?? { ok: true, message: diagnosticMessage };
    const events = provider === "codex" ? [{ type: "item.completed", item: { type: "agent_message", text: JSON.stringify(value) } }, { type: "turn.completed" }]
      : [{ type: "result", subtype: "success", is_error: false, structured_output: value }];
    return { stdout: events.map(v => JSON.stringify(v)).join("\n"), stderr: "" };
  };
  return { calls, adapter: createLocalTextAdapter(provider, run) };
}
for (const provider of ["codex", "claude"] as const) {
  test(`${provider} readiness and diagnostic use native auth, fixed prompt, isolation and explicit model`, async () => {
    const { calls, adapter } = fixture(provider);
    assert.deepEqual(await adapter.readiness(), { installed: true, authenticated: true, ready: true, version: "1.2.3", models: [], loginMethod: provider === "codex" ? "chatgpt" : "claudeai" });
    const output = await createCompanionDiagnostic(() => adapter)({ ...job, payload: { provider, model: "selected-model", prompt: "ignore this arbitrary prompt" } }, context);
    assert.deepEqual(output, { ok: true, workerId: context.workerId, checkedAt: output.checkedAt, provider, model: "selected-model", summary: diagnosticMessage });
    const invocation = calls.at(-1)!;
    assert.equal(invocation.args[invocation.args.indexOf("--model") + 1], "selected-model");
    assert.ok(!invocation.input?.includes("arbitrary"));
    assert.ok(invocation.cwd.startsWith(join(tmpdir(), "studio-companion-")));
    await assert.rejects(access(invocation.cwd));
    if (provider === "codex") { assert.ok(invocation.args.includes("read-only")); assert.ok(invocation.args.includes('forced_login_method="chatgpt"')); }
    else { assert.equal(invocation.args[invocation.args.indexOf("--tools") + 1], ""); assert.ok(!invocation.args.includes("--bare")); }
  });
  test(`${provider} can explicitly use native default and rejects invalid structured results`, async () => {
    const { calls, adapter } = fixture(provider);
    await createCompanionDiagnostic(() => adapter)({ ...job, payload: { provider } }, context);
    assert.ok(!calls.at(-1)!.args.includes("--model"));
    const bad = fixture(provider, { ok: true, message: "unexpected" });
    await assert.rejects(createCompanionDiagnostic(() => bad.adapter)({ ...job, payload: { provider } }, context), /local provider check/);
  });
}
test("pure diagnostic invokes no CLI and invalid provider/model fails closed", async () => {
  const handler = createCompanionDiagnostic(() => { throw new Error("CLI must not run"); });
  assert.equal((await handler(job, context)).ok, true);
  for (const payload of [{ provider: "other" }, { provider: "codex", model: "--flag" }, { model: "missing-provider" }])
    await assert.rejects(handler({ ...job, payload }, context));
});
test("native child environment excludes all API, endpoint, Studio and injected runtime variables", () => {
  assert.deepEqual(nativeLoginEnvironment({ NODE_ENV: "test", HOME: "/home/test", PATH: "/bin", CODEX_HOME: "/native/auth", ANTHROPIC_API_KEY: "secret", OPENAI_API_KEY: "secret", OPENAI_BASE_URL: "https://other", ANTHROPIC_BASE_URL: "https://other", CLAUDE_CODE_OAUTH_TOKEN: "secret", STUDIO_DEVICE_TOKEN: token, NODE_OPTIONS: "--require evil", AWS_ACCESS_KEY_ID: "secret" }), { NODE_ENV: "production", HOME: "/home/test", PATH: "/bin", CODEX_HOME: "/native/auth", NO_COLOR: "1" });
});
test("native subprocess fixtures bound runtime/output and honor cancellation", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "studio-process-test-"));
  try {
    assert.deepEqual(await runNativeProcess({ command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"], cwd, input: "fixture" }), { stdout: "fixture", stderr: "" });
    await assert.rejects(runNativeProcess({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd, timeoutMs: 30 }), /cli_timeout/);
    await assert.rejects(runNativeProcess({ command: process.execPath, args: ["-e", "process.stdout.write('a'.repeat(4096))"], cwd, maxOutputBytes: 100 }), /cli_output_limit/);
    const controller = new AbortController();
    const pending = runNativeProcess({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd, signal: controller.signal });
    controller.abort(); await assert.rejects(pending, /cli_cancelled/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("API auth and unsupported CLI flags cannot start inference or fallback", async () => {
  for (const provider of ["codex", "claude"] as const) {
    let generated = false;
    const adapter = createLocalTextAdapter(provider, async request => {
      if (request.args[0] === "--version") return { stdout: "1.2.3", stderr: "" };
      if (request.args.includes("--help")) return { stdout: "unsupported old CLI", stderr: "" };
      if (request.args[0] === "login") return { stdout: "Logged in using API key", stderr: "" };
      if (request.args[0] === "auth") return { stdout: '{"loggedIn":true,"authMethod":"api_key"}', stderr: "" };
      generated = true; throw new Error("must not generate");
    });
    assert.equal((await adapter.readiness()).ready, false);
    await assert.rejects(adapter.generate({ prompt: "fixed", jsonSchema: {}, validate: v => v, signal: context.signal }), /provider_not_ready/);
    assert.equal(generated, false);
  }
});

// ---- Slice 2: pairing, Keychain, discovery, config, gating, provider commands ----
/** Real outputs captured on the target Mac (MacBook Air M1, macOS 15.7.9); display serial/ids omitted. */
const realMac = {
  brand: "Apple M1\n", memsize: "8589934592\n", swVers: "15.7.9\n",
  df: "Filesystem   1024-blocks      Used Available Capacity iused     ifree %iused  Mounted on\n/dev/disk3s5   482797652 383062872  58669448    87% 4316074 586694480    1%   /System/Volumes/Data\n",
  pmsetAc: "Now drawing from 'AC Power'\n -InternalBattery-0 (id=7798883)\t100%; charged; 0:00 remaining present: true\n",
  pmsetBattery: "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=7798883)\t64%; discharging; 5:12 remaining present: true\n",
  displays: JSON.stringify({ SPDisplaysDataType: [{ _name: "kHW_AppleM1Item", spdisplays_mtlgpufamilysupport: "spdisplays_metal3", sppci_cores: "8", sppci_model: "Apple M1",
    spdisplays_ndrvs: [{ _name: "Color LCD", "_spdisplays_display-serial-number": "omitted" }] }] }),
  ollama: "Warning: could not connect to a running Ollama instance\nWarning: client version is 0.40.5\n",
  python: "Python 3.11.3\n", ffmpeg: "ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\n",
};
test("real Mac hardware output parses into whitelisted metadata only", async () => {
  assert.equal(parseMemoryGb(realMac.memsize), 8);
  assert.equal(parseOsVersion(realMac.swVers), "15.7.9");
  assert.deepEqual(parseDf(realMac.df), { freeDiskGb: 60.1, totalDiskGb: 494.4 });
  assert.deepEqual(parsePmset(realMac.pmsetAc), { source: "ac", batteryPercent: 100 });
  assert.deepEqual(parsePmset(realMac.pmsetBattery), { source: "battery", batteryPercent: 64 });
  assert.deepEqual(parsePmset("Now drawing from 'AC Power'\n"), { source: "ac" });
  assert.equal(parseGpu(realMac.displays), "apple-metal");
  assert.equal(parseGpu("not json"), "unknown");
  assert.equal(versionOf(realMac.ollama), "0.40.5"); assert.equal(versionOf(realMac.ffmpeg), "7.1.1"); assert.equal(versionOf(realMac.python), "3.11.3");
  const calls: ProcessRequest[] = [];
  const run: ProcessRunner = async request => {
    calls.push(request);
    const key = `${request.command} ${request.args.join(" ")}`;
    const out = key.includes("brand_string") ? realMac.brand : key.includes("memsize") ? realMac.memsize : key.includes("sw_vers") ? realMac.swVers
      : key.includes("/bin/df") ? realMac.df : key.includes("pmset") ? realMac.pmsetAc : key.includes("system_profiler") ? realMac.displays
      : key === "ollama --version" ? realMac.ollama : key === "python3 --version" ? realMac.python : key === "ffmpeg -version" ? realMac.ffmpeg : undefined;
    if (out === undefined) throw new Error("not installed");
    return { stdout: out, stderr: "" };
  };
  const hardware = await discoverHardware(run, "/Users/fixture");
  assert.deepEqual({ ...hardware, timeZone: "x" }, { chip: "Apple M1", arch: process.arch, osVersion: "15.7.9", memoryGb: 8, gpu: "apple-metal",
    freeDiskGb: 60.1, totalDiskGb: 494.4, power: { source: "ac", batteryPercent: 100 }, timeZone: "x" });
  assert.ok(!JSON.stringify(hardware).includes("omitted"));
  assert.ok(calls.every(c => !c.command.includes(" ")));
  assert.deepEqual(await discoverRuntimes(run), { ollama: "0.40.5", python: "3.11.3", ffmpeg: "7.1.1" });
});
test("local model discovery returns safe names only, no paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "studio-models-test-"));
  try {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(home, ".ollama/models/manifests/registry.ollama.ai/library/llama3.2"), { recursive: true });
    await writeFile(join(home, ".ollama/models/manifests/registry.ollama.ai/library/llama3.2/3b"), "{}");
    await mkdir(join(home, ".ollama/models/manifests/registry.ollama.ai/acme/tiny"), { recursive: true });
    await writeFile(join(home, ".ollama/models/manifests/registry.ollama.ai/acme/tiny/latest"), "{}");
    await mkdir(join(home, ".lmstudio/models/lmstudio-community/Qwen2.5-7B-GGUF"), { recursive: true });
    await mkdir(join(home, ".lmstudio/models/bad publisher/$(rm -rf)"), { recursive: true });
    await mkdir(join(home, ".cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo"), { recursive: true });
    await mkdir(join(home, ".cache/huggingface/hub/models--adefossez--HTDemucs"), { recursive: true });
    assert.deepEqual(await discoverLocalModels(home, {} as NodeJS.ProcessEnv), ["acme/tiny:latest", "llama3.2:3b", "lmstudio-community/Qwen2.5-7B-GGUF", "mlx-community/whisper-large-v3-turbo"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
function fakeKeychain() {
  const items = new Map<string, string>(); const calls: ProcessRequest[] = [];
  const run: ProcessRunner = async request => {
    calls.push(request);
    const [op, ...rest] = request.args;
    if (op === "-i") {
      const m = request.input!.match(/^add-generic-password -U -a (\S+) -s (\S+) -w (\S+)\n$/);
      if (!m) throw new Error("cli_failed"); items.set(`${m[1]}|${m[2]}`, m[3]); return { stdout: "", stderr: "" };
    }
    const key = `${rest[rest.indexOf("-a") + 1]}|${rest[rest.indexOf("-s") + 1]}`;
    if (op === "find-generic-password") { if (!items.has(key)) throw new Error("cli_failed"); return { stdout: `${items.get(key)}\n`, stderr: "" }; }
    if (op === "delete-generic-password") { items.delete(key); return { stdout: "", stderr: "" }; }
    throw new Error("unexpected");
  };
  return { items, calls, store: createKeychainStore(run) };
}
test("Keychain wrapper never puts the token in argv and verifies the write", async () => {
  const { items, calls, store } = fakeKeychain();
  await store.save(config.origin, token);
  assert.equal(items.get(`${config.origin}|${keychainService}`), token);
  assert.ok(calls.every(c => c.command === "/usr/bin/security" && !c.args.join(" ").includes(token)));
  assert.ok(calls[0].input?.includes(token));
  assert.equal(await store.read(config.origin), token);
  await assert.rejects(store.save(config.origin, "studio_device_short"), /invalid_device_token/);
  await assert.rejects(store.save(config.origin, `${token}\ndelete-keychain x`), /invalid_device_token/);
  await store.remove(config.origin);
  assert.equal(await store.read(config.origin), null);
  // A write that silently fails is detected by the read-back.
  const silent = createKeychainStore(async () => ({ stdout: "", stderr: "" }));
  await assert.rejects(silent.save(config.origin, token), /keychain_write_failed/);
});
test("slice-1 file token migrates into Keychain and is removed from the file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-migrate-test-"));
  try {
    await saveConfig(config, dir);
    const file = join(dir, "config.json");
    await writeFile(file, JSON.stringify({ version: 1, origin: config.origin, token, name: config.name, deviceId: id }), { mode: 0o600 });
    const { store, items } = fakeKeychain();
    const loaded = await loadCredentials(store, dir);
    assert.equal(loaded.migrated, true); assert.equal(loaded.credentials.token, token);
    assert.equal(items.get(`${config.origin}|${keychainService}`), token);
    assert.ok(!(await readFile(file, "utf8")).includes(token));
    assert.deepEqual(await loadConfig(dir), config);
    const again = await loadCredentials(store, dir);
    assert.equal(again.migrated, false); assert.equal(again.credentials.token, token);
    // Keychain failure keeps the file token in place so nothing is lost.
    await writeFile(file, JSON.stringify({ version: 1, origin: config.origin, token, name: config.name, deviceId: id }), { mode: 0o600 });
    await assert.rejects(loadCredentials(createKeychainStore(async () => { throw new Error("cli_failed"); }), dir), /keychain_write_failed/);
    assert.ok((await readFile(file, "utf8")).includes(token));
    await assert.rejects(loadCredentials(fakeKeychain().store, dir).then(() => loadCredentials({ save: async () => {}, read: async () => null, remove: async () => {} }, dir)), /device_token_missing/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("pair opens only the app's approval page, polls until approved and stores the token in Keychain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "studio-pair-test-"));
  try {
    const { store, items } = fakeKeychain(); const opened: string[] = []; const printed: string[] = []; const bodies: Record<string, unknown>[] = [];
    let polls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      assert.equal(init?.redirect, "error"); assert.ok(!(init?.headers as Record<string, string>).authorization);
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      if (String(url).endsWith("/pair/start")) return envelope({ pairingId: id, deviceCode: "d".repeat(43), userCode: "ABCD-EF23",
        verificationUrl: `${config.origin}/studio/settings/computer?code=ABCD-EF23`, expiresAt: new Date(Date.now() + 600000).toISOString(), intervalSeconds: 5 });
      assert.deepEqual(body, { pairingId: id, deviceCode: "d".repeat(43) });
      polls++;
      if (polls === 1) return Response.json({ ok: false, error: "slow down" }, { status: 429 });
      if (polls === 2) return envelope({ status: "pending" });
      return envelope({ status: "approved", token, deviceId: id, businessName: "Acme\u001b[31m Ltd" });
    };
    const result = await pairDevice({ origin: config.origin, name: "Test Mac", platform: "darwin" },
      { fetcher, store, configDir: dir, openUrl: url => opened.push(url), sleep: async () => {}, print: line => printed.push(line) });
    assert.deepEqual(bodies[0], { name: "Test Mac", platform: "darwin" });
    assert.deepEqual(opened, [`${config.origin}/studio/settings/computer?code=ABCD-EF23`]);
    assert.equal(result.businessName, "Acme31m Ltd");
    assert.equal(items.get(`${config.origin}|${keychainService}`), token);
    assert.deepEqual(await loadConfig(dir), config);
    assert.ok(!printed.join("\n").includes(token)); assert.ok(printed.join("\n").includes("ABCD-EF23"));
    assert.ok(!(await readFile(join(dir, "config.json"), "utf8")).includes(token));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("pair refuses foreign approval links and reports denial/expiry", async () => {
  const start = (verificationUrl: string) => envelope({ pairingId: id, deviceCode: "d".repeat(43), userCode: "ABCD-EF23", verificationUrl,
    expiresAt: new Date(Date.now() + 600000).toISOString(), intervalSeconds: 5 });
  const base = { sleep: async () => {}, print: () => {}, store: fakeKeychain().store, configDir: "/nonexistent" };
  const opened: string[] = [];
  await assert.rejects(pairDevice({ origin: config.origin, name: "Mac", platform: "darwin" }, { ...base, openUrl: u => opened.push(u),
    fetcher: async () => start("https://evil.example/studio/settings/computer?code=ABCD-EF23") }), /invalid_pairing_url/);
  assert.deepEqual(opened, []);
  for (const status of ["denied", "expired", "consumed"]) await assert.rejects(pairDevice({ origin: config.origin, name: "Mac", platform: "darwin" }, { ...base, openUrl: () => {},
    fetcher: async url => String(url).endsWith("/start") ? start(`${config.origin}/studio/settings/computer?code=ABCD-EF23`) : envelope({ status }) }), new RegExp(`pairing_${status}`));
  let t = 0;
  await assert.rejects(pairDevice({ origin: config.origin, name: "Mac", platform: "darwin" }, { ...base, openUrl: () => {}, now: () => (t += 400_000),
    fetcher: async url => String(url).endsWith("/start") ? start(`${config.origin}/studio/settings/computer?code=ABCD-EF23`) : envelope({ status: "pending" }) }), /pairing_expired/);
});
test("CLI: setup explains its replacement; bad arguments are refused", async () => {
  const { main } = await import("../../../scripts/studio-companion");
  await assert.rejects(main(["setup", "--origin", config.origin]), /setup_replaced/);
  await assert.rejects(main(["pair"]), /invalid_arguments/);
  await assert.rejects(main(["pair", "--origin", "http://studio.example"]), /invalid_app_origin/);
  await assert.rejects(main(["start", "--token", token]), /invalid_arguments/);
});
const savedConfig = { ...defaultDeviceConfig, features: { transcription: true, text: false },
  resources: { ...defaultDeviceConfig.resources, launchAtLogin: true, minFreeDiskGb: 30 } };
test("desired config is validated with the shared validator and acknowledged with unsupported reasons", () => {
  assert.deepEqual(applyDesiredConfig({ version: 3, value: savedConfig }).ack, { version: 3, status: "applied", unsupported: {
    "resources.launchAtLogin": "Needs the installed Mac app (not built yet)", "features.transcription": "Local workflow not built yet; settings saved for later" } });
  assert.deepEqual(applyDesiredConfig({ version: 4, value: defaultDeviceConfig }).ack, { version: 4, status: "applied" });
  const bad = applyDesiredConfig({ version: 5, value: { ...savedConfig, extra: true } });
  assert.equal(bad.config, null); assert.equal(bad.ack.status, "error"); assert.ok(bad.ack.error!.length <= 300);
  const settings: DeviceSettings = new DeviceSettings();
  const ackOf = () => settings.pendingAck as { version: number; status: string } | undefined;
  const state = (version: number, value: unknown = savedConfig): HeartbeatState => ({ processingEnabled: true, paused: false, config: { version, value }, commands: [] });
  assert.equal(settings.update(state(0, {})), false); assert.equal(settings.pendingAck, undefined);
  assert.equal(settings.update(state(2)), true); assert.equal(ackOf()?.version, 2); assert.equal(settings.config.resources.minFreeDiskGb, 30);
  assert.equal(settings.update(state(2)), false);
  assert.equal(settings.update(state(2), { version: 2, status: "applied" }), false); assert.equal(settings.pendingAck, undefined);
  assert.equal(settings.update(state(3, { nope: 1 })), true); assert.equal(ackOf()?.status, "error");
  assert.equal(settings.config.resources.minFreeDiskGb, 30); // An invalid config keeps the last good one.
  assert.equal(settings.update(null), false);
});
test("heartbeat sends the ack and hands device state back; older null responses still work", async () => {
  const bodies: Record<string, unknown>[] = []; const seen: unknown[] = [];
  const response: HeartbeatState = { processingEnabled: false, paused: true, config: { version: 1, value: defaultDeviceConfig }, commands: [{ id, kind: "provider_login", provider: "codex" }] };
  const queue = createDeviceStudioQueue(credentials, { configAck: () => ({ version: 1, status: "applied" }), onHeartbeat: (state, ack) => seen.push([state, ack]),
    fetcher: async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return envelope(bodies.length === 1 ? response : null); } });
  await queue.heartbeat("mac:test", null, new Date(0)); await queue.heartbeat("mac:test", null, new Date(0));
  assert.deepEqual(bodies[0].configAck, { version: 1, status: "applied" });
  assert.deepEqual(seen, [[response, { version: 1, status: "applied" }], [null, { version: 1, status: "applied" }]]);
  const bad = createDeviceStudioQueue(credentials, { fetcher: async () => envelope({ ...response, commands: [{ id, kind: "shell", provider: "codex" }] }) });
  await assert.rejects(bad.heartbeat("mac:test", null, new Date(0)), /device_heartbeat_failed/);
});
test("local gate: pause stops everything; battery, hours, disk and consent only stop processing", () => {
  const on = { processingEnabled: true, paused: false };
  const base = { config: { ...defaultDeviceConfig, resources: { ...defaultDeviceConfig.resources, minFreeDiskGb: 20 } }, power: { source: "ac" as const }, freeDiskGb: 60 };
  assert.deepEqual(localGate({ ...base, state: on }), { diagnostics: true, processing: true, reasons: [] });
  assert.deepEqual(localGate({ ...base, state: { ...on, paused: true } }), { diagnostics: false, processing: false, reasons: ["paused"] });
  assert.deepEqual(localGate({ ...base, state: { ...on, processingEnabled: false } }).reasons, ["processing_disabled"]);
  assert.deepEqual(localGate({ ...base, state: on, power: { source: "battery" } }), { diagnostics: true, processing: false, reasons: ["on_battery_or_unknown_power"] });
  assert.equal(localGate({ ...base, state: on, power: { source: "battery" }, config: { ...base.config, resources: { ...base.config.resources, allowOnBattery: true } } }).processing, true);
  assert.deepEqual(localGate({ ...base, state: on, freeDiskGb: 10 }).reasons, ["low_disk_space"]);
  const hours = { start: "09:00", end: "17:00", timeZone: "Asia/Nicosia" };
  const noonNicosia = new Date("2026-10-26T10:00:00Z"), nightNicosia = new Date("2026-10-26T21:00:00Z");
  assert.equal(withinWorkingHours(hours, noonNicosia), true); assert.equal(withinWorkingHours(hours, nightNicosia), false);
  assert.equal(withinWorkingHours({ start: "22:00", end: "06:00", timeZone: "Asia/Nicosia" }, nightNicosia), true);
  assert.deepEqual(localGate({ ...base, state: on, now: nightNicosia, config: { ...base.config, resources: { ...base.config.resources, workingHours: hours } } }).reasons, ["outside_working_hours"]);
});
/** Codex device-auth text as printed by codex-cli's device-code flow (not run here: login is never executed in tests). */
const codexDeviceOutput = "\u001b[1mWelcome to Codex\u001b[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mQ7RM-4KXD\u001b[0m\n\n\u001b[90mDevice codes are a common phishing target. Never share this code.\u001b[0m\n";
const claudeLoginOutput = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=xyz\nPaste code here if prompted > ";
test("login output parsing keeps only an allowlisted URL and the device code", () => {
  assert.deepEqual(parseLoginOutput(codexDeviceOutput), { verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD" });
  assert.deepEqual(parseLoginOutput(claudeLoginOutput), { verificationUrl: "https://claude.com/cai/oauth/authorize?code=true&client_id=abc&response_type=code&state=xyz" });
  assert.deepEqual(parseLoginOutput("visit https://evil.example/codex/device then http://auth.openai.com/x\nCODE ABCD-EFGH"), { userCode: "ABCD-EFGH" });
  assert.deepEqual(parseLoginOutput("Go to https://user:pw@auth.openai.com/device."), {});
  assert.deepEqual(parseLoginOutput("See https://auth.openai.com/codex/device."), { verificationUrl: "https://auth.openai.com/codex/device" });
});
const ready = (authenticated: boolean, loginMethod?: "chatgpt" | "claudeai" | "api_key") => ({ installed: true, authenticated, ready: authenticated, models: [], ...(loginMethod ? { loginMethod } : {}) });
test("provider login posts running, the parsed display, then rechecks status", async () => {
  const posts: unknown[] = []; const runs: string[][] = [];
  const login: LoginProcessRunner = async request => { runs.push([request.command, ...request.args]); assert.equal(request.timeoutMs, 15 * 60_000);
    request.onDisplay({ verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD" }); return "exited"; };
  const status = await executeProviderCommand({ id, kind: "provider_login", provider: "codex" }, { signal: new AbortController().signal, login,
    readiness: async () => ready(true, "chatgpt"), post: async s => { posts.push(s); return true; } });
  assert.equal(status, "succeeded");
  assert.deepEqual(runs, [["codex", "login", "--device-auth"]]);
  assert.deepEqual(posts, [{ commandId: id, status: "running" }, { commandId: id, status: "waiting_for_user", display: { verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD" } },
    { commandId: id, status: "succeeded" }]);
  const claudeRuns: string[][] = [];
  const timeout = await executeProviderCommand({ id, kind: "provider_login", provider: "claude" }, { signal: new AbortController().signal,
    login: async r => { claudeRuns.push([r.command, ...r.args]); return "timeout"; }, readiness: async () => ready(false), post: async s => { (posts as unknown[]).push(s); return true; } });
  assert.equal(timeout, "failed"); assert.deepEqual(claudeRuns, [["claude", "auth", "login", "--claudeai"]]);
  assert.deepEqual(posts.at(-1), { commandId: id, status: "failed", error: "Sign-in timed out after 15 minutes." });
  const apiKey = await executeProviderCommand({ id, kind: "provider_login", provider: "claude" }, { signal: new AbortController().signal,
    login: async () => "exited", readiness: async () => ready(false, "api_key"), post: async s => { (posts as unknown[]).push(s); return true; } });
  assert.equal(apiKey, "failed");
});
test("provider login stops when the server reports the command cancelled", async () => {
  let aborted = false;
  const status = await executeProviderCommand({ id, kind: "provider_login", provider: "codex" }, { signal: new AbortController().signal, keepAliveMs: 5,
    login: request => new Promise(resolve => { request.onDisplay({ verificationUrl: "https://auth.openai.com/codex/device" });
      request.signal.addEventListener("abort", () => { aborted = true; resolve("cancelled"); }); }),
    readiness: async () => ready(false), post: async s => s.status !== "waiting_for_user" });
  assert.equal(status, "failed"); assert.equal(aborted, true);
});
test("provider logout runs the CLI's own logout and succeeds only when signed out", async () => {
  const runs: string[][] = []; const posts: unknown[] = [];
  const run: ProcessRunner = async r => { runs.push([r.command, ...r.args]); return { stdout: "secret account text", stderr: "" }; };
  assert.equal(await executeProviderCommand({ id, kind: "provider_logout", provider: "claude" }, { signal: new AbortController().signal, run,
    readiness: async () => ready(false), post: async s => { posts.push(s); return true; } }), "succeeded");
  assert.deepEqual(runs, [["claude", "auth", "logout"]]);
  assert.equal(await executeProviderCommand({ id, kind: "provider_logout", provider: "codex" }, { signal: new AbortController().signal, run,
    readiness: async () => ready(true, "chatgpt"), post: async s => { posts.push(s); return true; } }), "failed");
  assert.deepEqual(runs.at(-1), ["codex", "logout"]);
  assert.ok(!JSON.stringify(posts).includes("secret"));
});
test("command status post uses the Bearer device token and understands cancellation", async () => {
  const bodies: unknown[] = [];
  const fetcher = (data: unknown): typeof fetch => async (url, init) => {
    assert.ok(String(url).endsWith("/api/studio/device/command")); assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
    bodies.push(JSON.parse(String(init?.body))); return envelope(data);
  };
  assert.equal(await postCommandStatus(credentials, "mac:test", { commandId: id, status: "running" }, { fetcher: fetcher(true) }), true);
  assert.deepEqual(bodies[0], { workerId: "mac:test", commandId: id, status: "running" });
  assert.equal(await postCommandStatus(credentials, "mac:test", { commandId: id, status: "running" }, { fetcher: fetcher({ status: "cancelled" }) }), false);
  assert.equal(await postCommandStatus(credentials, "mac:test", { commandId: id, status: "running" }, { fetcher: fetcher(false) }), false);
});
test("login process runner streams only parsed display, never a shell, and times out", async () => {
  const displays: unknown[] = [];
  const script = `process.stdout.write(${JSON.stringify(codexDeviceOutput)}); setInterval(()=>{},1000)`;
  const outcome = await runLoginProcess({ command: process.execPath, args: ["-e", script], timeoutMs: 300, signal: new AbortController().signal, onDisplay: d => displays.push(d) });
  assert.equal(outcome, "timeout");
  assert.deepEqual(displays, [{ verificationUrl: "https://auth.openai.com/codex/device", userCode: "Q7RM-4KXD" }]);
  assert.equal(await runLoginProcess({ command: process.execPath, args: ["-e", "process.exit(0)"], timeoutMs: 5000, signal: new AbortController().signal, onDisplay: () => {} }), "exited");
  assert.equal(await runLoginProcess({ command: "definitely-not-a-cli-xyz", args: [], timeoutMs: 5000, signal: new AbortController().signal, onDisplay: () => {} }), "failed");
});
