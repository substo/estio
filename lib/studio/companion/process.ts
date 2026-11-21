import { StudioProviderRejectedError } from "../worker/handlers";
import { spawn } from "node:child_process";

export class CompanionProcessError extends Error {
  constructor(public readonly code: "cli_unavailable" | "cli_failed" | "cli_timeout" | "cli_cancelled" | "cli_output_limit") {
    super(code); this.name = "CompanionProcessError";
  }
}
/** Only native structured rejection metadata, after a nonzero process close. No model text matching. */
export function completedRateLimit(stdout: string, exitCode: number | null, provider: "codex" | "claude" = "codex"): boolean {
  if (exitCode === null || exitCode === 0) return false;
  try {
    const events = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    if (!events.length || events.some(e => !e || typeof e !== "object")) return false;
    if (provider === "codex") {
      const terminal = events.at(-1);
      const metadataOnly = events.every(e => ["thread.started", "turn.started", "turn.failed", "error"].includes(e.type));
      if (!metadataOnly || !["error", "turn.failed"].includes(terminal.type)) return false;
      const error = terminal.error ?? terminal;
      return ["rate_limit_exceeded", "usage_limit_reached"].includes(error.code)
        || (terminal.type === "turn.failed" && typeof error.message === "string"
          && /^(?:You(?:'ve| have) (?:hit|reached) your (?:usage )?limit|Usage limit (?:reached|exceeded))(?:[. !·:]|$)/i.test(error.message));
    }
    // Claude prints a synthetic assistant error for a 429. Real assistant output, tools, partial events,
    // successful or ambiguous result envelopes are deliberately outside this retry fence.
    const result = events.at(-1);
    const rejected = events.some(e => e.type === "rate_limit_event" && e.rate_limit_info?.status === "rejected"
      || e.type === "assistant" && ["rate_limit", "rate_limit_error"].includes(e.error) && e.message?.model === "<synthetic>");
    return rejected && result.type === "result" && result.is_error === true && result.usage?.output_tokens === 0
      && (!result.result || typeof result.result === "string") && result.structured_output == null
      && events.slice(0, -1).every(e => e.type === "system" && e.subtype === "init" || e.type === "rate_limit_event"
        || e.type === "assistant" && ["rate_limit", "rate_limit_error"].includes(e.error) && e.message?.model === "<synthetic>");
  } catch { return false; }
}
export interface ProcessRequest {
  subscriptionGeneration?: "codex" | "claude";
  command: string; args: string[]; cwd: string; input?: string; signal?: AbortSignal;
  timeoutMs?: number; maxOutputBytes?: number; env?: NodeJS.ProcessEnv;
  /** Interactive servers (Codex app-server): keep stdin open and stop the process once stdout satisfies this. */
  until?: (stdout: string) => boolean;
}
export type ProcessRunner = (request: ProcessRequest) => Promise<{ stdout: string; stderr: string }>;
/** Allowlist only local runtime/login locations. No API keys, endpoint overrides, inherited
 * NODE_OPTIONS, proxy, cloud or Studio credentials can select another billing/auth path. */
export function nativeLoginEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["HOME", "PATH", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "CODEX_HOME", "CLAUDE_CONFIG_DIR",
    // Local transcription only: private model cache, offline switches and the resolved tool paths. No credentials.
    "HF_HOME", "HF_HUB_OFFLINE", "HF_HUB_DISABLE_XET", "STUDIO_FFMPEG", "STUDIO_FFPROBE", "STUDIO_TESSERACT"])
    if (source[key]) env[key] = source[key];
  env.NO_COLOR = "1";
  return env;
}
export const runNativeProcess: ProcessRunner = request => new Promise((resolve, reject) => {
  if (request.signal?.aborted) return reject(new CompanionProcessError("cli_cancelled"));
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: nativeLoginEnvironment(request.env),
    shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let failure: CompanionProcessError | undefined; let satisfied = false;
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
      if (isOut && request.until && !satisfied && !failure && request.until(stdout)) { satisfied = true; child.stdin.end(); killGroup("SIGTERM"); }
    });
  }
  child.stdin.on("error", () => {}); // An early CLI exit may close stdin before the prompt is written.
  if (request.until) child.stdin.write(request.input ?? ""); else child.stdin.end(request.input ?? "");
  const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); request.signal?.removeEventListener("abort", abort); killGroup("SIGKILL"); };
  child.once("error", () => { cleanup(); reject(new CompanionProcessError("cli_unavailable")); });
  child.once("close", code => { cleanup(); if (failure) reject(failure);
    else if (request.until) { if (satisfied) resolve({ stdout, stderr }); else reject(new CompanionProcessError("cli_failed")); }
    else if (code !== 0) reject(request.subscriptionGeneration && completedRateLimit(stdout, code, request.subscriptionGeneration) ? new StudioProviderRejectedError("rate_limited", "Subscription rejected the request before generation.", true, undefined, "before_generation") : new CompanionProcessError("cli_failed")); else resolve({ stdout, stderr }); });
});
