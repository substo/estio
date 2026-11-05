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

    // Keys live only in the encrypted Location secret; the plaintext SiteConfig column is retired.
    return null;
}

/** Deliberately named Estio-wide fallback; location resolution never reads it. */
export function resolveEstioGlobalGoogleAiApiKey(): string | null {
    return String(process.env.GOOGLE_API_KEY || "").trim() || null;
}

/** Maintenance scripts only: the first Location that has an encrypted Gemini key, and that key. */
export async function findAnyLocationGoogleAiApiKey(): Promise<{ locationId: string; apiKey: string } | null> {
    const { default: db } = await import("@/lib/db");
    const rows = await db.settingsSecret.findMany({
        where: { scopeType: "LOCATION", domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY },
        select: { scopeId: true }, distinct: ["scopeId"], take: 20,
    });
    for (const row of rows) {
        const apiKey = await resolveLocationGoogleAiApiKey(row.scopeId);
        if (apiKey) return { locationId: row.scopeId, apiKey };
    }
    return null;
}

