import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import type { CommandStatus, ProviderCommand } from "./http-queue";
import { nativeLoginEnvironment, runNativeProcess, type ProcessRunner } from "./process";
import type { CliReadiness, LocalProvider } from "./providers";

export const loginTimeoutMs = 15 * 60_000;
export const verificationHosts = ["auth.openai.com", "chatgpt.com", "claude.ai", "console.anthropic.com", "platform.claude.com", "claude.com"];
/** The CLIs' own subscription login/logout. Fixed argv, never server-controlled. */
export const providerCommandArgs: Record<LocalProvider, Record<ProviderCommand["kind"], string[]>> = {
  codex: { provider_login: ["login", "--device-auth"], provider_logout: ["logout"] },
  claude: { provider_login: ["auth", "login", "--claudeai"], provider_logout: ["auth", "logout"] },
};
export interface LoginDisplay { verificationUrl: string; userCode?: string }
const ansi = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007]*(\u0007|\u001b\\)/g;
/** Extract only the verification URL and device code from CLI output; everything else is dropped. */
export function parseLoginOutput(output: string): Partial<LoginDisplay> {
  const text = output.replace(ansi, "");
  const result: Partial<LoginDisplay> = {};
  for (const raw of text.match(/https:\/\/[^\s"'<>`]+/g) ?? []) {
    const candidate = raw.replace(/[.,;:)\]]+$/, "");
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && !url.username && !url.password && verificationHosts.includes(url.hostname) && url.href.length <= 2000) {
        result.verificationUrl = url.href; break;
      }
    } catch { /* not a URL */ }
  }
  const code = text.match(/(?:^|\s)([A-Z0-9]{4,8}-[A-Z0-9]{4,8})(?=\s|$)/m)?.[1];
  if (code && /^[A-Z0-9-]{4,16}$/.test(code)) result.userCode = code;
  return result;
}
export interface LoginProcessRequest { command: string; args: string[]; timeoutMs: number; signal: AbortSignal; onDisplay: (display: LoginDisplay) => void }
export type LoginProcessRunner = (request: LoginProcessRequest) => Promise<"exited" | "failed" | "timeout" | "cancelled">;
/** Streams output only into the parser; keeps stdin open (never written) so a CLI waiting for a pasted code doesn't abort. */
export const runLoginProcess: LoginProcessRunner = request => new Promise(resolve => {
  if (request.signal.aborted) return resolve("cancelled");
  const child = spawn(request.command, request.args, { cwd: tmpdir(), env: nativeLoginEnvironment(), shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", reported = "", outcome: "timeout" | "cancelled" | undefined;
  const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch { /* exited */ } };
  const stop = (why: "timeout" | "cancelled") => { if (outcome) return; outcome = why; kill("SIGTERM"); setTimeout(() => kill("SIGKILL"), 1000).unref(); };
  const timer = setTimeout(() => stop("timeout"), request.timeoutMs);
  const abort = () => stop("cancelled");
  request.signal.addEventListener("abort", abort, { once: true });
  const onData = (chunk: Buffer) => {
    if (buffer.length < 64 * 1024) buffer += chunk.toString("utf8");
    const display = parseLoginOutput(buffer);
    if (!display.verificationUrl) return;
    const key = `${display.verificationUrl} ${display.userCode ?? ""}`;
    if (key !== reported) { reported = key; request.onDisplay({ verificationUrl: display.verificationUrl, ...(display.userCode ? { userCode: display.userCode } : {}) }); }
  };
  child.stdout.on("data", onData); child.stderr.on("data", onData);
  child.stdin.on("error", () => {});
  const finish = (value: "exited" | "failed") => {
    clearTimeout(timer); request.signal.removeEventListener("abort", abort); child.stdin.destroy(); kill("SIGKILL");
    resolve(outcome ?? value);
  };
  child.once("error", () => finish("failed"));
  child.once("close", code => finish(code === 0 ? "exited" : "failed"));
});

export interface CommandDeps {
  post: (status: CommandStatus) => Promise<boolean>;
  readiness: (provider: LocalProvider) => Promise<CliReadiness>;
  login?: LoginProcessRunner; run?: ProcessRunner; signal: AbortSignal;
  timeoutMs?: number; keepAliveMs?: number;
}
/** Run one provider command. Only status, the parsed URL/code and fixed error text are reported. */
export async function executeProviderCommand(command: ProviderCommand, deps: CommandDeps): Promise<CommandStatus["status"]> {
  const post = (status: Omit<CommandStatus, "commandId">) => deps.post({ commandId: command.id, ...status }).catch(() => true);
  const finish = async (ok: boolean, error: string) => { const status = ok ? "succeeded" : "failed"; await post(ok ? { status } : { status, error }); return status; };
  if (!(command.provider in providerCommandArgs)) return finish(false, "Unsupported provider.");
  const args = providerCommandArgs[command.provider][command.kind];
  if (!await post({ status: "running" })) return "failed";
  const controller = new AbortController();
  const abort = () => controller.abort();
  deps.signal.addEventListener("abort", abort, { once: true });
  try {
    if (command.kind === "provider_logout") {
      try { await (deps.run ?? runNativeProcess)({ command: command.provider, args, cwd: tmpdir(), signal: controller.signal, timeoutMs: 60_000, maxOutputBytes: 64 * 1024 }); }
      catch { /* The status recheck below decides. */ }
      const after = await deps.readiness(command.provider);
      return finish(!after.authenticated && after.loginMethod === undefined, "Sign-out did not complete on the Mac.");
    }
    let display: LoginDisplay | undefined;
    let cancelled = false;
    const keepAlive = setInterval(() => {
      if (display) void post({ status: "waiting_for_user", display }).then(open => { if (!open) { cancelled = true; controller.abort(); } });
    }, deps.keepAliveMs ?? 10_000);
    let outcome;
    try {
      outcome = await (deps.login ?? runLoginProcess)({ command: command.provider, args, timeoutMs: deps.timeoutMs ?? loginTimeoutMs, signal: controller.signal,
        onDisplay: value => { display = value;
          void post({ status: "waiting_for_user", display: value }).then(open => { if (!open) { cancelled = true; controller.abort(); } }); } });
    } finally { clearInterval(keepAlive); }
    if (cancelled) return "failed";
    if (outcome === "timeout") return finish(false, "Sign-in timed out after 15 minutes.");
    if (outcome === "cancelled") return finish(false, "Sign-in was stopped because the companion shut down.");
    const after = await deps.readiness(command.provider);
    return finish(after.authenticated, outcome === "failed" ? "Sign-in did not complete on the Mac." : "Signed in, but not with a subscription account.");
  } finally { deps.signal.removeEventListener("abort", abort); }
}
