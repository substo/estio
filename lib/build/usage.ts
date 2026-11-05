import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { Usage } from "./contract";

/**
 * Subscription usage from QuotaCell's bundled helper (CodexBarCLI, `--source cli`): it asks the provider CLIs, starts no
 * model and reads no credentials itself. Keys are Build quota buckets (T3 provider instance ids).
 */
export const usageProviders = { codex: "codex", claude: "claudeAgent" } as const;
type Window = { usedPercent?: number; resetsAt?: string } | null | undefined;
type Reading = { usage?: { primary?: Window; secondary?: Window; tertiary?: Window; loginMethod?: string; updatedAt?: string }; rateWindowLabels?: Record<string, string> };

export function parseUsage(stdout: string, now = new Date()): Usage[string] | null {
  const reading = (JSON.parse(stdout) as Reading[])[0];
  const u = reading?.usage;
  if (!u) return null;
  const windows = (["primary", "secondary", "tertiary"] as const).flatMap(key => {
    const w = u[key];
    if (typeof w?.usedPercent !== "number") return [];
    return [{ label: (reading.rateWindowLabels?.[key] ?? key).slice(0, 40), remaining: Math.max(0, Math.min(100, 100 - w.usedPercent)), ...(w.resetsAt ? { resetsAt: w.resetsAt.slice(0, 40) } : {}) }];
  });
  if (!windows.length) return null;
  return { remaining: Math.min(...windows.map(w => w.remaining)), windows, ...(u.loginMethod ? { plan: u.loginMethod.slice(0, 40) } : {}), at: (u.updatedAt ?? now.toISOString()).slice(0, 40) };
}

// Same environment QuotaCell gives its helper: CLI search path, its own config, no Keychain access.
function helperEnvironment() {
  const home = process.env.HOME ?? "";
  return { PATH: [`${home}/.local/bin`, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", process.env.PATH ?? ""].join(":"), HOME: home, USER: process.env.USER ?? "",
    TMPDIR: process.env.TMPDIR ?? "/tmp", CODEXBAR_CONFIG: path.join(home, "Library/Application Support/QuotaCell/backend.json"), CODEXBAR_DISABLE_KEYCHAIN_ACCESS: "1", NO_COLOR: "1" };
}
const run = async (helper: string, args: string[]) =>
  (await promisify(execFile)(helper, args, { env: helperEnvironment() as unknown as NodeJS.ProcessEnv, timeout: 60_000, maxBuffer: 1024 * 1024, encoding: "utf8" })).stdout;
export async function readUsage(helper: string) {
  const usage: Usage = {};
  for (const [provider, bucket] of Object.entries(usageProviders)) {
    try {
      const parsed = parseUsage(await run(helper, ["usage", "--provider", provider, "--source", "cli", "--format", "json", "--no-credits"]));
      if (parsed) usage[bucket] = parsed;
    } catch { /* unavailable: report nothing rather than a guess */ }
  }
  return usage;
}
