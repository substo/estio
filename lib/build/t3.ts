import { createHash } from "node:crypto";
import { runCliProcess, capacity, type CliOutcome } from "./cli";
import type { Profile } from "./contract";

/** Visible T3 Code thread as the Build executor. Dispatch is a local CLI call, not a model turn. */
export type T3Thread = { threadId: string; worktreePath: string; branch: string };
export type T3Outcome = CliOutcome & { thread?: T3Thread; needsAnswer?: boolean };
type Show = { thread?: { threadId?: string; status?: string; activeRunId?: string | null; latestRunId?: string | null; pendingRequestCount?: number; worktreePath?: string | null; branch?: string | null }; messages?: { role?: string; text?: string }[] };

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
export const showThread = (command: string, cwd: string, threadId: string) => t3(command, ["thread", "show", threadId, "--json", "--messages", "1"], cwd) as Promise<Show>;

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
