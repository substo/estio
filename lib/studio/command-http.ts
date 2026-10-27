import { isStudioProviderUnavailable, StudioRestError, studioUnavailableResponse } from "./rest-client";
import { StudioCommandError } from "./command-error";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
/** Shared same-origin, bounded, retry-aware HTTP boundary for paid commands. */
export async function studioCommandResponse<T>(request: Request, deps: {
  profile(): Promise<{ origin: string } | null>; parse(value: unknown): T; execute(command: T): Promise<unknown>;
}): Promise<Response> {
  try {
    const profile = await deps.profile();
    if (!profile) return json({ error: "Sign in as yourself." }, 401);
    if (request.headers.get("origin") !== profile.origin) return json({ error: "Forbidden." }, 403);
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "Send a JSON command." }, 415);
    const reader = request.body?.getReader(); if (!reader) return json({ error: "Missing command." }, 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new StudioCommandError("Command too large.", 413); } chunks.push(part.value); }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw new StudioCommandError("Invalid command JSON."); }
    return json(await deps.execute(deps.parse(body)));
  } catch (error) {
    if (error instanceof StudioCommandError) return json({ error: error.message }, error.status);
    if (isStudioProviderUnavailable(error)) return studioUnavailableResponse();
    if (error instanceof StudioRestError && ["40001", "23505"].includes(error.code ?? "")) return json({ error: "This review or job changed. Reload before continuing." }, 409);
    if (error instanceof StudioRestError && error.code === "42501") return json({ error: "Location access is required." }, 403);
    if (error instanceof StudioRestError && ["22023", "22P02", "23514"].includes(error.code ?? "")) return json({ error: "The input exceeds this workflow's bounds or is unavailable. Reload and choose supported inputs or a smaller range." }, 400);
    return json({ error: "The command could not be confirmed. Retry the same command to check its outcome." }, 503);
  }
}
