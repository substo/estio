import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { CHATGPT_SUBSCRIPTION_TEXT_MODELS, stripChatGptSubscriptionModelPrefix } from "./chatgpt-subscription";
import { getStoredProviderModelOptions } from "./provider-model-catalog";
import { assembleAiConnections, type AiConnectionInputs, type AiConnections, type AiModelOption } from "./connections-model";

/**
 * Worker-safe loader behind getAiConnections (lib/ai/connections.ts adds the Location's Macs). CRM server routing reads it
 * without devices: no CRM call runs on a Mac. No secret value is read or returned, only presence, status and models.
 */
export type AiDeviceRow = { id: string; name: string; created_by: string; revoked_at: string | null; paused: boolean; processing_enabled: boolean; seen_at: string | null; report: Record<string, unknown> };

async function locationModelCatalog(locationId: string): Promise<NonNullable<AiConnectionInputs["catalogs"]>> {
  const stored = (provider: "openai_api" | "google_gemini") => getStoredProviderModelOptions({ provider, scopeType: "LOCATION", scopeId: locationId })
    .then(options => options.map((o): AiModelOption => ({ id: o.value, label: o.label }))).catch(() => [] as AiModelOption[]);
  const [openai, gemini] = await Promise.all([stored("openai_api"), stored("google_gemini")]);
  return {
    chatgpt_subscription: CHATGPT_SUBSCRIPTION_TEXT_MODELS.map(m => ({ id: stripChatGptSubscriptionModelPrefix(m.value), label: m.label.replace(/^ChatGPT Subscription /, "") })),
    openai_key: openai, gemini_key: gemini,
  };
}

export async function loadAiConnections(locationId: string, options: {
  listDevices?: () => Promise<AiDeviceRow[]>;
  safeCapabilities?: (report: Record<string, unknown>) => Record<string, unknown>;
  onlineSeconds?: number;
} = {}): Promise<AiConnections> {
  const secret = (domain: string, secretKey: string) =>
    settingsService.hasSecret({ scopeType: "LOCATION", scopeId: locationId, domain: domain as typeof SETTINGS_DOMAINS.LOCATION_AI, secretKey }).catch(() => false);
  const [geminiKey, openAiKey, integrations, accessToken, authCache, devices, catalogs] = await Promise.all([
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY),
    secret(SETTINGS_DOMAINS.LOCATION_AI, SETTINGS_SECRET_KEYS.OPENAI_API_KEY),
    settingsService.getDocument<{ chatGptSubscription?: { enabled?: boolean; health?: string } }>({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS }).catch(() => null),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN),
    secret(SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, SETTINGS_SECRET_KEYS.CHATGPT_CODEX_AUTH_CACHE),
    options.listDevices ? options.listDevices().catch(() => [] as AiDeviceRow[]) : Promise.resolve([] as AiDeviceRow[]),
    locationModelCatalog(locationId),
  ]);
  const chatGpt = integrations?.payload?.chatGptSubscription;
  const capabilities = options.safeCapabilities ?? (() => ({}));
  return assembleAiConnections({
    geminiKey, openAiKey,
    chatGpt: { enabled: chatGpt?.enabled === true, health: chatGpt?.health ?? null, hasCredential: accessToken || authCache },
    devices: devices.map(d => ({ id: d.id, name: d.name, createdBy: d.created_by, revoked: !!d.revoked_at, paused: d.paused, processingEnabled: d.processing_enabled,
      seenAt: d.seen_at, draining: d.report?.draining === true, capabilities: capabilities(d.report) })),
    catalogs,
  }, Date.now(), options.onlineSeconds ?? 90);
}
