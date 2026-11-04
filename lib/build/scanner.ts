import { execFileSync } from "node:child_process";
import { readFileSync, lstatSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { id } from "./contract";

export const scanSpec = z.object({
  head: z.string().regex(/^[a-f0-9]{40}$/),
  files: z.array(z.object({ id, path: z.string().max(400).refine(p => /^(app|components|lib)\//.test(p) && /\.(tsx?|css)$/.test(p) && !/[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").some(part => part === ".." || part === "." || !part)), hash: z.string().regex(/^[a-f0-9]{64}$/), imports: z.array(id).max(300), uncertain: z.boolean() }).strict()).max(5000),
}).strict().superRefine((v, ctx) => {
  const ids = new Set(v.files.map(f => f.id));
  if (ids.size !== v.files.length || new Set(v.files.map(f => f.path)).size !== v.files.length || v.files.some(f => f.imports.some(i => !ids.has(i)))) ctx.addIssue({ code: "custom", message: "Duplicate files or missing import target" });
});
export type Scan = z.infer<typeof scanSpec>;
export function reverseAffected(changed: string[], edges: { fromId: string; toId: string }[]) {
  const affected = new Set(changed), queue = [...changed];
  const consumers = new Map<string, string[]>();
  for (const e of edges) consumers.set(e.toId, [...(consumers.get(e.toId) ?? []), e.fromId]);
  for (let i = 0; i < queue.length; i++) for (const consumer of consumers.get(queue[i]) ?? []) if (!affected.has(consumer)) { affected.add(consumer); queue.push(consumer); }
  return affected;
}
/** No shell from browser: fixed read-only Git commands against the worker's configured checkout. */
export function scanRepository(cwd: string): Scan {
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const head = git("rev-parse", "HEAD").trim();
  const paths = git("ls-files", "-z", "--", "app", "components", "lib").split("\0").filter(p => /\.(tsx?|css)$/.test(p) && !/\.test\./.test(p)).filter(p => { try { return lstatSync(path.join(cwd, p)).isFile() && !lstatSync(path.join(cwd, p)).isSymbolicLink(); } catch { return false; } });
  if (paths.length > 5000) throw new Error("Inventory exceeds 5000 files; narrow scan explicitly before continuing");
  const key = (p: string) => `file-${createHash("sha256").update(p).digest("hex").slice(0, 24)}`;
  const available = new Set(paths);
  const files = paths.map(p => {
    const source = readFileSync(path.join(cwd, p), "utf8");
    const imports: string[] = []; let uncertain = /\b(import\s*\(|require\s*\()/.test(source);
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*|@import\s*)["']([^"']+)["']/g)) {
      const ref = match[1];
      if (!ref.startsWith(".") && !ref.startsWith("@/")) continue;
      const base = ref.startsWith("@/") ? ref.slice(2) : path.posix.normalize(path.posix.join(path.posix.dirname(p), ref));
      const resolved = [base, `${base}.ts`, `${base}.tsx`, `${base}.css`, `${base}/index.ts`, `${base}/index.tsx`].find(v => available.has(v));
      if (resolved) imports.push(key(resolved)); else uncertain = true;
    }
    return { id: key(p), path: p, hash: createHash("sha256").update(source).digest("hex"), imports: [...new Set(imports)], uncertain };
  });
  return scanSpec.parse({ head, files });
}
