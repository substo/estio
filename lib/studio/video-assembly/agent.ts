import { runNativeProcess, type ProcessRunner } from "../companion/process";

/** The environment and arguments for every editing-agent run: only `substo` commands and file reads, the Mac's own subscription, no MCP, no session kept. */
export const agentEnv = () => ({ HOME: process.env.HOME, USER: process.env.USER, TMPDIR: process.env.TMPDIR, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, PATH: `${process.env.PATH ?? ""}:${process.env.HOME ?? ""}/.local/bin` });
export async function runEditingAgent(o: { cwd: string; brief: string; editorDocs: string; model?: string; run?: ProcessRunner; signal?: AbortSignal }): Promise<string> {
  const run = o.run ?? runNativeProcess;
  const agent = await run({ command: "claude", cwd: o.cwd, env: agentEnv(), signal: o.signal, timeoutMs: 45 * 60_000, maxOutputBytes: 512 * 1024, input: o.brief,
    args: ["-p", ...(o.model ? ["--model", o.model] : []), "--permission-mode", "dontAsk", "--allowedTools", "Bash(substo:*),Read", "--add-dir", o.editorDocs, "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence"] });
  return agent.stdout;
}
/** The agent's closing words, without the exported-path line, bounded: what the owner reads as the reply. */
export function agentSummary(stdout: string, max = 600): string {
  const lines = stdout.trim().split("\n").map(l => l.trimEnd());
  while (lines.length && (!lines.at(-1)!.trim() || /\.mp4\s*$/i.test(lines.at(-1)!))) lines.pop();
  const text = lines.join("\n").replace(/\*\*/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text || "Done.";
}
