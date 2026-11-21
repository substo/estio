import { tmpdir } from "node:os";
import type { Usage } from "../../build/contract";
import { codexLoginMethod } from "./providers";
import { runNativeProcess, type ProcessRunner } from "./process";

const request = [
  { id: 1, method: "initialize", params: { clientInfo: { name: "estio-native-usage", version: "1" } } },
  { method: "initialized" },
  { id: 2, method: "account/rateLimits/read" },
].map(value => JSON.stringify({ jsonrpc: "2.0", ...value })).join("\n") + "\n";

function reply(stdout: string) {
  for (const line of stdout.split("\n")) {
    try {
      const parsed = JSON.parse(line);
      if (parsed?.id === 2 && ("result" in parsed || "error" in parsed)) return parsed;
    } catch { /* A partial line is not a reply. */ }
  }
  return null;
}

/** Only the Codex subscription bucket and its documented windows. No credits, account fields or private API calls. */
export function parseCodexAllowance(stdout: string, now = Date.now()): Usage {
  const result = reply(stdout)?.result;
  const limits = result?.rateLimitsByLimitId?.codex ?? result?.rateLimits;
  if (!limits || (limits.limitId != null && limits.limitId !== "codex")) return {};
  const windows = (["primary", "secondary"] as const).flatMap(key => {
    const window = limits[key];
    if (!window || typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) return [];
    const reset = typeof window.resetsAt === "number" ? new Date(window.resetsAt * 1000) : null;
    if (reset && (!Number.isFinite(reset.getTime()) || reset.getTime() <= now)) return [];
    const label = Number.isSafeInteger(window.windowDurationMins) && window.windowDurationMins > 0
      ? `${window.windowDurationMins} min` : key === "primary" ? "Primary" : "Secondary";
    return [{ label, remaining: 100 - window.usedPercent, ...(reset ? { resetsAt: reset.toISOString() } : {}) }];
  });
  return windows.length ? { codex: { remaining: Math.min(...windows.map(window => window.remaining)), windows, at: new Date(now).toISOString() } } : {};
}

export async function readNativeUsage(run: ProcessRunner = runNativeProcess, signal?: AbortSignal): Promise<Usage> {
  const options = { command: "codex", cwd: tmpdir(), signal, timeoutMs: 10_000, maxOutputBytes: 256 * 1024 };
  try {
    const auth = await run({ ...options, args: ["login", "status"] });
    if (codexLoginMethod(`${auth.stdout}\n${auth.stderr}`) !== "chatgpt") return {};
    const { stdout } = await run({ ...options, args: ["app-server", "-c", 'model_provider="openai"', "-c", 'forced_login_method="chatgpt"'],
      input: request, until: output => reply(output) !== null });
    return parseCodexAllowance(stdout);
  } catch { return {}; }
}
