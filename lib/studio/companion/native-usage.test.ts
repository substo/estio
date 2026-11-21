import assert from "node:assert/strict";
import test from "node:test";
import { readNativeUsage, parseCodexAllowance } from "./native-usage";
import { createLocalTextAdapter } from "./providers";
import { completedRateLimit, runNativeProcess, type ProcessRequest } from "./process";
import { runLocalRoute } from "./route";
import { nativeSubscriptionBlocked } from "../subscription-readiness";
import { StudioProviderRejectedError } from "../worker/handlers";

const now = Date.parse("2026-11-21T10:00:00Z");
const allowance = (usedPercent: number, reset = now + 60_000) => JSON.stringify({
  id: 2, result: { rateLimits: { limitId: "codex", primary: { usedPercent, resetsAt: reset / 1000 } } },
});
const cliHelp = "--ignore-user-config --ignore-rules --ephemeral --output-schema --json --safe-mode --restricted --tools --strict-mcp-config --json-schema --no-session-persistence";

test("native Codex telemetry uses the ChatGPT account RPC and never invokes generation or a helper", async () => {
  const calls: ProcessRequest[] = [];
  const usage = await readNativeUsage(async request => {
    calls.push(request);
    return { stdout: calls.length === 1 ? "Logged in using ChatGPT" : allowance(98, Date.now() + 60_000), stderr: "" };
  });
  assert.deepEqual(calls.map(request => request.command), ["codex", "codex"]);
  assert.match(calls[1].input!, /account\/rateLimits\/read/);
  assert.equal(usage.codex.remaining, 2);
  assert.equal(nativeSubscriptionBlocked(usage, "codex"), false);
  assert.deepEqual(await readNativeUsage(async () => ({ stdout: "Logged in using an API key", stderr: "" })), {});
  assert.equal(nativeSubscriptionBlocked(parseCodexAllowance(allowance(100), now), "codex", undefined, now), true);
  assert.deepEqual(parseCodexAllowance(allowance(100, now), now), {});
  assert.deepEqual(parseCodexAllowance('{"id":2,"error":{"code":-32601}}', now), {});
});

const codexDenial = [{ type: "thread.started" }, { type: "turn.started" }, { type: "turn.failed", error: { message: "You've hit your usage limit. Try again later." } }];
const claudeDenial = [{ type: "system", subtype: "init" }, { type: "rate_limit_event", rate_limit_info: { status: "rejected" } },
  { type: "assistant", error: "rate_limit", message: { model: "<synthetic>" } }, { type: "result", is_error: true, usage: { output_tokens: 0 } }];
const stringify = (events: unknown[]) => events.map(event => JSON.stringify(event)).join("\n");

test("both CLIs can execute through a fixture with unknown allowance, including the admitted single provider", async () => {
  for (const provider of ["codex", "claude"] as const) {
    const calls: ProcessRequest[] = [];
    const adapter = createLocalTextAdapter(provider, async request => {
      calls.push(request);
      const stdout = request.args[0] === "--version" ? "test 1.2.3"
        : request.args.includes("--help") ? cliHelp
        : request.args[0] === "login" ? "Logged in using ChatGPT"
        : request.args[0] === "auth" ? '{"loggedIn":true,"authMethod":"claude.ai"}'
        : provider === "codex" ? stringify([{ type: "item.completed", item: { type: "agent_message", text: '{"ok":true}' } }, { type: "turn.completed" }])
        : stringify([{ type: "result", subtype: "success", is_error: false, structured_output: { ok: true } }]);
      return { stdout, stderr: "" };
    });
    const signal = new AbortController().signal;
    const attempt = await runLocalRoute([{ provider, model: undefined }], {
      adapter: p => { assert.equal(p, provider); return adapter; }, usage: async () => ({}),
    }, signal, a => a.generate({ prompt: "fixture", jsonSchema: {}, signal, validate: v => v }), () => { throw new Error("unexpected replay"); });
    assert.deepEqual(attempt?.value, { ok: true });
    assert.ok(calls.every(call => call.command === provider));
  }
});

test("pre-start native quota rejections require a stopped process and no output evidence", async () => {
  for (const [provider, events] of [["codex", codexDenial], ["claude", claudeDenial]] as const) {
    const fixture = stringify(events);
    assert.equal(completedRateLimit(fixture, 1, provider), true);
    assert.equal(completedRateLimit(fixture, null, provider), false);
    assert.equal(completedRateLimit(stringify([{ type: "stream_event" }, ...events]), 1, provider), false);
    assert.equal(completedRateLimit(stringify([{ type: "item.completed" }, ...events]), 1, provider), false);
    const run = () => runNativeProcess({ subscriptionGeneration: provider, command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1]); process.exitCode = 1", fixture], cwd: process.cwd() });
    await assert.rejects(run(), error => error instanceof StudioProviderRejectedError && error.stage === "before_generation");
  }
});
