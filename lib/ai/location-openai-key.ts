import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

/** Live Platform calls use only the location's API key, never a personal or global key. */
export async function resolveLocationOpenAiApiKey(locationId: string): Promise<string | null> {
    if (!locationId.trim()) return null;
    const key = await settingsService.getSecret({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
        secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
    }).catch(() => null);
    return key?.trim() || null;
}
