import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, chmod, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

type Spec = { baseRevision: string; scope: string[] };
export type DeliveryCheckpoint = { cwd: string; baseRevision: string; specFingerprint: string; deliveryId: string; branch?: string };
/** A T3-created branch worktree adopted by the fence instead of a helper-created detached one. */
export type AdoptedWorktree = { cwd: string; branch: string };
type Input = { checkout: string; root: string; jobId: string; spec: Spec; worktree?: AdoptedWorktree };
export type DeliveryEvidence = DeliveryCheckpoint & { ok: boolean; files: string[]; errors: string[]; diffDigest: string };
const execute = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const exists = async (file: string) => lstat(file).catch((e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return null; throw e; });
async function git(cwd: string, ...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const { stdout } = await execute("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.untrackedCache=false", ...args], {
    cwd, env: { ...env, NODE_ENV: "production", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LITERAL_PATHSPECS: "1" },
    encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Explicit files only. This is a post-run scope fence, not a per-file write sandbox. */
export function validateDeliveryPath(file: string) {
  const parts = file.split("/");
  if (!file || !/^[a-zA-Z0-9_./@+()[\] -]+$/.test(file) || path.isAbsolute(file) || parts.some(p => !p || p === "." || p === ".." || /^\.git(?:$|modules$|config$)/i.test(p) || /^\.env/i.test(p) || /secret|credential/i.test(p) || /^(?:id_rsa|id_ed25519)$|\.(?:pem|key|p12|pfx)$/i.test(p)))
    throw new Error(`Unsafe delivery file path: ${file}`);
}
async function safeFile(root: string, file: string) {
  validateDeliveryPath(file);
  let current = root;
  for (const [i, part] of file.split("/").entries()) {
    current = path.join(current, part);
    const info = await exists(current);
    if (info && (info.isSymbolicLink() || (i === file.split("/").length - 1 ? !info.isFile() : !info.isDirectory())))
      throw new Error(`Delivery path is not a regular file: ${file}`);
  }
}
async function privateDirectory(dir: string) {
  if (!path.isAbsolute(dir)) throw new Error("Delivery root must be an absolute configured path");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (await realpath(dir) !== path.resolve(dir) || !(await lstat(dir)).isDirectory()) throw new Error("Delivery root must not contain symlinks");
  if (process.getuid && (await lstat(dir)).uid !== process.getuid()) throw new Error("Delivery root must be owned by this worker");
  await chmod(dir, 0o700);
}
async function context(input: Input) {
  const { spec } = input;
  if (!/^[a-f0-9]{40}$/.test(spec.baseRevision) || !input.jobId || !Array.isArray(spec.scope) || !spec.scope.length || spec.scope.length > 30) throw new Error("Invalid delivery specification");
  spec.scope.forEach(validateDeliveryPath);
  if (new Set(spec.scope).size !== spec.scope.length) throw new Error("Duplicate delivery scope");
  const checkout = await realpath(input.checkout);
  const common = await realpath((await git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
  if ((await git(checkout, "rev-parse", `${spec.baseRevision}^{commit}`)).trim() !== spec.baseRevision) throw new Error("Delivery base is not an exact commit");
  const root = path.resolve(input.root);
  if (!path.isAbsolute(input.root) || root === checkout || root.startsWith(checkout + path.sep)) throw new Error("Delivery root must be configured outside the checkout");
  await privateDirectory(root);
  await privateDirectory(path.join(root, "worktrees"));
  await privateDirectory(path.join(root, "receipts"));
  const deliveryId = hash(input.jobId), specFingerprint = hash(canonical(spec));
  let checkpoint: DeliveryCheckpoint = { cwd: path.join(root, "worktrees", deliveryId), baseRevision: spec.baseRevision, specFingerprint, deliveryId };
  if (input.worktree) {
    const { cwd, branch } = input.worktree;
    if (!/^build\/[a-z0-9-]{1,60}$/.test(branch)) throw new Error("Adopted worktree branch must be build/<slug>");
    if (!path.isAbsolute(cwd) || path.resolve(cwd) !== cwd || cwd === checkout || cwd.startsWith(checkout + path.sep)) throw new Error("Adopted worktree must be an absolute path outside the checkout");
    checkpoint = { ...checkpoint, cwd, branch };
  }
  return { checkout, common, checkpoint, receipt: path.join(root, "receipts", `${deliveryId}.json`), owner: { ...checkpoint, common, checkout, jobId: input.jobId } };
}
async function ownership(c: Awaited<ReturnType<typeof context>>) {
  const receipt = await exists(c.receipt);
  if (!receipt?.isFile() || receipt.isSymbolicLink() || (receipt.mode & 0o077) || (process.getuid && receipt.uid !== process.getuid())) throw new Error("Missing or unsafe delivery receipt; preserved workspace requires operator recovery");
  if (canonical(JSON.parse(await readFile(c.receipt, "utf8"))) !== canonical(c.owner)) throw new Error("Delivery ownership/specification mismatch");
  const cwd = c.checkpoint.cwd;
  if ((await exists(cwd))?.isSymbolicLink() || await realpath(cwd) !== cwd || !(await lstat(path.join(cwd, ".git"))).isFile()) throw new Error("Delivery is not a linked worktree");
  const records = (await git(c.checkout, "worktree", "list", "--porcelain", "-z")).split("\0\0");
  if (!records.some(record => { const fields = record.split("\0"); return fields.includes(`worktree ${cwd}`) && fields.includes(`HEAD ${c.checkpoint.baseRevision}`) && fields.includes(c.checkpoint.branch ? `branch refs/heads/${c.checkpoint.branch}` : "detached"); })) throw new Error("Delivery worktree is not registered at its approved base");
  if ((await git(cwd, "rev-parse", "--show-toplevel")).trim() !== cwd || await realpath((await git(cwd, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim()) !== c.common || (await git(cwd, "rev-parse", "HEAD")).trim() !== c.checkpoint.baseRevision) throw new Error("Delivery repository or HEAD changed; commits are forbidden");
  const admin = await realpath((await git(cwd, "rev-parse", "--absolute-git-dir")).trim());
  if (!admin.startsWith(path.join(c.common, "worktrees") + path.sep) || (await readFile(path.join(admin, "gitdir"), "utf8")).trim() !== path.join(cwd, ".git")) throw new Error("Delivery Git linkage mismatch");
}
/** root and checkout come exclusively from server configuration, never job payloads. No cleanup/reset on failure. */
async function precheck(input: Input) {
  const c = await context(input);
  if ((await git(c.checkout, "rev-parse", "HEAD")).trim() !== input.spec.baseRevision) throw new Error("Configured source HEAD differs from approved base");
  if ((await git(c.checkout, "ls-files", "-v", "-z", "--", ...input.spec.scope)).split("\0").some(entry => /^[a-zS] /.test(entry))) throw new Error("Approved source index conceals working files");
  if (await git(c.checkout, "status", "--porcelain=v1", "--untracked-files=all", "--ignored", "--", ...input.spec.scope)) throw new Error("Approved source files are dirty; reconcile uncommitted intent first");
  for (const file of input.spec.scope) await safeFile(c.checkout, file);
  // A missing source file must not hide a symlink/submodule in the approved base.
  const tree = (await git(c.checkout, "ls-tree", "-r", "-z", input.spec.baseRevision)).split("\0");
  for (const entry of tree) {
    const [meta, file] = entry.split("\t");
    if (/^(120000|160000) /.test(meta) && input.spec.scope.some(p => p === file || p.startsWith(file + "/"))) throw new Error("Approved base contains a symlink or submodule in scope");
  }
  return c;
}
export async function prepareDelivery(input: Input & { checkpoint?: Partial<DeliveryCheckpoint> }): Promise<DeliveryCheckpoint> {
  if (input.worktree) throw new Error("Use adoptDelivery for an adopted worktree");
  const c = await precheck(input);
  if (input.checkpoint && Object.entries(c.checkpoint).some(([key, value]) => input.checkpoint?.[key as keyof DeliveryCheckpoint] !== value)) throw new Error("Delivery checkpoint mismatch");
  if (await exists(c.checkpoint.cwd)) { await ownership(c); return c.checkpoint; }
  if (await exists(c.receipt)) {
    // An interrupted creation is preserved for explicit operator recovery, never replaced.
    throw new Error("Delivery receipt exists without its worktree; operator recovery required");
  }
  await writeFile(c.receipt, JSON.stringify(c.owner), { mode: 0o600, flag: "wx" });
  await git(c.checkout, "worktree", "add", "--detach", c.checkpoint.cwd, input.spec.baseRevision);
  await ownership(c);
  return c.checkpoint;
}
/** Takes ownership of a T3-created worktree (still at the approved base, no commits) before its writer edits anything. */
export async function adoptDelivery(input: Input & { worktree: AdoptedWorktree }): Promise<DeliveryCheckpoint> {
  const c = await precheck(input);
  if (!(await exists(c.receipt))) await writeFile(c.receipt, JSON.stringify(c.owner), { mode: 0o600, flag: "wx" });
  await ownership(c);
  return c.checkpoint;
}
/** Call only after the writer has stopped. Includes ignored untracked files; never runs job-provided tests. */
export async function verifyDelivery(input: Input & { cwd: string }): Promise<DeliveryEvidence> {
  const c = await context(input), errors: string[] = [];
  const evidence: DeliveryEvidence = { ...c.checkpoint, ok: false, files: [], errors, diffDigest: "" };
  try {
    if (input.cwd !== c.checkpoint.cwd) throw new Error("Delivery cwd mismatch");
    await ownership(c);
    const flags = (await git(input.cwd, "ls-files", "-v", "-z")).split("\0");
    if (flags.some(entry => /^[a-zS] /.test(entry))) throw new Error("Delivery index conceals working files");
    const files = new Set<string>();
    const digest = createHash("sha256");
    for (const args of [["HEAD"], ["--cached"], []]) {
      (await git(input.cwd, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", ...args, "--")).split("\0").filter(Boolean).forEach(f => files.add(f));
      digest.update(await git(input.cwd, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--binary", ...args, "--"));
      try { await git(input.cwd, "diff", "--no-ext-diff", "--no-textconv", "--check", ...args, "--"); } catch { errors.push("git diff --check failed"); }
    }
    (await git(input.cwd, "ls-files", "--others", "-z")).split("\0").filter(Boolean).forEach(f => files.add(f));
    evidence.files = [...files].sort();
    let total = 0;
    for (const file of evidence.files) {
      if (!input.spec.scope.includes(file)) errors.push(`Outside approved scope: ${file}`);
      try {
        await safeFile(input.cwd, file);
        const info = await exists(path.join(input.cwd, file));
        if (info && (total += info.size) > 64 * 1024 * 1024) throw new Error("Delivery snapshot exceeds 64 MiB");
        digest.update(canonical({ file, mode: info?.mode, size: info?.size, deleted: !info }));
        if (info) digest.update(await readFile(path.join(input.cwd, file)));
      } catch (e) { errors.push(e instanceof Error ? e.message : "Unsafe delivery path"); }
    }
    const index = (await git(input.cwd, "ls-files", "--stage", "-z")).split("\0");
    if (index.some(entry => /^(120000|160000) /.test(entry) && files.has(entry.slice(entry.indexOf("\t") + 1)))) errors.push("Delivery index contains a changed symlink or submodule");
    evidence.diffDigest = digest.digest("hex");
    await ownership(c);
    evidence.ok = errors.length === 0;
  } catch { errors.push("Delivery ownership/base verification failed; preserve workspace for operator review"); }
  return evidence;
}
