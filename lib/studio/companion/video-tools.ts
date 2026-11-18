import { access, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { runNativeProcess, type ProcessRunner } from "./process";
import { summarizeVideoTools, type VideoToolName, type VideoToolsReport } from "../video-transcription-policy";

/** One private folder owns the isolated Python environment, yt-dlp and the speech model. Nothing is installed system-wide. */
export const PARAKEET_MODEL = "animaslabs/parakeet-tdt-0.6b-v3-mlx-4bit";
export function transcriptionHome(home = homedir(), env: NodeJS.ProcessEnv = process.env) {
  return env.STUDIO_TRANSCRIPTION_HOME?.trim() || join(home, "Library", "Application Support", "Estio Studio", "transcription");
}
const SYSTEM_BIN = ["/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".local", "bin"), "/usr/bin"];
async function executable(path: string) { try { await access(path, constants.X_OK); return true; } catch { return false; } }
/** Resolve to an absolute path from fixed locations (a LaunchAgent PATH is minimal). Never from the job or the network. */
export async function resolveTool(name: string, extra: string[] = []) {
  for (const dir of [...extra, ...SYSTEM_BIN]) { const candidate = join(dir, name); if (await executable(candidate)) return candidate; }
  return null;
}
export interface VideoTools {
  report: VideoToolsReport;
  /** Absolute executables, local only (never reported to the server). */
  paths: Partial<Record<"ytDlp" | "ffmpeg" | "ffprobe" | "tesseract" | "python", string>>;
  home: string;
}
const version = (text: string) => text.match(/\b\d+(?:\.\d+){1,3}\b/)?.[0];
async function probe(run: ProcessRunner, command: string, args: string[]) {
  try { const { stdout, stderr } = await run({ command, args, cwd: tmpdir(), timeoutMs: 15_000, maxOutputBytes: 64 * 1024 }); return `${stdout}\n${stderr}`; } catch { return ""; }
}
export async function discoverVideoTools(run: ProcessRunner = runNativeProcess, home = transcriptionHome()): Promise<VideoTools> {
  const venvBin = join(home, "venv", "bin");
  const [ytDlp, ffmpeg, ffprobe, tesseract, python] = await Promise.all([
    resolveTool("yt-dlp", [venvBin]), resolveTool("ffmpeg"), resolveTool("ffprobe"), resolveTool("tesseract"), resolveTool("python", [venvBin]),
  ]);
  const found: Partial<Record<VideoToolName, string>> = {}; const paths: VideoTools["paths"] = {};
  const check = async (key: "ytDlp" | "ffmpeg" | "ffprobe" | "tesseract", path: string | null, args: string[]) => {
    if (!path) return;
    const v = version(await probe(run, path, args)); if (v) { found[key] = v; paths[key] = path; }
  };
  await Promise.all([check("ytDlp", ytDlp, ["--version"]), check("ffmpeg", ffmpeg, ["-version"]), check("ffprobe", ffprobe, ["-version"]), check("tesseract", tesseract, ["--version"])]);
  // Only the isolated environment may import parakeet: the system Python is never trusted for the speech model.
  if (python && python.startsWith(venvBin)) {
    const v = version(await probe(run, python, ["--version"])); if (v) { found.python = v; paths.python = python; }
    const p = version(await probe(run, python, ["-I", "-c", "import importlib.metadata as m; print(m.version('parakeet-mlx'))"])); if (p) found.parakeet = p;
  }
  try {
    const snapshots = join(home, "hf-cache", "hub", `models--${PARAKEET_MODEL.replace("/", "--")}`, "snapshots");
    if ((await readdir(snapshots)).some(name => !name.startsWith("."))) found.model = "downloaded";
  } catch { /* not downloaded */ }
  return { report: summarizeVideoTools(found), paths, home };
}
/** Fixed environment for transcription subprocesses: offline model, private cache, no credentials. */
export function videoProcessEnvironment(tools: VideoTools): Record<string, string | undefined> {
  return { HF_HOME: join(tools.home, "hf-cache"), HF_HUB_OFFLINE: "1", HF_HUB_DISABLE_XET: "1", STUDIO_FFMPEG: tools.paths.ffmpeg, STUDIO_FFPROBE: tools.paths.ffprobe, STUDIO_TESSERACT: tools.paths.tesseract };
}
