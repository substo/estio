import { readdir } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { modelPattern } from "./providers";
import { runNativeProcess, type ProcessRunner } from "./process";

/** Safe, whitelisted machine metadata only: no serials, user names, paths or display ids. */
export interface Hardware {
  chip: string; arch: string; osVersion: string; memoryGb: number; gpu: "apple-metal" | "none" | "unknown";
  freeDiskGb: number; totalDiskGb: number; power: { source: "ac" | "battery" | "unknown"; batteryPercent?: number }; timeZone: string;
}
export type Runtimes = Partial<Record<"ollama" | "lmstudio" | "mlx" | "whispercpp" | "python" | "ffmpeg", string>>;
export interface Discovery { hardware: Hardware; runtimes: Runtimes; localModels: string[] }

const safeText = (value: string | undefined, fallback = "unknown") => {
  const v = value?.trim().replace(/[^A-Za-z0-9 ._()-]/g, "").slice(0, 100);
  return v || fallback;
};
const round1 = (value: number) => Math.round(value * 10) / 10;
export const versionOf = (text: string) => text.match(/\b\d+\.\d+(?:\.\d+)?\b/)?.[0];

export function parseMemoryGb(memsize: string) { const bytes = Number(memsize.trim()); return Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes / 2 ** 30) : 0; }
/** `df -k <path>`: second line, columns 1024-blocks and Available. Decimal GB like Finder. */
export function parseDf(output: string): { freeDiskGb: number; totalDiskGb: number } {
  const row = output.trim().split("\n")[1]?.trim().split(/\s+/);
  const total = Number(row?.[1]), free = Number(row?.[3]);
  if (!Number.isFinite(total) || !Number.isFinite(free)) return { freeDiskGb: 0, totalDiskGb: 0 };
  return { freeDiskGb: round1(free * 1024 / 1e9), totalDiskGb: round1(total * 1024 / 1e9) };
}
/** `pmset -g batt` */
export function parsePmset(output: string): Hardware["power"] {
  const source = /'AC Power'/.test(output) ? "ac" : /'Battery Power'/.test(output) ? "battery" : "unknown";
  const percent = output.match(/\t(\d{1,3})%;/)?.[1];
  return percent === undefined ? { source } : { source, batteryPercent: Math.min(100, Number(percent)) };
}
/** `system_profiler SPDisplaysDataType -json` */
export function parseGpu(output: string): Hardware["gpu"] {
  try {
    const gpus = (JSON.parse(output) as { SPDisplaysDataType?: Record<string, unknown>[] }).SPDisplaysDataType;
    if (!Array.isArray(gpus)) return "unknown";
    if (!gpus.length) return "none";
    return gpus.some(gpu => Object.entries(gpu).some(([key, value]) => /mtl|metal/i.test(key) && /metal/i.test(String(value)))) ? "apple-metal" : "unknown";
  } catch { return "unknown"; }
}
/** `sw_vers -productVersion` */
export const parseOsVersion = (output: string) => output.trim().match(/^\d+(\.\d+){0,2}$/)?.[0] ?? "unknown";

const quiet = async (run: ProcessRunner, command: string, args: string[], timeoutMs = 10_000) => {
  try { const { stdout, stderr } = await run({ command, args, cwd: tmpdir(), timeoutMs, maxOutputBytes: 256 * 1024 }); return `${stdout}\n${stderr}`; }
  catch { return ""; }
};
export async function discoverHardware(run: ProcessRunner = runNativeProcess, home = homedir()): Promise<Hardware> {
  const [chip, memsize, os, df, batt, displays] = await Promise.all([
    quiet(run, "/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"]), quiet(run, "/usr/sbin/sysctl", ["-n", "hw.memsize"]),
    quiet(run, "/usr/bin/sw_vers", ["-productVersion"]), quiet(run, "/bin/df", ["-k", home]),
    quiet(run, "/usr/bin/pmset", ["-g", "batt"]), quiet(run, "/usr/sbin/system_profiler", ["SPDisplaysDataType", "-json"], 30_000)]);
  let timeZone = "UTC";
  try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
  return { chip: safeText(chip.split("\n")[0]), arch: safeText(process.arch), osVersion: parseOsVersion(os.split("\n")[0]),
    memoryGb: parseMemoryGb(memsize.split("\n")[0]), gpu: parseGpu(displays), ...parseDf(df), power: parsePmset(batt), timeZone };
}
/** Free disk and power change quickly; cheap refresh used before deciding whether to process. */
export async function discoverPowerAndDisk(run: ProcessRunner = runNativeProcess, home = homedir()) {
  const [df, batt] = await Promise.all([quiet(run, "/bin/df", ["-k", home]), quiet(run, "/usr/bin/pmset", ["-g", "batt"])]);
  return { ...parseDf(df), power: parsePmset(batt) };
}
const runtimeProbes: [keyof Runtimes, string, string[]][] = [
  ["ollama", "ollama", ["--version"]], ["lmstudio", "lms", ["version"]], ["whispercpp", "whisper-cli", ["--version"]],
  ["python", "python3", ["--version"]], ["ffmpeg", "ffmpeg", ["-version"]],
  ["mlx", "python3", ["-I", "-c", "import importlib.metadata as m; print(m.version('mlx'))"]],
];
export async function discoverRuntimes(run: ProcessRunner = runNativeProcess): Promise<Runtimes> {
  const out: Runtimes = {};
  await Promise.all(runtimeProbes.map(async ([key, command, args]) => {
    const version = versionOf(await quiet(run, command, args));
    if (version) out[key] = version;
  }));
  return out;
}
async function names(dir: string) {
  try { return (await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory() || e.isFile()).map(e => e.name).filter(n => !n.startsWith(".")); }
  catch { return []; }
}
/** Model names only (no paths): Ollama manifests, LM Studio and Hugging Face MLX caches. */
export async function discoverLocalModels(home = homedir(), env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const found = new Set<string>();
  const manifests = join(env.OLLAMA_MODELS || join(home, ".ollama", "models"), "manifests");
  for (const registry of await names(manifests))
    for (const namespace of await names(join(manifests, registry)))
      for (const model of await names(join(manifests, registry, namespace)))
        for (const tag of await names(join(manifests, registry, namespace, model)))
          found.add(`${registry === "registry.ollama.ai" && namespace === "library" ? "" : `${namespace}/`}${model}:${tag}`);
  for (const root of [join(home, ".lmstudio", "models"), join(home, ".cache", "lm-studio", "models")])
    for (const publisher of await names(root))
      for (const model of await names(join(root, publisher))) found.add(`${publisher}/${model}`);
  for (const entry of await names(join(home, ".cache", "huggingface", "hub"))) {
    const match = entry.match(/^models--(mlx-community|lmstudio-community)--(.+)$/);
    if (match) found.add(`${match[1]}/${match[2]}`);
  }
  return [...found].filter(name => modelPattern.test(name)).sort().slice(0, 100);
}
export async function discover(run: ProcessRunner = runNativeProcess, home = homedir()): Promise<Discovery> {
  const [hardware, runtimes, localModels] = await Promise.all([discoverHardware(run, home), discoverRuntimes(run), discoverLocalModels(home)]);
  return { hardware, runtimes, localModels };
}
