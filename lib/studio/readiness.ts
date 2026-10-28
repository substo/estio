import { hasStudioDatabaseConfig } from "./config";
import { readStudioR2Config } from "./media-r2";
import { decryptStudioSecret, encryptStudioSecret, hasStudioSecretKeyId, hasStudioSecretsKey } from "./secrets";
export const STUDIO_WORKER_HANDLERS = ["studio.diagnostic", "studio.transcribe_upload", "studio.idea_review", "studio.script_brief", "studio.knowledge_extract", "studio.brand_profile", "studio.youtube_discovery"];
export const STUDIO_SCHEMA_VERSION = 29;
export type ReadinessMode = "dependencies" | "worker";
export interface WorkerReport { release: string; instance_id: string; protocol: number; handlers: string[]; healthy: boolean; draining: boolean; seen_at: string; started_at: string }
export interface ReadinessSnapshot {
  schema: number; protocol: number; checkedAt: string; keyIds: string[]; workers: WorkerReport[];
  queue: { due: number; oldestDueAt: string | null; expiredLeases: number; uncertainAttempts: number };
}
export interface ReadinessResult { required: boolean; ready: boolean; checks: Array<{ name: string; ok: boolean }>; queue?: ReadinessSnapshot["queue"] }
export function studioReadinessRequired(env: NodeJS.ProcessEnv = process.env) {
  // Dormant R2/key provisioning alone does not activate Studio for existing Business releases.
  return Boolean(env.STUDIO_READINESS_REQUIRED?.trim() || env.SUBSTO_APP_HOSTS?.trim());
}
export function readReadinessSnapshot(value: unknown): ReadinessSnapshot {
  const s = value as ReadinessSnapshot;
  if (!s || s.schema !== STUDIO_SCHEMA_VERSION || s.protocol !== 1 || !Number.isFinite(Date.parse(s.checkedAt)) ||
    !Array.isArray(s.keyIds) || s.keyIds.length > 100 || s.keyIds.some(k => typeof k !== "string" || !/^[a-z0-9_-]{1,32}$/.test(k)) ||
    !Array.isArray(s.workers) || s.workers.length > 100 || !s.queue ||
    [s.queue.due, s.queue.expiredLeases, s.queue.uncertainAttempts].some(n => !Number.isSafeInteger(n) || n < 0) ||
    (s.queue.oldestDueAt !== null && !Number.isFinite(Date.parse(s.queue.oldestDueAt)))) throw new Error("invalid_readiness_snapshot");
  return s;
}
export function hasReadyWorker(s: ReadinessSnapshot, release: string, instanceId?: string, startedAfter?: number): boolean {
  const now = Date.parse(s.checkedAt); // Compare DB timestamps on the DB clock, not a potentially skewed operator clock.
  return s.workers.some(w => {
    if (!w || typeof w !== "object") return false;
    const seen = Date.parse(w.seen_at), started = Date.parse(w.started_at);
    return w.release === release && (!instanceId || w.instance_id === instanceId) && typeof w.instance_id === "string" && Boolean(w.instance_id) &&
      w.protocol === 1 && w.healthy === true && w.draining === false && Number.isFinite(seen) && Number.isFinite(started) &&
      seen <= now + 5000 && now - seen <= 90_000 && started <= seen + 5000 &&
      (startedAfter === undefined || started >= startedAfter) &&
      Array.isArray(w.handlers) && STUDIO_WORKER_HANDLERS.every(h => w.handlers.includes(h));
  });
}
/** Read-only cloud probes; local temp check is injected. Never claims/enqueues work or calls paid providers. */
export async function checkStudioReadiness(input: {
  mode: ReadinessMode; env?: NodeJS.ProcessEnv; release?: string; instanceId?: string; startedAfter?: number;
  snapshot(signal: AbortSignal): Promise<unknown>; media(signal: AbortSignal): Promise<void>;
  tools(signal: AbortSignal): Promise<void>; timeoutMs?: number;
}): Promise<ReadinessResult> {
  const env = input.env ?? process.env;
  const result: ReadinessResult = { required: studioReadinessRequired(env), ready: true, checks: [] };
  if (!result.required) return result;
  const check = (name: string, ok: boolean) => { result.checks.push({ name, ok }); if (!ok) result.ready = false; };
  check("database_configuration", hasStudioDatabaseConfig(env));
  check("media_configuration", Boolean(readStudioR2Config(env)));
  check("encryption_configuration", hasStudioSecretsKey(env));
  if (!result.ready) return result;
  try {
    const value = "studio-readiness-local-roundtrip";
    check("encryption_roundtrip", decryptStudioSecret(encryptStudioSecret(value, "studio:readiness", env), "studio:readiness", env) === value);
  } catch { check("encryption_roundtrip", false); }
  const controller = new AbortController();
  const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    try { return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("readiness_timeout")); }, input.timeoutMs ?? 12_000);
    })]); } finally { clearTimeout(timer!); }
  };
  const probes = await Promise.allSettled([
    bounded(() => input.snapshot(controller.signal).then(readReadinessSnapshot)),
    bounded(() => input.media(controller.signal)), bounded(() => input.tools(controller.signal)),
  ]);
  check("database_schema", probes[0].status === "fulfilled");
  check("media_bucket", probes[1].status === "fulfilled");
  check("media_tools_and_disk", probes[2].status === "fulfilled");
  const snapshot = probes[0].status === "fulfilled" ? probes[0].value as ReadinessSnapshot : null;
  if (snapshot) {
    check("stored_encryption_key_ids", snapshot.keyIds.every(id => hasStudioSecretKeyId(id, env)));
    result.queue = snapshot.queue; // Counts are diagnostics, not claims that a busy or uncertain queue is empty.
  }
  if (input.mode === "worker") {
    check("expected_release", typeof input.release === "string" && input.release.length > 0 && input.release.length <= 100);
    check("process_start", !input.instanceId || (Number.isFinite(input.startedAfter) && input.startedAfter! > 0));
    check("worker", Boolean(snapshot && input.release && hasReadyWorker(snapshot, input.release, input.instanceId, input.startedAfter)));
  }
  return result;
}
