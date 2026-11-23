import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { catalogModel, hubFolder, MODEL_CATALOG, modelFit, type CatalogModel, type FitHardware, type ReportedModel } from "../local-models";
import { runNativeProcess, type ProcessRunner } from "./process";

export const modelRoot = (home = homedir()) => join(home, "Library", "Application Support", "Estio", "StudioCompanion");
export const modelVenv = (home = homedir()) => join(modelRoot(home), "tts-venv");
export const hubDirectory = (home = homedir(), env: NodeJS.ProcessEnv = process.env) => join(env.HF_HOME || join(home, ".cache", "huggingface"), "hub");
/** What each runtime needs in the isolated environment before its weights are fetched. Fixed here, never server-supplied. */
const pipPackages: Record<CatalogModel["runtime"], string[]> = { "mlx-audio": ["mlx-audio"], "parakeet-mlx": ["huggingface_hub"] };
const downloadScript = "import sys; from huggingface_hub import snapshot_download; snapshot_download(sys.argv[1], revision=sys.argv[2])";

export type Detection = "pinned" | "other" | null;
/** Installed only if every required file resolves (cache links followed) and is big enough; a folder alone or a partial download is not installed. */
export async function detectModel(model: CatalogModel, hub: string): Promise<Detection> {
  const snapshots = join(hub, hubFolder(model.repo), "snapshots");
  let revisions: string[];
  try { revisions = await readdir(snapshots); } catch { return null; }
  const ordered = [...revisions.filter(r => r === model.revision), ...revisions.filter(r => r !== model.revision)];
  for (const revision of ordered) {
    try {
      for (const file of model.files) if ((await stat(join(snapshots, revision, file.path))).size < file.minBytes) throw new Error("small");
      return revision === model.revision ? "pinned" : "other";
    } catch { /* try next revision */ }
  }
  return null;
}
async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) total += await folderBytes(path);
      else try { total += (await stat(path)).size; } catch { /* dangling link */ }
    }
  } catch { /* not there yet */ }
  return total;
}

export interface ModelManagerOptions {
  home?: string; hub?: string; run?: ProcessRunner; venv?: string; python3?: string;
  /** Progress sampling interval while a download runs. */
  pollMs?: number; onChange?: () => void;
}
interface Manifest { managed: Record<string, { revision: string; installedAt: string }> }
interface Active { controller: AbortController; progress: number; done: Promise<void> }

export class ModelManager {
  private readonly hub: string; private readonly venv: string; private readonly run: ProcessRunner; private readonly manifestFile: string;
  private readonly active = new Map<string, Active>(); private readonly errors = new Map<string, string>();
  private managed: Manifest["managed"] = {}; private detected = new Map<string, Detection>(); private loaded = false;
  constructor(private readonly options: ModelManagerOptions = {}) {
    const home = options.home ?? homedir();
    this.hub = options.hub ?? hubDirectory(home); this.venv = options.venv ?? modelVenv(home); this.run = options.run ?? runNativeProcess;
    this.manifestFile = join(modelRoot(home), "models.json");
  }
  private async load() {
    if (this.loaded) return;
    try { const m = JSON.parse(await readFile(this.manifestFile, "utf8")) as Manifest; if (m && typeof m.managed === "object") this.managed = m.managed ?? {}; } catch { /* first run */ }
    this.loaded = true;
  }
  private async save() {
    await mkdir(dirname(this.manifestFile), { recursive: true });
    const tmp = `${this.manifestFile}.tmp`; await writeFile(tmp, JSON.stringify({ managed: this.managed } satisfies Manifest), { mode: 0o600 }); await rename(tmp, this.manifestFile);
  }
  /** Re-scan the disk. Cheap: a few stat calls per catalog entry. */
  async refresh() {
    await this.load();
    for (const model of MODEL_CATALOG) this.detected.set(model.id, await detectModel(model, this.hub));
  }
  /** What to put in the heartbeat: every catalog model with its state. */
  states(): ReportedModel[] {
    return MODEL_CATALOG.map(model => {
      const active = this.active.get(model.id);
      if (active) return { id: model.id, state: "installing", progress: Math.round(active.progress) };
      if (this.detected.get(model.id)) return { id: model.id, state: "installed", source: this.managed[model.id] ? "managed" : "found" };
      const error = this.errors.get(model.id);
      return error ? { id: model.id, state: "error", error } : { id: model.id, state: "absent" };
    });
  }
  isInstalled(id: string) { return Boolean(this.detected.get(id)); }
  /** Make the disk match the owner's desired list. Idempotent; call on every config change and periodically. */
  async reconcile(desired: readonly string[], hw: FitHardware, canDownload: boolean) {
    await this.refresh();
    const wanted = new Set(desired);
    for (const [id, active] of this.active) if (!wanted.has(id)) active.controller.abort();
    for (const id of Object.keys(this.managed)) if (!wanted.has(id) && !this.active.has(id)) await this.remove(id);
    for (const id of desired) {
      const model = catalogModel(id); if (!model || this.detected.get(id) || this.active.has(id)) continue;
      if (this.active.size) { this.errors.delete(id); continue; }                       // one download at a time
      const fit = modelFit(model, hw);
      if (fit.level === "no") { this.errors.set(id, fit.reason.replace(/[^A-Za-z0-9 .,:'()/_-]/g, "")); continue; }
      if (!canDownload) { this.errors.set(id, "Waiting for AC power or working hours before downloading."); continue; }
      this.errors.delete(id);
      this.start(model);
    }
    this.options.onChange?.();
  }
  /** Resolves when no install is running (used by tests and shutdown). */
  async idle() { while (this.active.size) await Promise.allSettled([...this.active.values()].map(a => a.done)); }
  private start(model: CatalogModel) {
    const controller = new AbortController();
    const entry: Active = { controller, progress: 0, done: Promise.resolve() };
    this.active.set(model.id, entry);
    let reported = 0;
    const poll = setInterval(async () => {
      entry.progress = Math.min(99, 100 * await folderBytes(join(this.hub, hubFolder(model.repo))) / (model.sizeGb * 1e9));
      if (entry.progress - reported >= 10) { reported = entry.progress; this.options.onChange?.(); }   // a heartbeat per 10%, not per sample
    }, this.options.pollMs ?? 2000);
    entry.done = (async () => {
      try { await this.install(model, controller.signal); this.errors.delete(model.id); }
      catch (error) {
        if (controller.signal.aborted) { if (!await detectModel(model, this.hub)) await rm(join(this.hub, hubFolder(model.repo)), { recursive: true, force: true }); this.errors.delete(model.id); }
        else this.errors.set(model.id, String((error as Error)?.message ?? "").match(/^[A-Za-z0-9 .,:'()/_-]{1,160}$/)?.[0] ?? "Install failed. Check disk space and network, then try again.");
      } finally { clearInterval(poll); this.active.delete(model.id); await this.refresh(); this.options.onChange?.(); }
    })();
  }
  private async install(model: CatalogModel, signal: AbortSignal) {
    const python = join(this.venv, "bin", "python");
    const base = { cwd: this.options.home ?? homedir(), signal, maxOutputBytes: 64 * 1024 };
    try { await stat(python); }
    catch { await this.run({ ...base, command: this.options.python3 ?? "python3", args: ["-m", "venv", this.venv], timeoutMs: 120_000 }); }
    await this.run({ ...base, command: python, args: ["-m", "pip", "install", "--quiet", "--upgrade", ...pipPackages[model.runtime]], timeoutMs: 30 * 60_000 });
    await this.run({ ...base, command: python, args: ["-c", downloadScript, model.repo, model.revision], timeoutMs: 120 * 60_000 });
    const verdict = await detectModel(model, this.hub);
    if (verdict !== "pinned") throw new Error("The download did not complete. Try again.");
    await this.load(); this.managed[model.id] = { revision: model.revision, installedAt: new Date().toISOString() }; await this.save();
  }
  /** Remove only what this app installed. Models that were already on the Mac are never deleted from here. */
  async remove(id: string) {
    await this.load();
    const model = catalogModel(id);
    if (!model || !this.managed[id]) return false;
    await rm(join(this.hub, hubFolder(model.repo)), { recursive: true, force: true });
    delete this.managed[id]; await this.save(); this.detected.set(id, null); this.errors.delete(id);
    return true;
  }
}
