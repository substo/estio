import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Where finished-edit projects live on this Mac, in the user's own Movies folder so Substo Video and Finder can find them. */
export const projectsRoot = (home = homedir()) => join(home, "Movies", "Substo", "Projects");
export const projectStateFile = (home = homedir()) => join(home, "Library", "Application Support", "Estio", "StudioCompanion", "projects.json");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `<title slug>-<record id first 8>`: stable for a piece, so later revisions reuse the folder. */
export function projectFolderName(title: string, recordId: string): string {
  if (!uuid.test(recordId)) throw new Error("invalid_record_id");
  const slug = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 48).replace(/^-+|-+$/g, "") || "video";
  return `${slug}-${recordId.slice(0, 8)}`;
}
/** The first free `Video.substo`, `Video v2.substo`, ... (a folder holding several versions needs --project, which the briefs pass). */
export async function nextProjectFile(dir: string): Promise<string> {
  const taken = new Set(await readdir(dir).catch(() => [] as string[]));
  if (!taken.has("Video.substo")) return "Video.substo";
  for (let n = 2; n < 1000; n++) if (!taken.has(`Video v${n}.substo`)) return `Video v${n}.substo`;
  throw new Error("too_many_project_versions");
}
export interface KeptProject { dir: string; file: string; updatedAt: string }
export interface ProjectStore { get(recordId: string): Promise<KeptProject | null>; set(recordId: string, project: Omit<KeptProject, "updatedAt">): Promise<void> }

/** recordId -> project on this Mac. The paths never leave the Mac: the server only learns a boolean ("kept") and the folder's name. */
export function createProjectStore(file = projectStateFile(), root = projectsRoot()): ProjectStore {
  const load = async (): Promise<Record<string, KeptProject>> => { try { const v = JSON.parse(await readFile(file, "utf8")); return v && typeof v === "object" ? v : {}; } catch { return {}; } };
  return {
    async get(recordId) {
      if (!uuid.test(recordId)) return null;
      const entry = (await load())[recordId];
      // A path from the state file is only trusted while it is still inside the projects folder and exists.
      if (!entry || typeof entry.dir !== "string" || typeof entry.file !== "string" || !entry.dir.startsWith(root + "/") || entry.file.includes("/") || !existsSync(join(entry.dir, entry.file))) return null;
      return entry;
    },
    async set(recordId, project) {
      if (!uuid.test(recordId) || !project.dir.startsWith(root + "/") || project.file.includes("/")) throw new Error("invalid_project");
      const all = await load();
      all[recordId] = { ...project, updatedAt: new Date().toISOString() };
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}
/** Free bytes on the volume holding `path` (the nearest existing parent). */
export async function freeBytes(path: string): Promise<number> {
  let p = path; while (!existsSync(p) && dirname(p) !== p) p = dirname(p);
  const s = await statfs(p); return Number(s.bavail) * Number(s.bsize);
}
