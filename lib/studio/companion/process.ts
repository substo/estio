import { spawn } from "node:child_process";

export class CompanionProcessError extends Error {
  constructor(public readonly code: "cli_unavailable" | "cli_failed" | "cli_timeout" | "cli_cancelled" | "cli_output_limit") {
    super(code); this.name = "CompanionProcessError";
  }
}
export interface ProcessRequest {
  command: string; args: string[]; cwd: string; input?: string; signal?: AbortSignal;
  timeoutMs?: number; maxOutputBytes?: number; env?: NodeJS.ProcessEnv;
}
export type ProcessRunner = (request: ProcessRequest) => Promise<{ stdout: string; stderr: string }>;
/** Allowlist only local runtime/login locations. No API keys, endpoint overrides, inherited
 * NODE_OPTIONS, proxy, cloud or Studio credentials can select another billing/auth path. */
export function nativeLoginEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME", "CLAUDE_CONFIG_DIR"])
    if (source[key]) env[key] = source[key];
  env.NO_COLOR = "1";
  return env;
}
export const runNativeProcess: ProcessRunner = request => new Promise((resolve, reject) => {
  if (request.signal?.aborted) return reject(new CompanionProcessError("cli_cancelled"));
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: nativeLoginEnvironment(request.env),
    shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let failure: CompanionProcessError | undefined;
  let stdout = "", stderr = "", size = 0;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const killGroup = (signal: NodeJS.Signals) => {
    try { if (child.pid) process.kill(-child.pid, signal); } catch { /* already exited */ }
  };
  const stop = (code: CompanionProcessError["code"]) => {
    if (failure) return;
    failure = new CompanionProcessError(code); killGroup("SIGTERM");
    killTimer = setTimeout(() => killGroup("SIGKILL"), 250);
  };
  const timer = setTimeout(() => stop("cli_timeout"), request.timeoutMs ?? 90_000);
  const abort = () => stop("cli_cancelled");
  request.signal?.addEventListener("abort", abort, { once: true });
  for (const [stream, isOut] of [[child.stdout, true], [child.stderr, false]] as const) {
    stream.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (request.maxOutputBytes ?? 256 * 1024)) { stop("cli_output_limit"); return; }
      if (isOut) stdout += chunk.toString("utf8"); else stderr += chunk.toString("utf8");
    });
  }
  child.stdin.on("error", () => {}); // An early CLI exit may close stdin before the prompt is written.
  child.stdin.end(request.input ?? "");
  const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); request.signal?.removeEventListener("abort", abort); killGroup("SIGKILL"); };
  child.once("error", () => { cleanup(); reject(new CompanionProcessError("cli_unavailable")); });
  child.once("close", code => { cleanup(); if (failure) reject(failure);
    else if (code !== 0) reject(new CompanionProcessError("cli_failed")); else resolve({ stdout, stderr }); });
});
