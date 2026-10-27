import { StudioCommandError } from "./command-error";
import { isStudioProviderUnavailable, StudioRestError, STUDIO_UNAVAILABLE_MESSAGE, studioUnavailableResponse } from "./rest-client";
export const deviceJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
/** Heartbeats carry a whitelisted report of up to 16 KiB plus the envelope. */
export const DEVICE_BODY_LIMIT = 32768;
export async function readDeviceJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new StudioCommandError("Send JSON.", 415);
  const reader = request.body?.getReader(); if (!reader) throw new StudioCommandError("Missing command.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > DEVICE_BODY_LIMIT) { await reader.cancel(); throw new StudioCommandError("Command too large.", 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new StudioCommandError("Invalid JSON."); }
}
/** Never include RPC messages, request bodies or tokens in responses/logs. */
export function deviceError(error: unknown) {
  if (error instanceof StudioCommandError) return deviceJson({ ok: false, error: error.message }, error.status);
  if (isStudioProviderUnavailable(error)) return studioUnavailableResponse({ ok: false, error: STUDIO_UNAVAILABLE_MESSAGE });
  if (error instanceof StudioRestError) {
    if (error.code === "42501") return deviceJson({ ok: false, error: "Access denied." }, 403);
    if (error.code === "P0002") return deviceJson({ ok: false, error: "This pairing code was not found, has expired or was already used. Start pairing again on the computer." }, 404);
    if (["23505", "40001"].includes(error.code ?? "")) return deviceJson({ ok: false, error: "Command already issued or changed. Reload before trying again." }, 409);
    if (["22023", "22P02", "22007", "22008", "23514", "23502"].includes(error.code ?? "")) return deviceJson({ ok: false, error: "Invalid command." }, 400);
  }
  return deviceJson({ ok: false, error: "Device service unavailable." }, 503);
}

/**
 * Small per-process fixed-window limiter for unauthenticated pairing endpoints.
 * Behind Cloudflare/Caddy, CF-Connecting-IP identifies the client.
 */
const windows = new Map<string, { count: number; resetAt: number }>();
export function deviceClientIp(request: Request) {
  return request.headers.get("cf-connecting-ip")?.trim() || request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
export function limitDeviceRequest(request: Request, scope: string, limit: number, windowMs: number, now = Date.now()) {
  const key = `${scope}:${deviceClientIp(request)}`;
  if (windows.size > 10_000) { for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k); if (windows.size > 50_000) windows.clear(); }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) { windows.set(key, { count: 1, resetAt: now + windowMs }); return; }
  if (++current.count > limit) throw new StudioCommandError("Too many requests. Try again shortly.", 429);
}
