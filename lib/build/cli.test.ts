import test from "node:test";
import assert from "node:assert/strict";
import { cliArguments, cliEnvironment, parseCliEvents, runCliAttempt, runCliProcess } from "./cli";
import type { Profile } from "./contract";
const profile: Profile = { id: "codex", enabled: true, provider: "codex", account: "default", billing: "subscription", model: "gpt-6.1-sol", options: { reasoningEffort: "high", serviceTier: "priority" }, quotaBucket: "default", taskTypes: ["review"], tools: ["git-read"], dataScope: "estio-repository", quality: 3, concurrency: 1, maxAttempts: 1, fallbacks: [] };
const json = (...events: unknown[]) => events.map(e => JSON.stringify(e)).join("\n");
test("explicit model/options, isolation and write permission", () => {
  const args = cliArguments(profile, "/tmp");
  assert.ok(args.includes("read-only")); assert.ok(args.includes('service_tier="fast"'));
  assert.ok(args.includes("--ignore-user-config")); assert.ok(args.includes(profile.model));
  assert.throws(() => cliArguments(profile, "/tmp", "workspace-write"), /permit code writes/);
  assert.throws(() => cliArguments({ ...profile, account: "other" }, "/tmp"), /Named accounts/);
  const claude = { ...profile, provider: "claudeAgent" as const, model: "claude-opus-5-5", options: { effort: "max", fastMode: false } };
  const ca = cliArguments(claude, "/tmp");
  assert.ok(ca.includes("--safe-mode")); assert.ok(!ca.includes("--bare")); assert.ok(ca.includes("Read,Glob,Grep")); assert.ok(!ca.includes("Bash"));
  assert.throws(() => cliArguments({ ...claude, options: { effort: "ultrathink" } }, "/tmp"), /unsupported/i);
  assert.throws(() => cliArguments({ ...claude, options: { fastMode: true } }, "/tmp"), /unsupported|fastMode=true/i);
  assert.deepEqual(cliEnvironment({ HOME: "/home/test", OPENAI_API_KEY: "secret", ANTHROPIC_API_KEY: "secret", CODEX_HOME: "/other", NODE_OPTIONS: "injection", CLAUDE_CODE_USE_BEDROCK: "1" }), { NODE_ENV: "production", HOME: "/home/test", NO_COLOR: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" });
});
test("generated quota prose cannot trigger fallback; usage and native session retained", () => {
  const result = parseCliEvents("codex", json({ type: "thread.started", thread_id: "thread-123" }, { type: "item.completed", item: { type: "agent_message", text: "Usage limit reached" } }, { type: "turn.completed", usage: { input_tokens: 42, output_tokens: 3, cached_input_tokens: 12 } }), 0, true);
  assert.equal(result.status, "completed"); assert.equal(result.sessionId, "thread-123"); assert.equal(result.usage?.cachedInputTokens, 12);
  assert.equal(parseCliEvents("codex", json({ type: "turn.failed", error: { message: "Usage limit reached" } }), 1, true).status, "capacity");
  assert.equal(parseCliEvents("codex", json({ type: "turn.failed", error: { code: "rate_limit_exceeded" } }), 1, false).status, "failed");
  assert.equal(parseCliEvents("codex", "not json", 0, true).status, "failed");
  assert.equal(parseCliEvents("claudeAgent", json({ type: "result", is_error: true, subtype: "error_during_execution", result: "Usage limit reached" }), 1, true).status, "failed");
  assert.equal(parseCliEvents("claudeAgent", json({ type: "assistant", error: "rate_limit_error" }), 1, true).status, "capacity");
  assert.equal(parseCliEvents("claudeAgent", json({ type: "result", subtype: "success", is_error: false, result: "done", session_id: "abc-123", usage: { input_tokens: 2, output_tokens: 1, cache_read_input_tokens: 4 } }), 0, true).usage?.cachedInputTokens, 4);
});
test("no-provider cancellation stops detached child group and bounds output", async () => {
  const controller = new AbortController();
  const pending = runCliProcess({ command: process.execPath, args: ["-e", 'require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"inherit"});setInterval(()=>{},1000)'], cwd: process.cwd(), timeoutMs: 4000, signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  const result = await pending;
  assert.equal(result.interruption, "CLI attempt cancelled."); assert.equal(result.stopped, true);
  const bounded = await runCliProcess({ command: process.execPath, args: ["-e", 'process.stdout.write("x".repeat(5*1024*1024));setInterval(()=>{},1000)'], cwd: process.cwd(), timeoutMs: 4000 });
  assert.equal(bounded.interruption, "CLI output exceeded its safe limit."); assert.equal(bounded.stopped, true);
  const invalid = await runCliAttempt({ profile: { ...profile, account: "named" }, cwd: process.cwd(), prompt: "never sent" });
  assert.equal(invalid.status, "failed"); assert.equal(invalid.stopped, true);
});

test("successful final turns supersede recovered capacity; default tier is explicit", () => {
  assert.ok(cliArguments({ ...profile, options: { serviceTier: "default" } }, "/tmp").includes('service_tier="default"'));
  assert.equal(parseCliEvents("codex", json({ type: "error", message: "Usage limit reached" }, { type: "turn.completed", usage: { input_tokens: 1 } }), 0, true).status, "completed");
  assert.equal(parseCliEvents("claudeAgent", json({ type: "assistant", error: "rate_limit_error" }, { type: "rate_limit_event", rate_limit_info: { status: "rejected" } }, { type: "result", subtype: "success", is_error: false, result: "retried successfully" }), 0, true).status, "completed");
  assert.equal(parseCliEvents("codex", json({ type: "turn.completed" }, { type: "turn.failed", error: { code: "rate_limit_exceeded" } }), 1, true).status, "capacity");
});
