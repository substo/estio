import { createHash } from "node:crypto";
import { Webhook } from "svix";
import { getHostBrandConfig, resolveHostBrand } from "../auth/host-brand";
import type { ProfileRealm } from "./profile-lifecycle";

export interface ProfileDeletionCommand { brand: ProfileRealm; userId: string; eventId: string; occurredAt: string; bodyDigest: string; }
function signingKey(secret: string | undefined): Buffer | null {
 if (!secret?.startsWith("whsec_") || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret.slice(6))) return null;
 const bytes = Buffer.from(secret.slice(6), "base64");
 return bytes.length >= 16 && bytes.length <= 128 ? bytes : null;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
class WebhookInputError extends Error { constructor(public status: number) { super("Invalid webhook input"); } }
async function rawBody(request: Request): Promise<Buffer> {
 const reader = request.body?.getReader(); if (!reader) throw new WebhookInputError(400);
 const chunks: Uint8Array[] = []; let bytes = 0;
 try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength;
  if (bytes > 65536) { await reader.cancel(); throw new WebhookInputError(413); } chunks.push(part.value);
 } } finally { reader.releaseLock(); }
 return Buffer.concat(chunks);
}
/** Dedicated profile-only endpoint: no Business sync or session authentication. */
export async function clerkProfileWebhookResponse(request: Request, deps: {
 cleanup(command: ProfileDeletionCommand): Promise<unknown>; env?: NodeJS.ProcessEnv;
}): Promise<Response> {
 const env = deps.env ?? process.env;
 const brand = resolveHostBrand(request.headers.get("host"), getHostBrandConfig(env));
 if (brand !== "estio" && brand !== "substo") return json({ error: "Not found." }, 404);
 const prefix = brand === "estio" ? "ESTIO" : "SUBSTO";
 const other = brand === "estio" ? "SUBSTO" : "ESTIO";
 const secret = env[`${prefix}_CLERK_PROFILE_WEBHOOK_SECRET`]?.trim();
 const instance = env[`${prefix}_CLERK_INSTANCE_ID`]?.trim();
 const key = signingKey(secret); const otherKey = signingKey(env[`${other}_CLERK_PROFILE_WEBHOOK_SECRET`]?.trim());
 if (!key || !secret || !instance || instance.length > 200 || instance === env[`${other}_CLERK_INSTANCE_ID`]?.trim()
  || (otherKey && key.equals(otherKey))) return json({ error: "Profile webhook is not configured for this realm." }, 503);
 let verifier: Webhook;
 try { verifier = new Webhook(secret); } catch { return json({ error: "Profile webhook signing configuration is invalid." }, 503); }
 if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return json({ error: "JSON is required." }, 415);
 const eventId = request.headers.get("svix-id"); const timestamp = request.headers.get("svix-timestamp"); const signature = request.headers.get("svix-signature");
 if (!eventId || !/^[A-Za-z0-9_-]{1,200}$/.test(eventId) || !timestamp || !/^[0-9]{1,20}$/.test(timestamp) || !signature || signature.length > 4096) return json({ error: "Invalid webhook headers." }, 400);
 let event: Record<string, unknown>; let body: Buffer;
 try {
  body = await rawBody(request);
  // Verify exact bytes, before any reserialization or body-based realm choice.
  const verified = verifier.verify(body, { "svix-id": eventId, "svix-timestamp": timestamp, "svix-signature": signature });
  if (!verified || typeof verified !== "object" || Array.isArray(verified)) throw new WebhookInputError(400);
  event = verified as Record<string, unknown>;
 } catch (error) { return json({ error: "Invalid profile webhook." }, error instanceof WebhookInputError ? error.status : 400); }
 if (event.object !== "event" || event.instance_id !== instance || typeof event.type !== "string") return json({ error: "Webhook instance or event is invalid." }, 400);
 if (event.type !== "user.deleted") return json({ ignored: true });
 const data = event.data as Record<string, unknown> | undefined;
 if (!data || typeof data !== "object" || Array.isArray(data) || data.object !== "user" || data.deleted !== true
  || typeof data.id !== "string" || !/^user_[A-Za-z0-9_-]{1,180}$/.test(data.id)
  || !Number.isSafeInteger(event.timestamp) || Number(event.timestamp) < 0 || Number(event.timestamp) > Date.now() + 300000) return json({ error: "Invalid deletion event." }, 400);
 try {
  const occurredAt = new Date(Number(event.timestamp)).toISOString();
  await deps.cleanup({ brand, userId: data.id, eventId, occurredAt, bodyDigest: createHash("sha256").update(body).digest("hex") });
  return json({ received: true });
 } catch { return json({ error: "Profile cleanup could not be confirmed. Retry this event." }, 503); }
}
