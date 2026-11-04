import { spawn } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { profileSpec, type Profile } from "./contract";

export type CliUsage = { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number; cacheCreationInputTokens?: number };
export type CliOutcome = {
  status: "completed" | "capacity" | "failed" | "interrupted";
  text: string;
  usage?: CliUsage;
  sessionId?: string;
  error?: string;
  stopped: boolean;
};
/** Deliberately metadata only: source, raw events and provider diagnostics never reach observers. */
export type CliEvent = { type: "started" | "session" | "usage" | "finished"; sessionId?: string; usage?: CliUsage; status?: CliOutcome["status"] };
export type CliAttemptInput = {
  profile: Profile; cwd: string; prompt: string; signal?: AbortSignal;
  onEvent?: (event: CliEvent) => void;
  sandbox?: "read-only" | "workspace-write";
  timeoutMs?: number;
};
const OUTPUT_LIMIT = 4 * 1024 * 1024;
const MAX_TIMEOUT = 30 * 60 * 1000;

/** Only local default credentials and OS essentials. No ambient billing, provider, hook or config env. */
export function cliEnvironment(source: Partial<NodeJS.ProcessEnv> = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "SystemRoot"])
    if (source[key]) env[key] = source[key];
  return { ...env, NO_COLOR: "1", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", CLAUDE_CODE_DISABLE_FAST_MODE: "1" };
}

export function cliArguments(profile: Profile, cwd: string, sandbox: CliAttemptInput["sandbox"] = "read-only"): string[] {
  if (!profileSpec.safeParse(profile).success) throw new Error("Invalid or unsupported CLI profile.");
  if (!profile.enabled || profile.account !== "default") throw new Error("CLI requires an enabled profile using account 'default'. Named accounts are unsupported.");
  if (sandbox !== "read-only" && sandbox !== "workspace-write") throw new Error("Unsupported CLI sandbox.");
  if (sandbox === "workspace-write" && !profile.tools.includes("code-write")) throw new Error("Profile does not permit code writes.");
  if (profile.provider !== "codex" && profile.provider !== "claudeAgent") throw new Error("Headless CLI supports only Codex and Claude; use the T3 executor for other providers.");
  if (profile.provider === "codex") {
    const args = ["exec", "--json", "--ignore-user-config", "--ignore-rules", "--color", "never", "--sandbox", sandbox,
      "--model", profile.model, "-C", cwd];
    const config = ['approval_policy="never"', 'forced_login_method="chatgpt"', 'model_provider="openai"', "mcp_servers={}",
      "features.hooks=false", "features.apps=false", "features.multi_agent=false", "features.multi_agent_v2=false", "features.plugins=false", "features.shell_snapshot=false",
      "sandbox_workspace_write.network_access=false", "sandbox_workspace_write.exclude_slash_tmp=true", "sandbox_workspace_write.exclude_tmpdir_env_var=true", 'shell_environment_policy.inherit="none"'];
    for (const [key, value] of Object.entries(profile.options)) {
      if (key === "reasoningEffort") config.push(`model_reasoning_effort=${JSON.stringify(value)}`);
      // Official config schema accepts default/priority; fast is the documented CLI alias for priority.
      else if (key === "serviceTier") config.push(`service_tier=${JSON.stringify(value === "priority" ? "fast" : value)}`);
      else throw new Error("Unsupported Codex CLI setting.");
    }
    for (const entry of config) args.push("-c", entry);
    return [...args, "-"];
  }
  for (const [key, value] of Object.entries(profile.options)) {
    if (key === "fastMode") {
      // Fast mode can draw usage credits; this adapter promises subscription-only execution.
      if (value !== false) throw new Error("Claude fastMode=true is unsupported for subscription-only CLI attempts.");
    } else if (key !== "effort" || !["low", "medium", "high", "xhigh", "max"].includes(String(value)))
      throw new Error("Unsupported Claude CLI setting or effort level.");
  }
  // No Bash in read-only mode: plan mode alone is not a write barrier for shell commands.
  const tools = sandbox === "read-only" ? "Read,Glob,Grep" : "Read,Glob,Grep,Edit,Write";
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--model", profile.model,
    "--safe-mode", "--restricted", "--setting-sources", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--permission-mode", "dontAsk", "--permission-prompts", "none", "--tools", tools, "--allowedTools", tools,
    "--settings", '{"fastMode":false,"disableAllHooks":true,"autoMemoryEnabled":false}'];
  if (profile.options.effort) args.push("--effort", String(profile.options.effort));
  return args;
}

type ProcessResult = { stdout: string; stderr: string; code: number | null; stopped: boolean; interruption?: string };
/** Internal transport exported for no-provider lifecycle tests. POSIX process groups only. */
export async function runCliProcess(input: { command: string; args: string[]; cwd: string; stdin?: string; signal?: AbortSignal; timeoutMs: number }): Promise<ProcessResult> {
  if (input.signal?.aborted) return { stdout: "", stderr: "", code: null, stopped: true, interruption: "CLI attempt cancelled." };
  if (process.platform === "win32") return { stdout: "", stderr: "", code: null, stopped: true, interruption: "CLI process groups require POSIX." };
  return new Promise(resolve => {
    const child = spawn(input.command, input.args, { cwd: input.cwd, env: cliEnvironment(), shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, interruption: string | undefined, settled = false;
    const out = new StringDecoder("utf8"), err = new StringDecoder("utf8");
    const exists = () => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
    };
    const kill = () => { try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { /* Confirm absence below. */ } };
    const abort = () => { interruption ??= "CLI attempt cancelled."; kill(); };
    const timer = setTimeout(() => { interruption ??= "CLI attempt timed out."; kill(); }, input.timeoutMs);
    // Even inherited pipes or unkillable children cannot keep the worker waiting forever.
    const ceiling = setTimeout(() => { interruption ??= "CLI process did not close."; void finish(null); }, input.timeoutMs + 3000);
    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(ceiling); input.signal?.removeEventListener("abort", abort);
      kill(); // Also terminate any tools left behind after normal provider exit.
      for (let i = 0; i < 40 && exists(); i++) await new Promise(r => setTimeout(r, 50));
      child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
      resolve({ stdout, stderr, code, stopped: !exists(), interruption });
    };
    const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
      bytes += chunk.length;
      if (bytes > OUTPUT_LIMIT) { interruption ??= "CLI output exceeded its safe limit."; kill(); return; }
      if (target === "stdout") stdout += out.write(chunk); else stderr += err.write(chunk);
    };
    child.stdout.on("data", (b: Buffer) => collect(b, "stdout")); child.stderr.on("data", (b: Buffer) => collect(b, "stderr"));
    child.stdin.on("error", () => {});
    child.on("error", () => { interruption ??= "CLI executable could not start."; void finish(null); });
    child.on("close", code => { stdout += out.end(); stderr += err.end(); void finish(code); });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    child.stdin.end(input.stdin ?? "");
  });
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function usage(value: unknown): CliUsage | undefined {
  const u = object(value), result: CliUsage = {};
  for (const [key, field] of Object.entries({ inputTokens: "input_tokens", outputTokens: "output_tokens", cachedInputTokens: "cached_input_tokens", cacheCreationInputTokens: "cache_creation_input_tokens" })) {
    const n = u[field] ?? (key === "cachedInputTokens" ? u.cache_read_input_tokens : undefined);
    if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) result[key as keyof CliUsage] = n;
  }
  return Object.keys(result).length ? result : undefined;
}
export function capacity(error: unknown): boolean {
  const e = object(error);
  if (["rate_limit_exceeded", "usage_limit_reached", "insufficient_quota", "rate_limit_error"].includes(String(e.code ?? e.type))) return true;
  // Called ONLY on provider error envelopes, never assistant text, result prose or tool output.
  return typeof error === "string" && /^(?:Error:\s*)?(?:You(?:'ve| have) (?:hit|reached) your (?:usage |rate )?limit|Usage limit (?:reached|exceeded)|Rate limit (?:reached|exceeded)|You've hit your limit|Too many requests\b)/i.test(error);
}

/** Parses provider envelopes; arbitrary generated text can never trigger a capacity handoff. */
export function parseCliEvents(provider: Profile["provider"], stdout: string, code: number | null, stopped: boolean): CliOutcome {
  let text = "", sessionId: string | undefined, tokens: CliUsage | undefined;
  let complete = false, failed = false, quota = false, malformed = false;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try { const v: unknown = JSON.parse(line); e = object(v); if (!Object.keys(e).length) malformed = true; } catch { malformed = true; continue; }
    const sid = provider === "codex" ? e.thread_id : e.session_id;
    if (typeof sid === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(sid)) sessionId = sid;
    if (provider === "codex") {
      if (e.type === "item.completed" && object(e.item).type === "agent_message" && typeof object(e.item).text === "string") text += String(object(e.item).text);
      if (e.type === "turn.completed") { complete = true; failed = false; quota = false; tokens = usage(e.usage); }
      if (e.type === "turn.failed" || e.type === "error") {
        complete = false; failed = true; const error = e.error ?? e.message;
        quota ||= capacity(error) || capacity(object(error).message);
      }
    } else {
      if (e.type === "assistant" && e.error) { complete = false; failed = true; quota ||= capacity({ code: e.error }); }
      if (e.type === "rate_limit_event") {
        const info = object(e.rate_limit_info);
        if (info.status === "rejected") { complete = false; failed = true; quota = true; }
      }
      if (e.type === "result") {
        tokens = usage(e.usage);
        if (e.is_error === false && e.subtype === "success") { complete = true; failed = false; quota = false; if (typeof e.result === "string") text = e.result; }
        else { complete = false; failed = true; /* errors/result are prose, not trusted quota codes. */ }
      }
    }
  }
  const status = !stopped || malformed ? "failed" : quota ? "capacity" : code === 0 && complete && !failed ? "completed" : "failed";
  return { status, text, usage: tokens, sessionId, stopped,
    ...(status === "completed" ? {} : { error: !stopped ? "CLI child group could not be confirmed stopped; handoff blocked." : quota ? "Provider subscription capacity is unavailable." : "CLI attempt failed or returned incomplete/invalid events. Check local login, model settings and permissions." }) };
}

export async function runCliAttempt(input: CliAttemptInput): Promise<CliOutcome> {
  const emit = (event: CliEvent) => { try { input.onEvent?.(event); } catch { /* Observers cannot disrupt cleanup. */ } };
  const fail = (error: string, status: CliOutcome["status"] = "failed", stopped = true): CliOutcome => ({ status, text: "", error, stopped });
  let outcome: CliOutcome;
  try {
    const args = cliArguments(input.profile, input.cwd, input.sandbox);
    const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT) throw new Error("CLI timeout must be between 1 ms and 30 minutes.");
    if (!input.prompt.trim() || Buffer.byteLength(input.prompt) > 1024 * 1024) throw new Error("CLI prompt is empty or too large.");
    const cwd = await realpath(input.cwd).catch(() => { throw new Error("CLI workspace is unavailable."); });
    if (!(await stat(cwd)).isDirectory()) throw new Error("CLI workspace is unavailable.");
    if (input.sandbox === "workspace-write" && !(await stat(join(cwd, ".git")).catch(() => null))?.isFile())
      throw new Error("CLI writes require an isolated Git worktree.");
    if (input.signal?.aborted) return fail("CLI attempt cancelled.", "interrupted");
    const command = input.profile.provider === "codex" ? "codex" : "claude";
    const auth = await runCliProcess({ command, args: command === "codex" ? ["login", "status"] : ["--safe-mode", "--setting-sources", "", "--strict-mcp-config", "auth", "status", "--json"], cwd, timeoutMs: 10_000, signal: input.signal });
    if (!auth.stopped) return fail("CLI auth child group could not be confirmed stopped.", "failed", false);
    if (input.signal?.aborted) return fail("CLI attempt cancelled.", "interrupted");
    let authenticated = false;
    if (auth.code === 0 && !auth.interruption) {
      if (command === "codex") authenticated = /^Logged in using ChatGPT\s*$/im.test(`${auth.stdout}\n${auth.stderr}`);
      else { try { const a = object(JSON.parse(auth.stdout)); authenticated = a.loggedIn === true && a.authMethod === "claude.ai" && a.apiProvider === "firstParty" && ["pro", "max", "team", "enterprise"].includes(String(a.subscriptionType)); } catch { /* No raw authentication output escapes. */ } }
    }
    if (!authenticated) return fail("CLI subscription login unavailable. Sign in locally with the provider CLI using the default account.");
    emit({ type: "started" });
    const result = await runCliProcess({ command, args, cwd, stdin: input.prompt, signal: input.signal, timeoutMs });
    outcome = parseCliEvents(input.profile.provider, result.stdout, result.code, result.stopped);
    if (result.interruption) outcome = { ...outcome, status: input.signal?.aborted ? "interrupted" : "failed", error: result.interruption };
    if (outcome.sessionId) emit({ type: "session", sessionId: outcome.sessionId });
    if (outcome.usage) emit({ type: "usage", usage: outcome.usage });
  } catch (e) {
    // Only our validation messages are allowed out; never expose filesystem/spawn diagnostics.
    const message = e instanceof Error && /^(Invalid or unsupported|CLI |Profile |Unsupported |Claude fastMode)/.test(e.message) ? e.message : "CLI attempt could not be prepared.";
    outcome = fail(message);
  }
  emit({ type: "finished", status: outcome.status });
  return outcome;
}
