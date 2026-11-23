import { tmpdir } from "node:os";
import { runNativeProcess, type ProcessRunner } from "./process";

export interface AssemblyTools { ready: boolean; missing: string[] }
const searchPath = () => `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin:/opt/homebrew/bin:/usr/local/bin`;
/** The editor command, ffprobe, and the signed-in Claude subscription that drives the editor. Names only; no paths or account details leave this function. */
export async function discoverAssemblyTools(claudeReady: boolean, run: ProcessRunner = runNativeProcess, signal?: AbortSignal): Promise<AssemblyTools> {
  const probe = async (command: string, args: string[]) => { try { await run({ command, args, cwd: tmpdir(), env: { PATH: searchPath() }, signal, timeoutMs: 15_000, maxOutputBytes: 4096 }); return true; } catch { return false; } };
  const [substo, ffprobe] = await Promise.all([probe("substo", ["--version"]), probe("ffprobe", ["-version"])]);
  const missing = [...(substo ? [] : ["substo"]), ...(ffprobe ? [] : ["ffprobe"]), ...(claudeReady ? [] : ["Claude sign-in"])];
  return { ready: missing.length === 0, missing };
}
