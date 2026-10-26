import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runNativeProcess, type ProcessRunner } from "./process";

export type LocalProvider = "codex" | "claude";
export interface CliReadiness { installed: boolean; authenticated: boolean; ready: boolean; version?: string; models: string[] }
export interface TextRequest<T> {
  model?: string; prompt: string; jsonSchema: Record<string, unknown>; validate: (value: unknown) => T; signal: AbortSignal;
}
export interface LocalTextAdapter {
  provider: LocalProvider;
  readiness(signal?: AbortSignal): Promise<CliReadiness>;
  generate<T>(request: TextRequest<T>): Promise<T>;
}
export const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const object = z.record(z.unknown());
async function isolated<T>(work: (cwd: string) => Promise<T>) {
  const cwd = await mkdtemp(join(tmpdir(), "studio-companion-"));
  try { return await work(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}
/** Native execution only. No provider SDK/auth, fallback, shell or server-controlled CLI flags.
 * T3 CodexAdapterV2/ClaudeAdapterV2 inspired model, tool, env and cancellation boundaries;
 * exec and print flags below are verified against the installed native CLIs' help. */
export function createLocalTextAdapter(provider: LocalProvider, run: ProcessRunner = runNativeProcess): LocalTextAdapter {
  if (provider !== "codex" && provider !== "claude") throw new Error("unsupported_provider");
  const readiness = (signal?: AbortSignal): Promise<CliReadiness> => isolated(async cwd => {
    const result: CliReadiness = { installed: false, authenticated: false, ready: false, models: [] };
    try {
      const version = await run({ command: provider, args: ["--version"], cwd, signal, timeoutMs: 10_000, maxOutputBytes: 8192 });
      result.installed = true;
      result.version = version.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
      const help = await run({ command: provider, args: provider === "codex" ? ["exec", "--help"] : ["--help"], cwd, signal, timeoutMs: 10_000, maxOutputBytes: 64 * 1024 });
      const supported = (provider === "codex" ? ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--output-schema", "--json"]
        : ["--safe-mode", "--restricted", "--tools", "--strict-mcp-config", "--json-schema", "--no-session-persistence"])
        .every(flag => help.stdout.includes(flag));
      const auth = await run({ command: provider, args: provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"], cwd, signal, timeoutMs: 10_000, maxOutputBytes: 8192 });
      if (provider === "codex") result.authenticated = /logged in using chatgpt/i.test(`${auth.stdout}\n${auth.stderr}`);
      else {
        const status = object.parse(JSON.parse(auth.stdout));
        result.authenticated = status.loggedIn === true && status.authMethod === "claude.ai";
      }
      result.ready = result.authenticated && supported && Boolean(result.version);
    } catch { /* No raw CLI output or credential-bearing auth data leaves this function. */ }
    return result;
  });
  return { provider, readiness,
    async generate<T>(request: TextRequest<T>): Promise<T> {
      if (request.model !== undefined && !modelPattern.test(request.model) || !request.prompt || Buffer.byteLength(request.prompt) > 64 * 1024) throw new Error("invalid_text_request");
      if (!(await readiness(request.signal)).ready) throw new Error("provider_not_ready");
      return isolated(async cwd => {
        let args: string[];
        if (provider === "codex") {
          const schemaPath = join(cwd, "response.schema.json");
          await writeFile(schemaPath, JSON.stringify(request.jsonSchema), { mode: 0o600 });
          args = ["exec", "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
            ...(request.model ? ["--model", request.model] : []), "--json", "--output-schema", schemaPath,
            "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"', "-c", 'approval_policy="never"',
            "-c", 'web_search="disabled"', "-c", "features.shell_tool=false", "-c", "features.unified_exec=false",
            "-c", "features.apps=false", "-c", "features.plugins=false", "-c", "features.hooks=false", "-c", "features.multi_agent=false",
            "-c", "features.code_mode=false", "-c", "features.skill_search=false", "-c", "features.skip_host_skill_discovery=true", "-"];
        } else {
          args = ["-p", "--output-format", "stream-json", "--verbose", ...(request.model ? ["--model", request.model] : []),
            "--safe-mode", "--restricted", "--tools", "", "--permission-mode", "dontAsk", "--permission-prompts", "none",
            "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--no-session-persistence",
            "--disable-slash-commands", "--no-chrome", "--json-schema", JSON.stringify(request.jsonSchema)];
        }
        const { stdout } = await run({ command: provider, args, cwd, input: request.prompt, signal: request.signal, timeoutMs: 90_000, maxOutputBytes: 256 * 1024 });
        try {
          const events = stdout.trim().split("\n").filter(Boolean).map(line => object.parse(JSON.parse(line)));
          let value: unknown;
          if (provider === "codex") {
            if (!events.some(e => e.type === "turn.completed") || events.some(e => e.type === "turn.failed" || e.type === "error")) throw new Error();
            const messages = events.filter(e => e.type === "item.completed" && object.safeParse(e.item).success)
              .map(e => object.parse(e.item)).filter(item => item.type === "agent_message");
            const text = messages.at(-1)?.text;
            if (typeof text !== "string" || Buffer.byteLength(text) > 4096) throw new Error();
            value = JSON.parse(text);
          } else {
            const results = events.filter(e => e.type === "result");
            if (results.length !== 1 || results[0].is_error !== false || results[0].subtype !== "success") throw new Error();
            value = results[0].structured_output;
          }
          if (value === undefined || Buffer.byteLength(JSON.stringify(value)) > 4096) throw new Error();
          return request.validate(value);
        } catch { throw new Error("invalid_provider_result"); }
      });
    },
  };
}
