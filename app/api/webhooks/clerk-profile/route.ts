import { clerkProfileWebhookResponse } from "@/lib/platform/clerk-profile-webhook";
import { studioRest } from "@/lib/studio/rest";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
 return clerkProfileWebhookResponse(request, { cleanup: command => studioRest("rpc/platform_delete_profile", { method: "POST", body: JSON.stringify({
  p_brand: command.brand, p_user: command.userId, p_event_id: command.eventId, p_occurred_at: command.occurredAt, p_body_digest: command.bodyDigest,
 }) }) });
}
