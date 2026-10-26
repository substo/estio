import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, chmod, rm, symlink, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appOrigin, saveConfig, loadConfig, defaultConfigDir, type CompanionConfig } from "./config";
import { createDeviceStudioQueue } from "./http-queue";
import { createLocalTextAdapter } from "./providers";
import { createCompanionDiagnostic, diagnosticMessage } from "./diagnostic";
import { nativeLoginEnvironment, runNativeProcess, type ProcessRunner, type ProcessRequest } from "./process";

const id = "00000000-0000-4000-8000-000000000001";
const config: CompanionConfig = { version: 1, origin: "https://studio.example", token: `studio_device_${"a".repeat(43)}`, name: "Test Mac", deviceId: id };
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
  const queue = createDeviceStudioQueue(config, { capabilities: () => ({ codex: { installed: true, models: [] } }), fetcher: async (url, init) => {
    assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${config.token}`);
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
  for (const response of [envelope({}), envelope([{ ...job, lease_token: "wrong" }]), envelope([{ ...job, kind: "studio.script_brief" }]), Response.json({ ok: false, error: config.token }), new Response("a".repeat(300000), { headers: { "content-type": "application/json" } })]) {
    const queue = createDeviceStudioQueue(config, { fetcher: async () => response });
    await assert.rejects(queue.claim("mac:test", 1, 120), error => error instanceof Error && error.message === "device_claim_failed");
  }
});
test("HTTP rejects redirects without forwarding credentials and times out", async () => {
  const queue = createDeviceStudioQueue(config, { timeoutMs: 10, fetcher: async (_url, init) => {
    assert.equal(init?.redirect, "error");
    await new Promise<void>(resolve => { init?.signal?.addEventListener("abort", () => resolve(), { once: true }); });
    throw new Error(config.token);
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
    assert.deepEqual(await adapter.readiness(), { installed: true, authenticated: true, ready: true, version: "1.2.3", models: [] });
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
  assert.deepEqual(nativeLoginEnvironment({ NODE_ENV: "test", HOME: "/home/test", PATH: "/bin", CODEX_HOME: "/native/auth", ANTHROPIC_API_KEY: "secret", OPENAI_API_KEY: "secret", OPENAI_BASE_URL: "https://other", ANTHROPIC_BASE_URL: "https://other", CLAUDE_CODE_OAUTH_TOKEN: "secret", STUDIO_DEVICE_TOKEN: config.token, NODE_OPTIONS: "--require evil", AWS_ACCESS_KEY_ID: "secret" }), { NODE_ENV: "production", HOME: "/home/test", PATH: "/bin", CODEX_HOME: "/native/auth", NO_COLOR: "1" });
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

test("setup authenticates before saving and preserves a working pairing when rejected", async () => {
  const { main } = await import("../../../scripts/studio-companion");
  const home = await mkdtemp(join(tmpdir(), "studio-setup-test-"));
  const previousHome = process.env.HOME;
  const previousToken = process.env.STUDIO_DEVICE_TOKEN;
  const previousFetch = globalThis.fetch;
  const previousLog = console.log;
  const logs: string[] = [];
  try {
    process.env.HOME = home;
    assert.ok(defaultConfigDir().startsWith(home));
    console.log = value => { logs.push(String(value)); };
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.equal(JSON.parse(String(init?.body)).report.version, "studio-companion-1");
      return envelope(null);
    };
    process.env.STUDIO_DEVICE_TOKEN = config.token;
    await main(["setup", "--origin", config.origin, "--name", "Fixture Mac"]);
    const saved = await loadConfig();
    assert.equal(saved.name, "Fixture Mac");
    globalThis.fetch = async () => Response.json({ ok: false, error: config.token }, { status: 401 });
    process.env.STUDIO_DEVICE_TOKEN = `studio_device_${"b".repeat(43)}`;
    await assert.rejects(main(["setup", "--origin", config.origin]), /device_heartbeat_failed/);
    assert.deepEqual(await loadConfig(), saved);
    assert.ok(!logs.join(" ").includes(config.token));
  } finally {
    globalThis.fetch = previousFetch; console.log = previousLog;
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousToken === undefined) delete process.env.STUDIO_DEVICE_TOKEN; else process.env.STUDIO_DEVICE_TOKEN = previousToken;
    await rm(home, { recursive: true, force: true });
  }
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
