import { studioDb } from "@/lib/studio/studio-db";
import { clerkProfileWebhookResponse } from "@/lib/platform/clerk-profile-webhook";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) {
 return clerkProfileWebhookResponse(request, { cleanup: command => studioDb.call("platform_delete_profile", {
  p_app: command.brand, p_user: command.userId, p_event_id: command.eventId, p_occurred_at: command.occurredAt, p_body_digest: command.bodyDigest,
 }) });
}
