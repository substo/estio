import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runT3Attempt, t3Branch, talkTurn, type TalkSync } from "./t3";
import type { Profile } from "./contract";

const profile: Profile = { id: "p", enabled: true, provider: "claudeAgent", account: "default", billing: "subscription", model: "claude-sonnet-5-5", options: {}, quotaBucket: "claude", taskTypes: ["implementation"], tools: ["git-read", "code-write"], dataScope: "estio-repository", quality: 2, concurrency: 1, maxAttempts: 1, fallbacks: [] };

// Fake t3: start records argv/stdin; show replays a scripted sequence of states. No provider is called.
async function fake(states: object[]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "t3-fake-"));
  await writeFile(path.join(dir, "states.json"), JSON.stringify(states));
  const script = path.join(dir, "t3");
  await writeFile(script, `#!/usr/bin/env node
const fs = require("fs"), d = ${JSON.stringify(dir)};
const a = process.argv.slice(2);
if (a[1] === "start" || a[1] === "send") { fs.writeFileSync(d + "/start.json", JSON.stringify({ a, stdin: fs.readFileSync(0, "utf8") })); console.log(JSON.stringify({ threadId: "mcp:t1" })); }
else { const s = JSON.parse(fs.readFileSync(d + "/states.json")); const n = Number(fs.existsSync(d + "/n") ? fs.readFileSync(d + "/n", "utf8") : 0);
  fs.writeFileSync(d + "/n", String(n + 1)); console.log(JSON.stringify(s[Math.min(n, s.length - 1)])); }
`);
  await chmod(script, 0o755);
  return { dir, script };
}
const thread = (status: string, extra: object = {}) => ({ thread: { threadId: "mcp:t1", status, activeRunId: status === "running" ? "r1" : null, pendingRequestCount: 0, worktreePath: "/tmp/wt", branch: "build/x-12345678", ...extra }, messages: [{ role: "assistant", text: "done" }] });

test("branch names are stable, bounded slugs", () => {
  assert.match(t3Branch("job:1", "Fix the *Header* on Mobile!"), /^build\/fix-the-header-on-mobile-[a-f0-9]{8}$/);
  assert.equal(t3Branch("a", "x"), t3Branch("a", "x"));
});

test("starts a worktree thread with prompt on stdin, reports it, and returns when idle", async () => {
  const { dir, script } = await fake([thread("completed")]);
  try {
    let reported = "";
    const r = await runT3Attempt({ command: script, checkout: dir, profile, base: "a".repeat(40), branch: "build/x-12345678", title: "Build: x", prompt: "do it", signal: new AbortController().signal, onThread: async t => { reported = t.worktreePath; } });
    assert.equal(r.status, "completed"); assert.equal(r.stopped, true); assert.equal(reported, "/tmp/wt");
    const start = JSON.parse(await readFile(path.join(dir, "start.json"), "utf8"));
    assert.equal(start.stdin, "do it");
    for (const flag of ["--worktree", "--branch", "--provider", "--model", "--json"]) assert(start.a.includes(flag), flag);
    assert(!start.a.includes("--wait"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("pending question, failure, capacity and unconfirmed stop are reported truthfully", async () => {
  const run = async (states: object[], signal = new AbortController().signal, stopGraceMs?: number) => {
    const { dir, script } = await fake(states);
    try { return await runT3Attempt({ command: script, checkout: dir, profile, base: "a".repeat(40), branch: "build/x-12345678", title: "t", prompt: "p", signal, onThread: async () => {}, stopGraceMs }); }
    finally { await rm(dir, { recursive: true, force: true }); }
  };
  assert.equal((await run([thread("running", { pendingRequestCount: 1 })])).needsAnswer, true);
  assert.equal((await run([thread("failed")])).status, "failed");
  assert.equal((await run([{ ...thread("failed"), messages: [{ role: "assistant", text: "You've hit your limit · resets 5pm" }] }])).status, "capacity");
  await assert.rejects(run([thread("completed", { branch: "build/other" })]), /branch/);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(run([thread("completed")], aborted.signal));
});

test("catalog lists current models of enabled providers only", async () => {
  const { t3Catalog } = await import("./t3");
  const manifest = { manifest: { currentModels: { codex: ["gpt-new"], claudeAgent: ["claude-x"], grok: ["grok-build"] }, providers: { codex: { models: [{ slug: "gpt-new", name: "GPT New", status: "current" }, { slug: "gpt-old", status: "legacy" }] } } } };
  const list = t3Catalog(manifest, { providerInstances: { grok: { driver: "grok", enabled: false } } });
  assert.deepEqual(list.map(m => `${m.provider}/${m.model}/${m.name}`), ["codex/gpt-new/GPT New", "claudeAgent/claude-x/claude-x"]);
  assert.equal(t3Catalog(manifest, { providerInstances: { grok: { driver: "grok", enabled: true } } }).some(m => m.model === "grok-build"), true);
});

test("redo continues the same thread with only the note and waits for the new run", async () => {
  const run = (id: string, active: boolean, status: string) => ({ thread: { threadId: "mcp:t1", status, latestRunId: id, activeRunId: active ? id : null, pendingRequestCount: 0, worktreePath: "/tmp/wt", branch: "build/x-12345678" }, messages: [{ role: "assistant", text: `result ${id}` }] });
  const { dir, script } = await fake([run("r1", false, "completed"), run("r1", false, "completed"), run("r2", true, "running"), run("r2", false, "completed")]);
  try {
    const r = await runT3Attempt({ command: script, checkout: dir, profile, base: "a".repeat(40), branch: "build/x-12345678", title: "t", prompt: "make the button blue", continueThreadId: "mcp:t1", signal: new AbortController().signal, onThread: async () => {} });
    assert.equal(r.status, "completed"); assert.equal(r.text, "result r2");
    const sent = JSON.parse(await readFile(path.join(dir, "start.json"), "utf8"));
    assert.equal(sent.a[1], "send"); assert.equal(sent.a[2], "mcp:t1"); assert.equal(sent.stdin, "make the button blue");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("redo refuses a thread that is still running", async () => {
  const { dir, script } = await fake([thread("running")]);
  try { await assert.rejects(runT3Attempt({ command: script, checkout: dir, profile, base: "a".repeat(40), branch: "build/x-12345678", title: "t", prompt: "p", continueThreadId: "mcp:t1", signal: new AbortController().signal, onThread: async () => {} }), /still running/); }
  finally { await rm(dir, { recursive: true, force: true }); }
});

test("a conversation turn starts a read-only thread with the playbook, then reports messages until idle", async () => {
  const { dir, script } = await fake([{ thread: { threadId: "mcp:t1", status: "running", activeRunId: "r1", latestRunId: "r1", pendingRequestCount: 0 } }, { thread: { threadId: "mcp:t1", status: "completed", activeRunId: null, latestRunId: "r1", pendingRequestCount: 0 }, messages: [{ role: "user", text: "PLAYBOOK\n--\nhi", runId: "r1" }, { role: "assistant", text: "What part?", runId: "r1" }] }]);
  try {
    const reports: TalkSync[] = []; let sent: string[] = [];
    await talkTurn({ command: script, checkout: dir, branch: "build/talk-x-12345678", talk: { title: "t", threadId: null, base: "a".repeat(40), profile: { provider: "claudeAgent", model: "m" }, playbook: "PLAYBOOK", delimiter: "\n--\n", unsent: [{ id: "o1", text: "hi" }] },
      sent: async (_, ids) => { sent = ids; }, report: async r => { reports.push(r); } });
    const start = JSON.parse(await readFile(path.join(dir, "start.json"), "utf8"));
    assert.equal(start.stdin, "PLAYBOOK\n--\nhi"); assert(start.a.includes("--worktree")); assert.deepEqual(sent, ["o1"]);
    assert.equal(reports.at(-1)!.running, false); assert.equal(reports.at(-1)!.messages.at(-1)!.text, "What part?");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
