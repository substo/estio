import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStudioR2Store, readStudioR2Config } from "./media-r2";
import { checkStudioReadiness, type ReadinessMode } from "./readiness";
import { requestStudioRest } from "./rest-client";

export async function checkStudioMediaTools(signal: AbortSignal, env: NodeJS.ProcessEnv = process.env) {
  const run = (tool: string, args: string[]) => new Promise<string>((resolve, reject) => {
    execFile(tool, args, { signal, timeout: 5000, maxBuffer: 64 * 1024, encoding: "utf8" }, (error, stdout) => error ? reject(new Error("media_tools_unavailable")) : resolve(stdout));
  });
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (!/\bhttps\b/.test(await run(tool, ["-hide_banner", "-protocols"]))) throw new Error("media_https_protocol_unavailable");
  }
  // Actually encode a tiny synthetic Opus file, then parse it; -version alone cannot prove the required codec is installed.
  const minimum = Number(env.STUDIO_MIN_FREE_BYTES ?? 1024 ** 3);
  if (!Number.isSafeInteger(minimum) || minimum < 64 * 1024 ** 2) throw new Error("invalid_minimum_free_bytes");
  for (const location of [process.cwd(), os.tmpdir()]) {
    const space = await statfs(location);
    if (space.bavail * space.bsize < minimum) throw new Error("media_disk_capacity");
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "studio-readiness-"));
  try {
    const file = path.join(dir, "probe.ogg");
    await writeFile(path.join(dir, "writable"), "ok");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "0.05", "-c:a", "libopus", file]);
    await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", file]);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function readStudioRelease(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  // Same built artifact as the web's /api/version. No production fallback to an unrelated source SHA.
  try { const release = (await readFile(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim(); if (release) return release; } catch { /* local development may not have a build */ }
  return env.NODE_ENV !== "production" ? env.DEPLOY_BUILD_ID?.trim() : undefined;
}
export function runtimeStudioReadiness(mode: ReadinessMode, release?: string, instanceId?: string, startedAfter?: number) {
  const env = process.env, r2 = readStudioR2Config(env);
  return checkStudioReadiness({ mode, env, release, instanceId, startedAfter,
    snapshot: signal => requestStudioRest({ projectUrl: env.STUDIO_SUPABASE_URL!, serviceRoleKey: env.STUDIO_SUPABASE_SERVICE_ROLE_KEY! },
      "rpc/studio_readiness_snapshot", { method: "POST", body: "{}", signal }),
    media: signal => r2 ? createStudioR2Store(r2).checkBucket(signal) : Promise.reject(new Error("media_unconfigured")),
    tools: signal => checkStudioMediaTools(signal, env),
  });
}
