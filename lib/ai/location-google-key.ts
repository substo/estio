import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

export async function resolveLocationGoogleAiApiKey(locationId: string): Promise<string | null> {
    const targetLocationId = String(locationId || "").trim();
    if (!targetLocationId) return null;

    try {
        const settingsSecret = await settingsService.getSecret({
            scopeType: "LOCATION",
            scopeId: targetLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
        });
        if (settingsSecret?.trim()) return settingsSecret.trim();
    } catch (error) {
        console.warn("[resolveLocationGoogleAiApiKey] Failed to read settings secret:", error);
    }

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: targetLocationId },
        select: { googleAiApiKey: true },
    });
    if (siteConfig?.googleAiApiKey?.trim()) return siteConfig.googleAiApiKey.trim();

    const envKey = String(process.env.GOOGLE_API_KEY || "").trim();
    return envKey || null;
}
