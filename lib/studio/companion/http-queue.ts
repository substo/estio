import { z } from "zod";
import type { StudioQueue } from "../worker/queue";
import { appOrigin, deviceTokenPattern, type DeviceCredentials } from "./config";

const job = z.object({ id: z.string().uuid(), location_id: z.string().min(1).max(255), kind: z.literal("studio.diagnostic"),
  payload: z.record(z.unknown()), lease_token: z.string().uuid(), lease_expires_at: z.string().datetime({ offset: true }),
  attempts: z.number().int().nonnegative(), max_attempts: z.number().int().positive() });
export const providerCommand = z.object({ id: z.string().uuid(), kind: z.enum(["provider_login", "provider_logout"]), provider: z.enum(["codex", "claude"]) });
export type ProviderCommand = z.infer<typeof providerCommand>;
export const heartbeatState = z.object({ processingEnabled: z.boolean(), paused: z.boolean(),
  config: z.object({ version: z.number().int().nonnegative(), value: z.unknown() }), commands: z.array(providerCommand).max(20) });
export type HeartbeatState = z.infer<typeof heartbeatState>;
export interface ConfigAck { version: number; status: "applied" | "error"; unsupported?: Record<string, string>; error?: string }
export interface CommandStatus {
  commandId: string; status: "running" | "waiting_for_user" | "succeeded" | "failed";
  display?: { verificationUrl: string; userCode?: string }; error?: string;
}
export interface DeviceCallOptions { fetcher?: typeof fetch; timeoutMs?: number }

/** One JSON POST to /api/studio/device/<operation>. Never propagate response bodies/errors:
 * they may contain credentials or untrusted server text. */
export async function deviceCall<T>(origin: string, token: string | null, operation: string, body: unknown, schema: z.ZodType<T>, options: DeviceCallOptions = {}): Promise<T> {
  try {
    if (token !== null && !deviceTokenPattern.test(token)) throw new Error();
    const response = await (options.fetcher ?? fetch)(`${appOrigin(origin)}/api/studio/device/${operation}`, {
      method: "POST", redirect: "error",
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }), "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) throw new Error();
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 256 * 1024) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const envelope = z.object({ ok: z.literal(true), data: z.unknown() }).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return schema.parse(envelope.data);
  } catch { throw new Error(`device_${operation.replaceAll("/", "_")}_failed`); }
}

export function createDeviceStudioQueue(credentials: DeviceCredentials, options: DeviceCallOptions & {
  capabilities?: () => Record<string, unknown>;
  /** Pending config acknowledgement to piggyback on the next heartbeat. */
  configAck?: () => ConfigAck | undefined;
  /** Called with the server's device state after each successful heartbeat (null for an older server). */
  onHeartbeat?: (state: HeartbeatState | null, sentAck: ConfigAck | undefined) => void;
} = {}): StudioQueue {
  const { origin, token } = credentials;
  appOrigin(origin);
  if (!deviceTokenPattern.test(token)) throw new Error("invalid_device_token");
  const call = <T>(operation: string, body: unknown, schema: z.ZodType<T>) => deviceCall(origin, token, operation, body, schema, options);
  return {
    claim: (workerId, limit, leaseSeconds) => call("claim", { workerId, limit, leaseSeconds }, z.array(job).max(50)),
    extend: (jobId, workerId, leaseSeconds, leaseToken) => call("extend", { jobId, workerId, leaseSeconds, leaseToken }, z.boolean()),
    complete: (jobId, workerId, result, leaseToken) => call("complete", { jobId, workerId, result, leaseToken }, z.boolean()),
    fail: (jobId, workerId, failure, leaseToken) => call("fail", { jobId, workerId, failure, leaseToken }, z.enum(["retry_scheduled", "failed", "lease_lost"])),
    heartbeat: async (workerId, release, startedAt, report) => {
      const configAck = options.configAck?.();
      const data = await call("heartbeat", { workerId, release, startedAt: startedAt.toISOString(), report: { ...options.capabilities?.(), ...report },
        ...(configAck ? { configAck } : {}) }, z.union([z.null(), z.boolean(), heartbeatState]));
      options.onHeartbeat?.(typeof data === "object" ? data : null, configAck);
    },
  };
}
/** Report provider command progress. Returns false when the server says the command was cancelled/finished. */
export async function postCommandStatus(credentials: DeviceCredentials, workerId: string, status: CommandStatus, options: DeviceCallOptions = {}): Promise<boolean> {
  const data = await deviceCall(credentials.origin, credentials.token, "command", { workerId, ...status },
    z.union([z.boolean(), z.null(), z.object({ status: z.string().optional(), cancelled: z.boolean().optional() }).passthrough()]), options);
  if (data === false) return false;
  if (data && typeof data === "object") return data.cancelled !== true && data.status !== "cancelled";
  return true;
}

const pairStart = z.object({ pairingId: z.string().uuid(), deviceCode: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  userCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/), verificationUrl: z.string().url().max(500),
  expiresAt: z.string().datetime({ offset: true }), intervalSeconds: z.number().int().min(1).max(60) });
export type PairStart = z.infer<typeof pairStart>;
const pairPoll = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("approved"), token: z.string().regex(deviceTokenPattern), deviceId: z.string().uuid(), businessName: z.string().max(200) }),
  z.object({ status: z.enum(["denied", "expired", "consumed"]) }),
]);
export type PairPoll = z.infer<typeof pairPoll>;
export const startPairing = (origin: string, body: { name: string; platform: string }, options?: DeviceCallOptions) =>
  deviceCall(origin, null, "pair/start", body, pairStart, options);
export const pollPairing = (origin: string, body: { pairingId: string; deviceCode: string }, options?: DeviceCallOptions) =>
  deviceCall(origin, null, "pair/poll", body, pairPoll, options);
