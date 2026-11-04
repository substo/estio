import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Merge assist, run on the Mac. A verified task branch is committed, then merged into the release branch in a temporary
 * detached worktree (the owner's checkout is never switched) and pushed as a fast-forward of the release branch. A
 * conflict is handed to an agent in its own T3 thread; its result is checked before anything is pushed.
 */
const run = (cwd: string, args: string[]) => new Promise<string>((resolve, reject) =>
  execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" } },
    (error, stdout, stderr) => error ? reject(new Error(`git ${args[0]} failed: ${String(stderr || error.message).trim().slice(0, 300)}`)) : resolve(stdout.trim())));
const git = (cwd: string, ...args: string[]) => run(cwd, args);

export type MergeInput = { checkout: string; target: string; remote?: string; title: string; branch: string; worktree: string; files: string[] };

/** Commits the reviewed files on the task branch (once) and returns the task commit. Nothing outside the files is added. */
export async function commitTask(input: MergeInput) {
  const head = await git(input.worktree, "symbolic-ref", "-q", "HEAD");
  if (head !== `refs/heads/${input.branch}`) throw new Error("Task worktree is not on its branch");
  if (await git(input.worktree, "status", "--porcelain", "--", ...input.files)) {
    await git(input.worktree, "add", "-A", "--", ...input.files);
    await git(input.worktree, "commit", "--no-verify", "-m", `Build: ${input.title}`, "--", ...input.files);
  }
  if (await git(input.worktree, "status", "--porcelain")) throw new Error("Task worktree has changes outside the reviewed files");
  return git(input.worktree, "rev-parse", "HEAD");
}

export async function fetchTarget(input: MergeInput) {
  const remote = input.remote ?? "origin";
  await git(input.checkout, "fetch", "--quiet", remote, `refs/heads/${input.target}:refs/remotes/${remote}/${input.target}`);
  return git(input.checkout, "rev-parse", `refs/remotes/${remote}/${input.target}`);
}
const isAncestor = (cwd: string, a: string, b: string) => git(cwd, "merge-base", "--is-ancestor", a, b).then(() => true, () => false);

/** Pushes a commit as a fast-forward of the target; a moved target is rejected by the remote, never overwritten. */
async function push(input: MergeInput, cwd: string, sha: string) {
  await git(cwd, "push", "--quiet", input.remote ?? "origin", `${sha}:refs/heads/${input.target}`);
}
/** Brings the owner's checkout forward when it is on the target and can fast-forward cleanly; otherwise says so. */
export async function updateCheckout(input: MergeInput) {
  try {
    if (await git(input.checkout, "symbolic-ref", "-q", "--short", "HEAD") !== input.target) return `Your Mac checkout is on another branch; ${input.target} on GitHub has the merge`;
    await git(input.checkout, "merge", "--ff-only", "--quiet", `refs/remotes/${input.remote ?? "origin"}/${input.target}`);
    return "Your Mac checkout is up to date";
  } catch { return `Your Mac checkout could not fast-forward (local changes or commits); pull ${input.target} when convenient`; }
}

export type MergeResult = { status: "merged"; sha: string; local: string } | { status: "conflict"; targetSha: string; taskSha: string; conflicts: string[] };
/** Clean merges need no model. Retries if the target moves between merge and push. */
export async function mergeTask(input: MergeInput): Promise<MergeResult> {
  const taskSha = await commitTask(input);
  for (let attempt = 0; attempt < 3; attempt++) {
    const targetSha = await fetchTarget(input);
    if (await isAncestor(input.checkout, taskSha, targetSha)) return { status: "merged", sha: targetSha, local: await updateCheckout(input) };
    const dir = await mkdtemp(path.join(os.tmpdir(), "build-merge-"));
    try {
      await git(input.checkout, "worktree", "add", "--detach", "--quiet", dir, targetSha);
      try { await git(dir, "merge", "--no-ff", "--no-verify", "-m", `Merge Build task: ${input.title}`, taskSha); }
      catch {
        const conflicts = (await git(dir, "diff", "--name-only", "--diff-filter=U").catch(() => "")).split("\n").filter(Boolean);
        await git(dir, "merge", "--abort").catch(() => undefined);
        return { status: "conflict", targetSha, taskSha, conflicts };
      }
      const sha = await git(dir, "rev-parse", "HEAD");
      try { await push(input, dir, sha); } catch { continue; } // Target moved: merge again onto the new tip.
      await fetchTarget(input);
      return { status: "merged", sha, local: await updateCheckout(input) };
    } finally {
      await git(input.checkout, "worktree", "remove", "--force", dir).catch(() => rm(dir, { recursive: true, force: true }));
    }
  }
  throw new Error(`${input.target} kept moving; try the merge again`);
}

/** What the conflict agent is asked to do. It merges, resolves and commits in its own worktree; Build pushes. */
export function resolvePrompt(input: MergeInput & { outcome: string; targetSha: string; taskSha: string; conflicts: string[] }) {
  return `Merge the Build task "${input.title}" into ${input.target}. This worktree is at ${input.target} (${input.targetSha}).
Run: git merge --no-ff ${input.taskSha} -m "Merge Build task: ${input.title}"
It conflicts in: ${input.conflicts.join(", ") || "(see git status)"}.
Resolve every conflict so both survive: the task's intent ("${input.outcome}") and the changes already on ${input.target}. Change only what resolving needs. Run proportionate checks on the resolved files, then commit the merge.
Do not push, rebase, reset, or change other branches; Build verifies and pushes. Finish with what you resolved and the checks you actually ran.`;
}
/**
 * Checks an agent's merge before it is pushed: a clean worktree, a merge commit of exactly the target and the task, no
 * conflict markers, and no file changed that the task did not change.
 */
export async function verifyResolution(input: MergeInput & { cwd: string; targetSha: string; taskSha: string }) {
  if (await git(input.cwd, "status", "--porcelain")) throw new Error("The merge worktree has uncommitted changes");
  const parents = (await git(input.cwd, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ");
  if (parents.length !== 3 || parents[1] !== input.targetSha || parents[2] !== input.taskSha) throw new Error("The agent's commit is not a merge of the release branch and the task");
  await git(input.cwd, "diff", "--check", input.targetSha, "HEAD").catch(() => { throw new Error("Conflict markers or whitespace errors remain"); });
  const changed = (await git(input.cwd, "diff", "--name-only", "--no-renames", input.targetSha, "HEAD")).split("\n").filter(Boolean);
  const outside = changed.filter(f => !input.files.includes(f));
  if (outside.length) throw new Error(`The merge changed files the task didn't: ${outside.slice(0, 5).join(", ")}`);
  return git(input.cwd, "rev-parse", "HEAD");
}
export async function pushResolution(input: MergeInput & { cwd: string; sha: string }) {
  await push(input, input.cwd, input.sha);
  await fetchTarget(input);
  return updateCheckout(input);
}
