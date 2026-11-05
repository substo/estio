import "server-only";
import { Prisma } from "@prisma/client";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { studioDb } from "@/lib/studio/studio-db";
import { safeDeviceCapabilities } from "@/lib/studio/devices-policy";
import { WORKER_ONLINE_SECONDS } from "@/lib/studio/jobs";
import { assembleAiConnections, type AiConnections } from "./connections-model";

/**
 * The one answer to "which AI can this Location use?". Callers pass a Location they have already authorised; no secret
 * value is read or returned, only whether each connection exists and is ready.
 */
export async function getAiConnections(locationId: string): Promise<AiConnections> {
  const secret = (domain: string, secretKey: string) =>
    settingsService.hasSecret({ scopeType: "LOCATION", scopeId: locationId, domain: domain as typeof SETTINGS_DOMAINS.LOCATION_AI, secretKey }).catch(() => false);
  const [geminiKey, openAiKey, integrations, accessToken, authCache, devices] = await Promise.all([
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY),
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.OPENAI_API_KEY),
    settingsService.getDocument<{ chatGptSubscription?: { enabled?: boolean; health?: string } }>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS }).catch(() => null),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE),
    studioDb.rows<{ name: string; revoked_at: string | null; paused: boolean; seen_at: string | null; report: Record<string, unknown> }>(Prisma.sql`
      select name, revoked_at, paused, seen_at, report from studio.studio_devices t where location_id = ${locationId} and revoked_at is null limit 20`).catch(() => []),
  ]);
  const chatGpt = integrations?.payload?.chatGptSubscription;
  return assembleAiConnections({
    geminiKey, openAiKey,
    chatGpt: { enabled: chatGpt?.enabled === true, health: chatGpt?.health ?? null, hasCredential: accessToken || authCache },
    devices: devices.map(d => ({ name: d.name, revoked: !!d.revoked_at, paused: d.paused, seenAt: d.seen_at, draining: d.report?.draining === true, capabilities: safeDeviceCapabilities(d.report) })),
  }, Date.now(), WORKER_ONLINE_SECONDS);
}
