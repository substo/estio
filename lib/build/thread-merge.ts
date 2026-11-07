/** Invoked by the conversation as its tool, never by the background worker. */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { commitTask, verifyResolution, pushResolution, type MergeInput } from "./merge";
import { validateDeliveryPath } from "./delivery";
export type MergeApproval = MergeInput & { canonical: string; base: string; blobs: { file: string; blob: string | null }[]; targetSha?: string; taskSha?: string };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } }).trim();
export async function threadMerge(receipt: string, phase: "prepare" | "finish") {
  const approval = JSON.parse(await readFile(receipt, "utf8")) as MergeApproval;
  if (approval.target !== "release/studio-go-live" || !/^build\/[a-z0-9-]+$/.test(approval.branch) || !/^[a-f0-9]{40}$/.test(approval.base)) throw new Error("Invalid merge approval");
  approval.files.forEach(validateDeliveryPath);
  if (git(approval.canonical, "symbolic-ref", "--short", "HEAD") !== approval.target) throw new Error("Canonical checkout is on another branch");
  const checkTask = (revision: string) => {
    for (const { file, blob } of approval.blobs) {
      let actual: string | null = null;
      try { actual = git(approval.worktree, "rev-parse", `${revision}:${file}`); } catch { /* deletion */ }
      if (actual !== blob) throw new Error(`Unreviewed task content: ${file}`);
    }
    const changed = git(approval.worktree, "diff", "--name-only", "--no-renames", approval.base, revision).split("\n").filter(Boolean);
    if (changed.some(f => !approval.files.includes(f))) throw new Error("Task commit changed files outside review");
  };
  if (phase === "prepare") {
    if (git(approval.canonical, "status", "--porcelain")) throw new Error("Canonical checkout is dirty; preserve it and stop");
    const taskSha = await commitTask(approval);
    checkTask(taskSha);
    git(approval.canonical, "fetch", "origin", "release/studio-go-live");
    const targetSha = git(approval.canonical, "rev-parse", "refs/remotes/origin/release/studio-go-live");
    git(approval.canonical, "merge", "--ff-only", targetSha);
    await writeFile(receipt, JSON.stringify({ ...approval, targetSha, taskSha }), { mode: 0o600 });
    // Stop before the merge commit, including clean merges: the agent reviews and commits it in this conversation.
    try { git(approval.canonical, "merge", "--no-ff", "--no-commit", taskSha); }
    catch { throw new Error("Resolve the preserved merge conflicts in the canonical checkout, run focused checks, commit, then run finish. Nothing pushed."); }
    return { prepared: true, canonical: approval.canonical, targetSha, taskSha };
  }
  if (!approval.targetSha || !approval.taskSha) throw new Error("Merge was not prepared with this approval");
  checkTask(approval.taskSha);
  const sha = await verifyResolution({ ...approval, cwd: approval.canonical, targetSha: approval.targetSha, taskSha: approval.taskSha });
  // verifyResolution checks exact parents, clean state, scope and whitespace BEFORE this push.
  return { sha, local: await pushResolution({ ...approval, cwd: approval.canonical, sha }) };
}
