import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * What a task changed, readable on the Build page: a new file in full, an edited or deleted file as its diff against the
 * task's base. Bounded so a result stays small; the full change is always on the task's branch.
 */
export type ChangedFile = { path: string; change: "added" | "modified" | "deleted"; text: string; truncated: boolean };
const perFile = 16_000, total = 120_000, maxFiles = 40;
const git = (cwd: string, args: string[]) => new Promise<string>((resolve, reject) =>
  execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));

export async function describeChanges(cwd: string, files: string[]): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  let used = 0;
  for (const file of files.slice(0, maxFiles)) {
    const tracked = await git(cwd, ["ls-files", "--error-unmatch", "--", file]).then(() => true, () => false);
    let change: ChangedFile["change"], text: string;
    if (!tracked) { change = "added"; text = await readFile(path.join(cwd, file), "utf8").catch(() => ""); }
    else {
      text = await git(cwd, ["diff", "--no-ext-diff", "--no-color", "--no-renames", "HEAD", "--", file]).catch(() => "");
      change = /^deleted file mode/m.test(text) ? "deleted" : "modified";
      text = text.split("\n").filter(l => !/^(diff --git|index |--- |\+\+\+ )/.test(l)).join("\n");
    }
    const room = Math.max(0, Math.min(perFile, total - used));
    out.push({ path: file, change, text: text.slice(0, room), truncated: text.length > room });
    used += Math.min(text.length, room);
  }
  return out;
}
