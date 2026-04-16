import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { DEFAULT_REPLY_LANGUAGE, normalizeReplyLanguage } from "@/lib/ai/reply-language-options";

export async function getLocationDefaultReplyLanguage(
    locationId: string | null | undefined,
    fallbackLanguage: string = DEFAULT_REPLY_LANGUAGE,
): Promise<string> {
    const normalizedFallback = normalizeReplyLanguage(fallbackLanguage) || DEFAULT_REPLY_LANGUAGE;
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return normalizedFallback;

    const aiDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: normalizedLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    }).catch(() => null);

    const configured = normalizeReplyLanguage(aiDoc?.payload?.defaultReplyLanguage);
    return configured || normalizedFallback;
}
