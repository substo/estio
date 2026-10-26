import { z } from "zod";
import type { StudioQueue } from "../worker/queue";
import { appOrigin, configSchema, type CompanionConfig } from "./config";

const job = z.object({ id: z.string().uuid(), workspace_id: z.string().uuid(), kind: z.literal("studio.diagnostic"),
  payload: z.record(z.unknown()), lease_token: z.string().uuid(), lease_expires_at: z.string().datetime({ offset: true }),
  attempts: z.number().int().nonnegative(), max_attempts: z.number().int().positive() });
/** Never propagate response bodies/errors: they may contain credentials or untrusted server text. */
export function createDeviceStudioQueue(config: CompanionConfig, options: {
  fetcher?: typeof fetch; capabilities?: () => Record<string, unknown>; timeoutMs?: number;
} = {}): StudioQueue {
  configSchema.parse(config);
  const origin = appOrigin(config.origin);
  const call = async <T>(operation: string, body: unknown, schema: z.ZodType<T>): Promise<T> => {
    try {
      const response = await (options.fetcher ?? fetch)(`${origin}/api/studio/device/${operation}`, {
        method: "POST", redirect: "error", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
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
    } catch { throw new Error(`device_${operation}_failed`); }
  };
  return {
    claim: (workerId, limit, leaseSeconds) => call("claim", { workerId, limit, leaseSeconds }, z.array(job).max(50)),
    extend: (jobId, workerId, leaseSeconds, leaseToken) => call("extend", { jobId, workerId, leaseSeconds, leaseToken }, z.boolean()),
    complete: (jobId, workerId, result, leaseToken) => call("complete", { jobId, workerId, result, leaseToken }, z.boolean()),
    fail: (jobId, workerId, failure, leaseToken) => call("fail", { jobId, workerId, failure, leaseToken }, z.enum(["retry_scheduled", "failed", "lease_lost"])),
    heartbeat: async (workerId, release, startedAt, report) => {
      await call("heartbeat", { workerId, release, startedAt: startedAt.toISOString(), report: { ...options.capabilities?.(), ...report } }, z.union([z.null(), z.boolean()]));
    },
  };
}
