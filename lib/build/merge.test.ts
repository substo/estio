import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mergeTask, verifyResolution } from "./merge";

// A bare "GitHub", the owner's checkout on the release branch, and a task worktree with uncommitted changes.
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), "build-merge-test-"));
  const g = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" }).trim();
  const remote = path.join(root, "remote.git"), checkout = path.join(root, "checkout"), worktree = path.join(root, "task");
  g(root, "init", "-q", "--bare", "-b", "release", remote);
  g(root, "clone", "-q", remote, checkout);
  for (const [k, v] of [["user.email", "t@t"], ["user.name", "t"], ["commit.gpgsign", "false"]]) g(checkout, "config", k, v);
  await writeFile(path.join(checkout, "a.txt"), "one\ntwo\nthree\n"); await writeFile(path.join(checkout, "b.txt"), "b\n");
  g(checkout, "checkout", "-q", "-b", "release"); g(checkout, "add", "."); g(checkout, "commit", "-q", "-m", "base"); g(checkout, "push", "-q", "origin", "release");
  const base = g(checkout, "rev-parse", "HEAD");
  g(checkout, "worktree", "add", "-q", "-b", "build/task-1", worktree, base);
  return { root, remote, checkout, worktree, base, g };
}

test("a clean task merges into the release branch, is pushed, and the owner's checkout fast-forwards", async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.worktree, "a.txt"), "one\nTWO\nthree\n");
    const r = await mergeTask({ checkout: s.checkout, target: "release", title: "Shout two", branch: "build/task-1", worktree: s.worktree, files: ["a.txt"] });
    assert.equal(r.status, "merged");
    assert.equal(s.g(s.remote, "rev-parse", "release"), r.status === "merged" ? r.sha : "");
    assert.equal(await readFile(path.join(s.checkout, "a.txt"), "utf8"), "one\nTWO\nthree\n");
    // Merging again is a no-op: the task is already contained.
    assert.equal((await mergeTask({ checkout: s.checkout, target: "release", title: "Shout two", branch: "build/task-1", worktree: s.worktree, files: ["a.txt"] })).status, "merged");
  } finally { await rm(s.root, { recursive: true, force: true }); }
});

test("a conflict is reported, not pushed; an agent's resolution is checked before it may be pushed", async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.worktree, "a.txt"), "one\nTASK\nthree\n");
    await writeFile(path.join(s.checkout, "a.txt"), "one\nRELEASE\nthree\n"); s.g(s.checkout, "commit", "-q", "-am", "release change"); s.g(s.checkout, "push", "-q", "origin", "release");
    const before = s.g(s.remote, "rev-parse", "release");
    const r = await mergeTask({ checkout: s.checkout, target: "release", title: "Task", branch: "build/task-1", worktree: s.worktree, files: ["a.txt"] });
    assert.equal(r.status, "conflict");
    if (r.status !== "conflict") return;
    assert.deepEqual(r.conflicts, ["a.txt"]);
    assert.equal(s.g(s.remote, "rev-parse", "release"), before);
    // Simulate the agent: resolve in its own worktree and commit the merge.
    const agent = path.join(s.root, "agent");
    s.g(s.checkout, "worktree", "add", "-q", "--detach", agent, r.targetSha);
    try { s.g(agent, "merge", "--no-ff", "-m", "merge", r.taskSha); } catch { /* conflict expected */ }
    await writeFile(path.join(agent, "a.txt"), "one\nRELEASE and TASK\nthree\n"); s.g(agent, "add", "a.txt"); s.g(agent, "commit", "-q", "--no-edit");
    const input = { checkout: s.checkout, target: "release", title: "Task", branch: "build/task-1", worktree: s.worktree, files: ["a.txt"], cwd: agent, targetSha: r.targetSha, taskSha: r.taskSha };
    assert.match(await verifyResolution(input), /^[a-f0-9]{40}$/);
    // Touching a file the task never changed is refused.
    await writeFile(path.join(agent, "b.txt"), "changed\n"); s.g(agent, "commit", "-q", "--amend", "-a", "--no-edit");
    await assert.rejects(verifyResolution(input), /didn't/);
  } finally { await rm(s.root, { recursive: true, force: true }); }
});
