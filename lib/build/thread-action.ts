import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { runT3Attempt, showThread } from "./t3";
import type { Profile } from "./contract";

export type ThreadAction = { id: string; kind: "merge" | "deploy"; state: "queued" | "running" | "done" | "blocked"; at: string; revision?: string; reason?: string; text?: string; sha?: string; stopped?: boolean; reconcile?: boolean; resume?: boolean; dispatched?: boolean; comment?: string };
export function actionPrompt(action: ThreadAction, input: { title: string; files: string[]; base: string; canonical: string; branch: string; target: string; receipt?: string }) {
  return `[Build action ${action.id}]\nThe owner approved ${action.kind} for ${JSON.stringify(input.title)}. Continue in THIS conversation using its research and decisions. This explicit approval supersedes earlier planning-only / never-commit instructions solely for this action.\n` + (action.kind === "merge"
    ? `Accept and merge the reviewed changes from branch ${JSON.stringify(input.branch)} into ${input.target}. Reviewed source files: ${JSON.stringify(input.files)}; reviewed base ${input.base}. Use the guarded helper in canonical checkout ${JSON.stringify(input.canonical)}: node --import tsx scripts/build-thread-merge.ts prepare ${JSON.stringify(input.receipt)}. It commits only reviewed content and prepares the canonical merge without pushing. Inspect the merge, resolve conflicts yourself using this conversation, preserving both changes. If resolution needs unrelated files, stop and ask. Run proportionate checks and commit the canonical merge. Then run node --import tsx scripts/build-thread-merge.ts finish ${JSON.stringify(input.receipt)} from that checkout; it verifies the exact parents and file scope before pushing. Never push manually, force-push, reset, deploy, or bypass the helper. Finish with the actual remote revision and result.\n`
    : `Deploy EXACT approved canonical revision ${action.revision}. Use only the clean canonical checkout ${JSON.stringify(input.canonical)}, branch ${input.target}, equal to its freshly fetched remote tip. Stop if it differs from ${action.revision}; this approval does not cover another revision. Read AGENTS.md, documentation/release-workflow.md and .agents/skills/deploy-estio/SKILL.md. Run PRISMA_SCHEMA_SYNC_MODE=migrate-only ./deploy-local-build.sh in that checkout, in the foreground. Never deploy from this task worktree. Preserve all lease, ancestry, fingerprint, backup and manifest guards. No manual cutover, lock deletion or retry after failure. Verify public health/version and the serving manifest. Report actual revision/build/slot and any failure.\n`) + `Owner follow-up: ${JSON.stringify(action.comment ?? "none")}. ${action.resume ? "This is an explicitly approved retry. Preserve existing commits/conflict resolution. For a merge, inspect the existing receipt and canonical merge state before preparing anything again; resolve/commit an already prepared merge and run finish with that same receipt." : ""} Do not start another thread. If anything is ambiguous or blocked, explain it here rather than claiming completion.`;
}
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
/** Read-only verification; all Git mutations and deployment commands belong to the thread. */
export async function verifyThreadAction(action: ThreadAction, input: { checkout: string; canonical: string; target: string; branch: string; base: string; files: string[] }) {
  const remote = git(input.checkout, "ls-remote", "--exit-code", "origin", `refs/heads/${input.target}`).split(/\s/)[0];
  if (!/^[a-f0-9]{40}$/.test(remote)) throw new Error("Remote release identity unavailable");
  if (action.kind === "deploy") {
    const buildId = (await readFile(`${input.canonical}/.next/BUILD_ID`, "utf8")).trim();
    const version = await fetch("https://estio.co/api/version", { cache: "no-store", signal: AbortSignal.timeout(15000) }).then(r => { if (!r.ok) throw Error("Version check failed"); return r.json(); });
    const serving = JSON.parse(execFileSync("ssh", ["root@138.199.214.117", "python3 /usr/local/lib/estio/deploy-guard.py inspect"], { encoding: "utf8", timeout: 30000 }));
    if (serving.revision !== action.revision || remote !== action.revision || version.buildId !== serving.buildId || buildId !== serving.buildId) throw new Error("Serving release does not match the approved revision/build");
    const health = await fetch("https://estio.co/api/health", { signal: AbortSignal.timeout(15000) });
    if (!health.ok) throw new Error("Public health check failed");
    return serving.revision as string;
  }
  const task = git(input.checkout, "rev-parse", `refs/heads/${input.branch}`);
  git(input.checkout, "merge-base", "--is-ancestor", task, remote);
  git(input.checkout, "merge-base", "--is-ancestor", input.base, task);
  git(input.checkout, "diff", "--check", input.base, task);
  const files = git(input.checkout, "diff", "--name-only", input.base, task).split("\n").filter(Boolean);
  if (files.some(f => !input.files.includes(f)) || !files.length) throw new Error("Task commit differs from the reviewed file scope");
  return remote;
}
export async function runThreadAction(input: { action: ThreadAction; command: string; checkout: string; canonical: string; target: string; worktree: string; threadId: string; branch: string; title: string; base: string; files: string[]; profile: Profile; approvalRoot?: string; dispatched: () => Promise<void> }) {
  const before = await showThread(input.command, input.checkout, input.threadId);
  if (before.thread?.branch !== input.branch || before.thread.worktreePath !== input.worktree) throw new Error("Conversation workspace changed; review its linkage first");
  if (before.thread?.activeRunId || before.thread?.pendingRequestCount) throw new Error("Conversation is busy or waiting for an answer; open it before retrying this action");
  if (input.action.reconcile) {
    if (input.action.kind === "merge") {
      const root = input.approvalRoot ?? path.join(process.env.HOME!, ".estio-build", "actions");
      const saved = JSON.parse(await readFile(path.join(root, `${input.action.id}.json`), "utf8"));
      if (saved.base !== input.base || saved.branch !== input.branch) throw new Error("Merge receipt changed");
      const task = saved.taskSha ?? `refs/heads/${input.branch}`;
      for (const { file, blob } of saved.blobs) {
        let actual: string | null = null;
        try { actual = git(input.checkout, "rev-parse", `${task}:${file}`); } catch { /* deletion */ }
        if (actual !== blob) throw new Error(`Committed content differs from the review: ${file}`);
      }
    }
    return { sha: await verifyThreadAction(input.action, input), text: "Existing conversation outcome checked; no new command sent" };
  }
  if (input.action.kind === "deploy") {
    const remote = git(input.checkout, "ls-remote", "origin", `refs/heads/${input.target}`).split(/\s/)[0];
    if (remote !== input.action.revision) throw new Error("Release changed since approval; approve the new release explicitly");
  }
  let expected = input.action.kind === "merge" ? input.files.map(file => ({ file, blob: existsSync(path.join(input.worktree, file)) ? git(input.worktree, "hash-object", "--", file) : null })) : [];
  let receipt: string | undefined;
  if (input.action.kind === "merge") {
    if (!/^[a-zA-Z0-9-]+$/.test(input.action.id)) throw new Error("Invalid action identity");
    const root = input.approvalRoot ?? path.join(process.env.HOME!, ".estio-build", "actions");
    await mkdir(root, { recursive: true, mode: 0o700 });
    receipt = path.join(root, `${input.action.id}.json`);
    if (input.action.resume) {
      const saved = JSON.parse(await readFile(receipt, "utf8"));
      if (saved.worktree !== input.worktree || saved.branch !== input.branch || saved.base !== input.base || JSON.stringify(saved.files) !== JSON.stringify(input.files)) throw new Error("Prior merge approval does not match this task");
      expected = saved.blobs;
    } else await writeFile(receipt, JSON.stringify({ checkout: input.checkout, worktree: input.worktree, canonical: input.canonical, target: input.target, title: input.title, branch: input.branch, files: input.files, base: input.base, blobs: expected }), { mode: 0o600, flag: "wx" });
  }
  await input.dispatched(); // Durable claim BEFORE send; never automatically resend after an uncertain failure.
  const result = await runT3Attempt({ command: input.command, checkout: input.checkout, profile: input.profile, base: input.base, branch: input.branch, title: input.title,
    prompt: actionPrompt(input.action, { ...input, receipt }), continueThreadId: input.threadId, signal: new AbortController().signal, onThread: async () => {} });
  if (!result.stopped || result.needsAnswer || result.status !== "completed") throw new Error(result.needsAnswer ? "The conversation needs your answer; open it" : `Conversation stopped with ${result.status}; inspect it before another attempt`);
  for (const { file, blob } of expected) {
    let actual: string | null = null;
    try { actual = git(input.checkout, "rev-parse", `refs/heads/${input.branch}:${file}`); } catch { /* approved deletion */ }
    if (blob !== actual) throw new Error(`The committed task differs from the reviewed content: ${file}`);
  }
  return { sha: await verifyThreadAction(input.action, input), text: result.text.slice(0, 6000) };
}
