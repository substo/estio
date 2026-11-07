import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { runCliProcess, capacity, type CliOutcome } from "./cli";
import type { Profile } from "./contract";

/** Visible T3 Code thread as the Build executor. Dispatch is a local CLI call, not a model turn. */
export type T3Thread = { threadId: string; worktreePath: string; branch: string };
export type T3Outcome = CliOutcome & { thread?: T3Thread; needsAnswer?: boolean };
type Show = { thread?: { threadId?: string; model?: string; providerInstanceId?: string; status?: string; activeRunId?: string | null; latestRunId?: string | null; pendingRequestCount?: number; worktreePath?: string | null; branch?: string | null }; messages?: { role?: string; text?: string; runId?: string }[] };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export function t3Branch(jobId: string, title: string) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task";
  return `build/${slug}-${createHash("sha256").update(jobId).digest("hex").slice(0, 8)}`;
}
async function t3(command: string, args: string[], cwd: string, stdin?: string) {
  const r = await runCliProcess({ command, args, cwd, stdin, timeoutMs: 120_000 });
  if (r.code !== 0) throw new Error(`t3 ${args.slice(0, 2).join(" ")} failed${r.interruption ? `: ${r.interruption}` : ""}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}
export const showThread = (command: string, cwd: string, threadId: string, messages = 1) => t3(command, ["thread", "show", threadId, "--json", "--messages", String(messages)], cwd) as Promise<Show>;

/**
 * Starts one thread in a new T3 worktree at the approved base, reports it via onThread before the writer can
 * meaningfully progress, then polls until the thread is idle. T3 has no CLI interrupt: on abort/timeout the
 * owner is asked to stop the thread in T3, and stop is only reported once T3 shows it idle.
 */
export async function runT3Attempt(input: { command: string; checkout: string; profile: Profile; base: string; branch: string; title: string; prompt: string;
  signal: AbortSignal; onThread: (thread: T3Thread) => Promise<void>; onWaiting?: (reason: string) => void; timeoutMs?: number; stopGraceMs?: number;
  /** Continue this thread (owner feedback) instead of starting one: same worktree, same context, only the note is sent. */
  continueThreadId?: string }): Promise<T3Outcome> {
  if (!input.profile.enabled || input.profile.account !== "default") throw new Error("T3 requires an enabled profile using account 'default'");
  input.signal.throwIfAborted();
  let threadId: string, show: Show;
  if (input.continueThreadId) {
    threadId = input.continueThreadId;
    if (!/^[a-zA-Z0-9:._-]{1,120}$/.test(threadId)) throw new Error("Invalid T3 thread id");
    const before = await showThread(input.command, input.checkout, threadId);
    if (before.thread?.model && before.thread.model !== input.profile.model) throw new Error("Conversation model differs from the approved profile");
    if (before.thread?.providerInstanceId && before.thread.providerInstanceId !== input.profile.provider) throw new Error("Conversation provider differs from the approved profile");
    if (before.thread?.activeRunId) throw new Error("T3 thread is still running; wait for it to finish before redoing");
    await t3(input.command, ["thread", "send", threadId, "-", "--json"], input.checkout, input.prompt);
    // Wait for the new run so the previous run's idle state is never mistaken for the result.
    show = await showThread(input.command, input.checkout, threadId);
    for (let i = 0; i < 60 && show.thread?.latestRunId === before.thread?.latestRunId && !show.thread?.activeRunId; i++) { await sleep(1000); show = await showThread(input.command, input.checkout, threadId); }
    if (show.thread?.latestRunId === before.thread?.latestRunId && !show.thread?.activeRunId) throw new Error("T3 did not start a new run for the feedback");
  } else {
    const started = await t3(input.command, ["thread", "start", input.checkout, "-", "--title", input.title.slice(0, 80), "--provider", input.profile.provider,
      "--model", input.profile.model, "--worktree", input.base, "--branch", input.branch, "--json"], input.checkout, input.prompt);
    threadId = String(started.threadId ?? "");
    if (!/^[a-zA-Z0-9:._-]{1,120}$/.test(threadId)) throw new Error("T3 did not return a thread id");
    show = await showThread(input.command, input.checkout, threadId);
  }
  for (let i = 0; i < 30 && !show.thread?.worktreePath; i++) { await sleep(1000); show = await showThread(input.command, input.checkout, threadId); }
  const thread = { threadId, worktreePath: String(show.thread?.worktreePath ?? ""), branch: String(show.thread?.branch ?? "") };
  if (!thread.worktreePath || thread.branch !== input.branch) throw new Error("T3 thread worktree/branch not reported as requested");
  await input.onThread(thread);
  const deadline = Date.now() + Math.min(input.timeoutMs ?? 2 * 60 * 60_000, 6 * 60 * 60_000);
  let stopAsked: number | null = null;
  for (;;) {
    const t = show.thread ?? {};
    const text = show.messages?.filter(m => m.role === "assistant").at(-1)?.text ?? "";
    if ((t.pendingRequestCount ?? 0) > 0) return { status: "completed", text, stopped: true, needsAnswer: true, thread, sessionId: threadId };
    if (!t.activeRunId && t.status !== "running") {
      const status: CliOutcome["status"] = stopAsked !== null ? "interrupted" : t.status === "completed" ? "completed" : capacity(text.trim()) ? "capacity" : "failed";
      return { status, text, stopped: true, thread, sessionId: threadId, error: status === "failed" ? `T3 thread ended with status ${t.status ?? "unknown"}` : undefined };
    }
    if (stopAsked === null && (input.signal.aborted || Date.now() > deadline)) {
      stopAsked = Date.now();
      input.onWaiting?.(`Stop requested: interrupt T3 thread "${input.title.slice(0, 80)}" (${threadId}); work is preserved`);
    }
    if (stopAsked !== null && Date.now() - stopAsked > (input.stopGraceMs ?? 15 * 60_000))
      return { status: "interrupted", text, stopped: false, thread, sessionId: threadId, error: "T3 thread still running after stop request" };
    await sleep(10_000);
    show = await showThread(input.command, input.checkout, threadId);
  }
}

type Manifest = { manifest?: { currentModels?: Record<string, string[]>; providers?: Record<string, { models?: { slug?: string; name?: string; status?: string }[] }> } };
type Settings = { providerInstances?: Record<string, { driver?: string; enabled?: boolean }> };
/**
 * Current models of enabled T3 provider instances, from T3's self-updating model manifest. New releases and newly
 * enabled providers appear here without code changes; nothing is approved by appearing. Codex and Claude are on by default.
 */
export function t3Catalog(manifest: Manifest, settings: Settings) {
  const instances: Record<string, { driver: string; enabled: boolean }> = { codex: { driver: "codex", enabled: true }, claudeAgent: { driver: "claudeAgent", enabled: true } };
  for (const [key, v] of Object.entries(settings.providerInstances ?? {})) instances[key] = { driver: v.driver ?? key, enabled: v.enabled ?? instances[key]?.enabled ?? false };
  const out: { provider: string; model: string; name: string }[] = [];
  for (const [provider, { driver, enabled }] of Object.entries(instances)) {
    if (!enabled) continue;
    const known = manifest.manifest?.providers?.[driver]?.models ?? [];
    const slugs = new Set([...(manifest.manifest?.currentModels?.[driver] ?? []), ...known.filter(m => m.status === "current").map(m => m.slug ?? "")]);
    for (const model of slugs) if (/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(provider))
      out.push({ provider, model, name: (known.find(m => m.slug === model)?.name ?? model).slice(0, 120) });
  }
  return out.slice(0, 200);
}

export type TalkSync = { messages: { role: string; text: string; runId?: string }[]; running: boolean; needsAnswer: boolean; historyLimit?: number; historyMore?: boolean; historyShortened?: boolean; base?: string };
/**
 * One conversation turn: relays the owner's unsent messages to the conversation's T3 thread (starting it, read-only by
 * instruction, in its own worktree at the latest scanned code), then reports the thread's messages until the run ends.
 */
export async function talkTurn(input: { command: string; checkout: string; branch: string;
  talk: { title: string; threadId: string | null; base: string | null; profile: { provider?: string; model?: string } | null; playbook: string; delimiter: string; messageLimit?: number; unsent: { id: string; text: string }[] };
  sent: (threadId: string, ids: string[]) => Promise<void>; report: (sync: TalkSync) => Promise<void>; timeoutMs?: number }) {
  const { talk } = input;
  let threadId = talk.threadId ?? "";
  if (talk.unsent.length) {
    const text = talk.unsent.map(m => m.text).join("\n\n");
    let before: string | null | undefined;
    if (!threadId) {
      if (!talk.profile?.provider || !talk.profile.model || !/^[a-f0-9]{40}$/.test(talk.base ?? "")) throw new Error("Conversation has no approved model or base");
      const started = await t3(input.command, ["thread", "start", input.checkout, "-", "--title", `Talk: ${talk.title}`.slice(0, 80), "--provider", talk.profile.provider,
        "--model", talk.profile.model, "--worktree", talk.base!, "--branch", input.branch, "--json"], input.checkout, `${talk.playbook}${talk.delimiter}${text}`);
      threadId = String(started.threadId ?? "");
    } else {
      before = (await showThread(input.command, input.checkout, threadId)).thread?.latestRunId;
      await t3(input.command, ["thread", "send", threadId, "-", "--json"], input.checkout, text);
    }
    if (!/^[a-zA-Z0-9:._-]{1,120}$/.test(threadId)) throw new Error("T3 did not return a thread id");
    await input.sent(threadId, talk.unsent.map(m => m.id));
    // Wait for the new run so the previous idle state is not reported as the reply.
    for (let i = 0; i < 60; i++) {
      const t = (await showThread(input.command, input.checkout, threadId)).thread;
      if (t?.activeRunId || (t?.latestRunId && t.latestRunId !== before)) break;
      await sleep(1000);
    }
  }
  if (!threadId) return;
  const deadline = Date.now() + (input.timeoutMs ?? 2 * 60 * 60_000);
  for (;;) {
    const limit = Math.max(1, Math.min(1000, talk.messageLimit ?? 60));
    const show = await showThread(input.command, input.checkout, threadId, limit + 1);
    const t = show.thread ?? {};
    const running = !!t.activeRunId || t.status === "running", needsAnswer = (t.pendingRequestCount ?? 0) > 0;
    const source = (show.messages ?? []).filter(m => m.text);
    const messages = source.slice(-limit).map(m => ({ role: String(m.role ?? "assistant").slice(0, 40), text: String(m.text).slice(0, 20000), runId: m.runId?.slice(0, 200) }));
    let bytes = Buffer.byteLength(JSON.stringify(messages));
    let historyMore = source.length > limit;
    const historyShortened = source.some(m => String(m.text).length > 20000);
    while (bytes > 3 * 1024 * 1024 && messages.length > 1) { bytes -= Buffer.byteLength(JSON.stringify(messages.shift())) + 1; historyMore = true; }
    let base: string | undefined;
    if (t.worktreePath) try { base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: t.worktreePath, encoding: "utf8", timeout: 10000 }).trim(); } catch { /* no workspace yet */ }
    await input.report({ messages, running, needsAnswer, ...(base && /^[a-f0-9]{40}$/.test(base) ? { base } : {}), historyLimit: limit, historyMore, historyShortened });
    if (!running || needsAnswer || Date.now() > deadline) return;
    await sleep(4000);
  }
}
