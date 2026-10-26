import { StudioCommandError } from "./command-error";
import { StudioRestError } from "./rest-client";
export const deviceJson = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function readDeviceJson(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new StudioCommandError("Send JSON.", 415);
  const reader = request.body?.getReader(); if (!reader) throw new StudioCommandError("Missing command.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
    if (bytes > 16384) { await reader.cancel(); throw new StudioCommandError("Command too large.", 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new StudioCommandError("Invalid JSON."); }
}
/** Never include RPC messages, request bodies or tokens in responses/logs. */
export function deviceError(error: unknown) {
  if (error instanceof StudioCommandError) return deviceJson({ ok: false, error: error.message }, error.status);
  if (error instanceof StudioRestError) {
    if (error.code === "42501") return deviceJson({ ok: false, error: "Access denied." }, 403);
    if (["23505", "40001"].includes(error.code ?? "")) return deviceJson({ ok: false, error: "Command already issued or changed. Reload before trying again." }, 409);
    if (["22023", "22P02", "22007", "22008", "23514", "23502"].includes(error.code ?? "")) return deviceJson({ ok: false, error: "Invalid command." }, 400);
  }
  return deviceJson({ ok: false, error: "Device service unavailable." }, 503);
}
