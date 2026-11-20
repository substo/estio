import "server-only";
import { Prisma } from "@prisma/client";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { studioDb } from "@/lib/studio/studio-db";
import { safeDeviceCapabilities } from "@/lib/studio/devices-policy";
import { WORKER_ONLINE_SECONDS } from "@/lib/studio/jobs";
import { CHATGPT_SUBSCRIPTION_TEXT_MODELS, stripChatGptSubscriptionModelPrefix } from "./chatgpt-subscription";
import { getStoredProviderModelOptions } from "./provider-model-catalog";
import { assembleAiConnections, type AiConnectionInputs, type AiConnections, type AiModelOption } from "./connections-model";

async function locationModelCatalog(locationId: string): Promise<NonNullable<AiConnectionInputs["catalogs"]>> {
  const stored = (provider: "openai_api" | "google_gemini") => getStoredProviderModelOptions({ provider, scopeType: "LOCATION", scopeId: locationId })
    .then(options => options.map((o): AiModelOption => ({ id: o.value, label: o.label }))).catch(() => [] as AiModelOption[]);
  const [openai, gemini] = await Promise.all([stored("openai_api"), stored("google_gemini")]);
  return {
    chatgpt_subscription: CHATGPT_SUBSCRIPTION_TEXT_MODELS.map(m => ({ id: stripChatGptSubscriptionModelPrefix(m.value), label: m.label.replace(/^ChatGPT Subscription /, "") })),
    openai_key: openai, gemini_key: gemini,
  };
}

/**
 * The one answer to "which AI can this Location use?". Callers pass a Location they have already authorised; no secret
 * value is read or returned, only whether each connection exists, its status and its models. Every Mac in the Location is
 * listed with its owner so routing can pick only the requester's own (see lib/ai/routing.ts); strip owners before display.
 */
export async function getAiConnections(locationId: string): Promise<AiConnections> {
  const secret = (domain: string, secretKey: string) =>
    settingsService.hasSecret({ scopeType: "LOCATION", scopeId: locationId, domain: domain as typeof SETTINGS_DOMAINS.LOCATION_AI, secretKey }).catch(() => false);
  const [geminiKey, openAiKey, integrations, accessToken, authCache, devices, catalogs] = await Promise.all([
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY),
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.OPENAI_API_KEY),
    settingsService.getDocument<{ chatGptSubscription?: { enabled?: boolean; health?: string } }>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS }).catch(() => null),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE),
    studioDb.rows<{ id: string; name: string; created_by: string; revoked_at: string | null; paused: boolean; processing_enabled: boolean; seen_at: string | null; report: Record<string, unknown> }>(Prisma.sql`
      select id, name, created_by, revoked_at, paused, processing_enabled, seen_at, report from studio.studio_devices t
      where location_id = ${locationId} and revoked_at is null order by seen_at desc nulls last limit 20`).catch(() => []),
    locationModelCatalog(locationId),
  ]);
  const chatGpt = integrations?.payload?.chatGptSubscription;
  return assembleAiConnections({
    geminiKey, openAiKey,
    chatGpt: { enabled: chatGpt?.enabled === true, health: chatGpt?.health ?? null, hasCredential: accessToken || authCache },
    devices: devices.map(d => ({ id: d.id, name: d.name, createdBy: d.created_by, revoked: !!d.revoked_at, paused: d.paused, processingEnabled: d.processing_enabled,
      seenAt: d.seen_at, draining: d.report?.draining === true, capabilities: safeDeviceCapabilities(d.report) })),
    catalogs,
  }, Date.now(), WORKER_ONLINE_SECONDS);
}
