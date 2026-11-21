import test from "node:test";
import assert from "node:assert/strict";
import { localRoute, runLocalRoute, type LocalStep } from "./route";
import { StudioProviderRejectedError } from "../worker/handlers";
import { createLibrarySummaryHandler } from "./library-summary";
import { createOnboardingResearchHandler } from "./onboarding-research";
import type { LocalProvider, LocalTextAdapter } from "./providers";

const me = "ac000000-0000-4000-8000-000000000001", other = "ac000000-0000-4000-8000-000000000002";
const reading = (remaining: number) => ({ remaining, windows: [], at: new Date().toISOString() });
const full = async () => ({ codex: reading(90), claudeAgent: reading(90) });
const context = { signal: new AbortController().signal, workerId: "mac" };
const ready = (p: LocalProvider, loginMethod = p === "codex" ? "chatgpt" : "claudeai") => async () => ({ installed: true, authenticated: true, ready: true, models: [], loginMethod: loginMethod as "chatgpt" });

test("localRoute walks this Mac's leading device steps and stops at the first server-side step", () => {
  const job = (route: unknown) => ({ payload: {}, route });
  assert.equal(localRoute(job(undefined)), null);
  assert.throws(() => localRoute(job({ candidates: "x" })), /Invalid Location AI route/);
  assert.deepEqual(localRoute(job({ actual: { kind: "device_codex", model: "gpt-5.5" }, candidates: [{ kind: "device_claude", model: null }, { kind: "openai_key" }] }), { defaultModel: p => p === "claude" ? "sonnet" : undefined }),
    { steps: [{ provider: "codex", model: "gpt-5.5" }, { provider: "claude", model: "sonnet" }], serverNext: true });
  assert.deepEqual(localRoute(job({ candidates: [{ kind: "chatgpt_subscription" }, { kind: "device_claude" }] })), { steps: [], serverNext: true });
  // Another of the requester's Macs, or a teammate's, is never run here: the server moves the job.
  assert.deepEqual(localRoute(job({ candidates: [{ kind: "device_codex", deviceId: me }, { kind: "device_claude", deviceId: other }] }), { deviceId: me }),
    { steps: [{ provider: "codex", model: undefined }], serverNext: true });
  // The route may also ride in the payload.
  assert.deepEqual(localRoute({ payload: { route: { candidates: [{ kind: "device_claude", model: "bad model" }, { kind: "device_codex" }] } } }),
    { steps: [{ provider: "codex", model: undefined }], serverNext: false });
});

test("runLocalRoute switches only before generation and never replays a started run", async () => {
  const steps: LocalStep[] = [{ provider: "codex", model: "gpt-5.5" }, { provider: "claude", model: "sonnet" }];
  const calls: string[] = [];
  const adapter = (fail: (p: LocalProvider) => unknown) => (p: LocalProvider): LocalTextAdapter => ({ provider: p, readiness: ready(p),
    generate: async () => { calls.push(p); const e = fail(p); if (e) throw e; return p as never; } });
  const stop = (): never => { throw new Error("stopped"); };
  // Codex at its measured limit: Claude runs, with the reason recorded.
  assert.deepEqual(await runLocalRoute(steps, { adapter: adapter(() => null), usage: async () => ({ codex: reading(0), claudeAgent: reading(80) }) }, context.signal, a => a.generate({} as never), stop),
    { value: "claude", provider: "claude", model: "sonnet", firstLocalStep: steps[0], switchReason: "Codex limit reached → Claude" });
  // A completed rate-limit rejection (no output) moves on.
  calls.length = 0;
  assert.equal((await runLocalRoute(steps, { adapter: adapter(p => p === "codex" ? new StudioProviderRejectedError("rate_limited", "limit", true, undefined, "before_generation") : null), usage: full }, context.signal, a => a.generate({} as never), stop))?.provider, "claude");
  assert.deepEqual(calls, ["codex", "claude"]);
  // Anything else after generation began stops: Claude is never tried.
  calls.length = 0;
  await assert.rejects(runLocalRoute(steps, { adapter: adapter(() => new Error("cli_timeout")), usage: full }, context.signal, a => a.generate({} as never), stop), /stopped/);
  assert.deepEqual(calls, ["codex"]);
  // API-key login is not a subscription: skipped without running; nothing left → null (caller waits).
  const apiKey = (p: LocalProvider): LocalTextAdapter => ({ provider: p, readiness: ready(p, "api_key"), generate: async () => { throw new Error("ran"); } });
  assert.equal(await runLocalRoute(steps, { adapter: apiKey, usage: full }, context.signal, a => a.generate({} as never), stop), null);
});

test("library summary follows the job's order over Setup and reports the actual provider/model", async () => {
  const calls: string[] = [];
  const config = { features: { text: true, transcription: false }, textProvider: "codex", textModel: "gpt-5.5" } as never;
  const adapter = (p: LocalProvider): LocalTextAdapter => ({ provider: p, readiness: ready(p), generate: async req => { calls.push(`${p}:${req.model}`); return req.validate({ summary: "S" }); } });
  const handler = createLibrarySummaryHandler({ adapter, enabled: () => true, usage: async () => ({ codex: reading(0), claudeAgent: reading(80) }), config: () => config, deviceId: me });
  const job = { id: "j", location_id: "l", kind: "studio.library_summary", payload: { description: "Evidence" }, lease_token: "t", attempts: 1, max_attempts: 2,
    route: { candidates: [{ kind: "device_codex", deviceId: me }, { kind: "device_claude", model: "haiku" }] } };
  assert.deepEqual(await handler(job, context), { summary: "S", provider: "claude", model: "haiku" });
  assert.deepEqual(calls, ["claude:haiku"]);
  // Only server-side steps remain: the retryable capacity wait lets the server move the job on.
  await assert.rejects(handler({ ...job, route: { candidates: [{ kind: "device_codex" }, { kind: "chatgpt_subscription" }] } }, context),
    (e: Error & { code?: string; retryable?: boolean }) => e.code === "subscription_capacity" && e.retryable === true);
});

test("onboarding research follows the job's order", async () => {
  const reply = { businessName: "Acme", fields: [] };
  const adapter = (p: LocalProvider): LocalTextAdapter => ({ provider: p, readiness: ready(p), generate: async req => req.validate(reply) });
  const payload = { batch: "b1", topic: "contact", app: "substo", input: { name: "Acme" }, pages: [] };
  const job = { id: "j", location_id: "l", kind: "studio.onboarding_research", payload, lease_token: "t", attempts: 1, max_attempts: 2, route: { candidates: [{ kind: "device_claude", model: "opus" }, { kind: "device_codex" }] } };
  const result = await createOnboardingResearchHandler({ adapter, enabled: () => true, usage: async () => ({ codex: reading(95), claudeAgent: reading(20) }) })(job, context) as { provider: string; model: string };
  assert.deepEqual([result.provider, result.model], ["claude", "opus"]);
});

import { claudeModelIds, codexModelListAnswered, createLocalTextAdapter, parseCodexModelList } from "./providers";
import { runNativeProcess, type ProcessRequest } from "./process";
test("model lists: Codex app-server model/list (validated, hidden dropped), Claude curated; failure never blocks readiness", async () => {
  const reply = JSON.stringify({ id: 2, result: { data: [{ id: "gpt-6.2-sol", hidden: false }, { id: "secret-hidden", hidden: true }, { id: "bad model" }, { id: 7 }, { id: "gpt-6.2-sol" }], nextCursor: null } });
  assert.deepEqual(parseCodexModelList(`{"id":1,"result":{}}\n{"method":"configWarning"}\n${reply}\n`), ["gpt-6.2-sol"]);
  assert.deepEqual(parseCodexModelList('{"id":2,"error":{"code":-32601}}'), []);
  assert.equal(codexModelListAnswered('{"id":2,"error":{"code":-32601}}\n'), true);
  assert.equal(codexModelListAnswered('{"id":1,"result":{}}\n{"id":2,"res'), false);
  assert.ok(claudeModelIds.includes("opus") && claudeModelIds.includes("claude-sonnet-5-5"));
  const fake = (models: (r: ProcessRequest) => Promise<{ stdout: string; stderr: string }>) => async (r: ProcessRequest) => {
    if (r.args[0] === "--version") return { stdout: "codex-cli 0.171.0", stderr: "" };
    if (r.args.includes("--help")) return { stdout: "--ignore-user-config --ignore-rules --ephemeral --output-schema --json", stderr: "" };
    if (r.args[0] === "login") return { stdout: "Logged in using ChatGPT", stderr: "" };
    assert.deepEqual(r.args.slice(0, 1), ["app-server"]); assert.ok(r.until); assert.match(r.input!, /"method":"model\/list"/);
    return models(r);
  };
  const listed: string[] = [];
  const codex = createLocalTextAdapter("codex", fake(async r => { listed.push(r.command); return { stdout: reply, stderr: "" }; }));
  assert.deepEqual((await codex.readiness(undefined, { listModels: true })).models, ["gpt-6.2-sol"]);
  assert.deepEqual((await codex.readiness()).models, []); assert.equal(listed.length, 1); // Job readiness checks never list.
  const broken = await createLocalTextAdapter("codex", fake(async () => { throw new Error("cli_timeout"); })).readiness(undefined, { listModels: true });
  assert.equal(broken.ready, true); assert.deepEqual(broken.models, []);
});
test("held-stdin runs stop once the answer arrives", async () => {
  const script = 'process.stdin.on("data",d=>{if(String(d).includes("ping"))process.stdout.write("{\\"id\\":2,\\"result\\":{}}\\n")});setInterval(()=>{},1000)';
  const { stdout } = await runNativeProcess({ command: process.execPath, args: ["-e", script], cwd: process.cwd(), input: "ping\n", timeoutMs: 5000, until: codexModelListAnswered });
  assert.match(stdout, /"id":2/);
  await assert.rejects(runNativeProcess({ command: process.execPath, args: ["-e", "setInterval(()=>{},1000)"], cwd: process.cwd(), input: "x", timeoutMs: 300, until: () => false }), /cli_timeout/);
});
