import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { adoptDelivery, prepareDelivery, validateDeliveryPath, verifyDelivery } from "./delivery";

test("scope admits explicit relative files and rejects broad, secret and escaping paths", () => {
  for (const file of ["lib/build/delivery.ts", "app/(main)/[id]/page.tsx", "new-file.ts"]) assert.doesNotThrow(() => validateDeliveryPath(file));
  for (const file of ["", ".", "./foo", "../foo", "/tmp/foo", "a//b", "a/../b", "a/", "**", ".git/config", ".env.prod", "a/.env", "secrets/key", "id_rsa", "cert.pem", "a\\b", "a\nb"]) assert.throws(() => validateDeliveryPath(file), file);
});

test("owned worktree survives handoff; scope, Git state, symlink and ownership fences reject unsafe output", async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), "delivery-test-"));
  const checkout = path.join(temp, "source"), root = path.join(temp, "private");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  try {
    await mkdir(checkout);
    git(checkout, "init", "-q");
    await writeFile(path.join(checkout, "file.txt"), "original\n");
    await writeFile(path.join(checkout, ".gitignore"), "ignored.txt\n");
    git(checkout, "add", ".");
    git(checkout, "-c", "user.name=Fixture", "-c", "user.email=fixture@localhost", "commit", "-qm", "fixture");
    const spec = { baseRevision: git(checkout, "rev-parse", "HEAD"), scope: ["file.txt", "new.txt"] };
    const input = { checkout, root, jobId: "job-one", spec };
    await writeFile(path.join(checkout, "file.txt"), "dirty intent\n");
    await assert.rejects(prepareDelivery(input), /dirty/);
    await writeFile(path.join(checkout, "file.txt"), "original\n");
    const cp = await prepareDelivery(input);
    assert.equal((await stat(root)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(root, "receipts", `${cp.deliveryId}.json`))).mode & 0o777, 0o600);
    await writeFile(path.join(cp.cwd, "file.txt"), "staged\n");
    git(cp.cwd, "add", "file.txt");
    await writeFile(path.join(cp.cwd, "file.txt"), "original\n"); // staged output must still be represented
    await writeFile(path.join(cp.cwd, "new.txt"), "untracked\n");
    assert.deepEqual(await prepareDelivery({ ...input, checkpoint: cp }), cp);
    assert.equal(await readFile(path.join(cp.cwd, "new.txt"), "utf8"), "untracked\n");
    const good = await verifyDelivery({ ...input, cwd: cp.cwd });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    assert.deepEqual(good.files, ["file.txt", "new.txt"]);
    assert.match(good.diffDigest, /^[a-f0-9]{64}$/);
    await writeFile(path.join(cp.cwd, "ignored.txt"), "unexpected\n");
    const ignored = await verifyDelivery({ ...input, cwd: cp.cwd });
    assert.equal(ignored.ok, false);
    assert(ignored.files.includes("ignored.txt"));
    await rm(path.join(cp.cwd, "ignored.txt"));
    await rm(path.join(cp.cwd, "new.txt"));
    await rename(path.join(cp.cwd, "file.txt"), path.join(cp.cwd, "renamed.txt"));
    git(cp.cwd, "add", "-A");
    const renamed = await verifyDelivery({ ...input, cwd: cp.cwd });
    assert.equal(renamed.ok, false);
    assert(renamed.files.includes("file.txt") && renamed.files.includes("renamed.txt"));
    await rename(path.join(cp.cwd, "renamed.txt"), path.join(cp.cwd, "file.txt"));
    git(cp.cwd, "add", "-A");
    git(cp.cwd, "update-index", "--assume-unchanged", "file.txt");
    assert.equal((await verifyDelivery({ ...input, cwd: cp.cwd })).ok, false);
    git(cp.cwd, "update-index", "--no-assume-unchanged", "file.txt");
    await symlink(path.join(checkout, "file.txt"), path.join(cp.cwd, "new.txt"));
    assert.equal((await verifyDelivery({ ...input, cwd: cp.cwd })).ok, false);
    await assert.rejects(prepareDelivery({ ...input, spec: { ...spec, scope: ["file.txt"] } }), /mismatch/);
    git(cp.cwd, "symbolic-ref", "HEAD", "refs/heads/forbidden");
    assert.equal((await verifyDelivery({ ...input, cwd: cp.cwd })).ok, false);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("adopted T3 branch worktree is fenced: commits, wrong branch and out-of-scope files fail", async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), "adopt-test-"));
  const checkout = path.join(temp, "source"), root = path.join(temp, "private"), cwd = path.join(temp, "t3", "build-x");
  const git = (dir: string, ...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=F", "-c", "user.email=f@localhost", ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  try {
    await mkdir(checkout); git(checkout, "init", "-q");
    await writeFile(path.join(checkout, "file.txt"), "original\n"); git(checkout, "add", "."); git(checkout, "commit", "-qm", "fixture");
    const spec = { baseRevision: git(checkout, "rev-parse", "HEAD"), scope: ["file.txt"] };
    git(checkout, "worktree", "add", "-q", "-b", "build/x-1", cwd, spec.baseRevision);
    const input = { checkout, root, jobId: "job-t3", spec, worktree: { cwd, branch: "build/x-1" } };
    await assert.rejects(prepareDelivery(input), /adoptDelivery/);
    await assert.rejects(adoptDelivery({ ...input, worktree: { cwd, branch: "main" } }), /build\//);
    await assert.rejects(adoptDelivery({ ...input, worktree: { cwd: path.join(checkout, "x"), branch: "build/x-1" } }), /outside/);
    const cp = await adoptDelivery(input);
    assert.equal(cp.branch, "build/x-1");
    assert.deepEqual(await adoptDelivery(input), cp);
    await writeFile(path.join(cwd, "file.txt"), "changed\n");
    const good = await verifyDelivery({ ...input, cwd });
    assert.equal(good.ok, true, JSON.stringify(good.errors));
    await writeFile(path.join(cwd, "other.txt"), "x\n");
    assert.equal((await verifyDelivery({ ...input, cwd })).ok, false);
    await rm(path.join(cwd, "other.txt"));
    git(cwd, "commit", "-qam", "forbidden");
    assert.equal((await verifyDelivery({ ...input, cwd })).ok, false);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("a task can start after the checkout moved ahead of its base, but not from a commit outside its history", async () => {
  const temp = await mkdtemp(path.join(await realpath(os.tmpdir()), "delivery-ahead-"));
  const checkout = path.join(temp, "source"), root = path.join(temp, "private");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=F", "-c", "user.email=f@localhost", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  try {
    await mkdir(checkout); git(checkout, "init", "-q");
    await writeFile(path.join(checkout, "file.txt"), "one\n"); git(checkout, "add", "."); git(checkout, "commit", "-qm", "base");
    const base = git(checkout, "rev-parse", "HEAD");
    await writeFile(path.join(checkout, "other.txt"), "merged task\n"); git(checkout, "add", "."); git(checkout, "commit", "-qm", "an earlier task merged");
    const cp = await prepareDelivery({ checkout, root, jobId: "job-ahead", spec: { baseRevision: base, scope: ["file.txt"] } });
    assert.equal(git(cp.cwd, "rev-parse", "HEAD"), base);
    git(checkout, "checkout", "-q", "--orphan", "elsewhere"); git(checkout, "rm", "-rqf", "."); await writeFile(path.join(checkout, "x.txt"), "x\n"); git(checkout, "add", "."); git(checkout, "commit", "-qm", "unrelated");
    await assert.rejects(prepareDelivery({ checkout, root, jobId: "job-unrelated", spec: { baseRevision: base, scope: ["file.txt"] } }), /history/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
