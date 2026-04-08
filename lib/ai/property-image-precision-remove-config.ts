import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";

export type PrecisionRemoveConfig = {
    projectId: string;
    location: string;
};

export type PrecisionRemoveLocationSettings = {
    precisionRemoveEnabled: boolean;
};

export function getPrecisionRemoveInfrastructureConfig(): PrecisionRemoveConfig | null {
    const projectId = String(process.env.GOOGLE_CLOUD_PROJECT_ID || "").trim();
    const location = String(process.env.GOOGLE_CLOUD_LOCATION || "").trim();
    const credentialsPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();

    if (!projectId || !location || !credentialsPath) {
        return null;
    }

    return { projectId, location };
}

export function isPrecisionRemoveInfrastructureReady(): boolean {
    return getPrecisionRemoveInfrastructureConfig() !== null;
}

export async function getPrecisionRemoveLocationSettings(
    locationId?: string
): Promise<PrecisionRemoveLocationSettings> {
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) {
        return { precisionRemoveEnabled: false };
    }

    try {
        const aiDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: normalizedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        });

        return {
            precisionRemoveEnabled: aiDoc?.payload?.precisionRemoveEnabled === true,
        };
    } catch (error) {
        console.warn("[getPrecisionRemoveLocationSettings] Failed to read location AI settings:", error);
        return { precisionRemoveEnabled: false };
    }
}

export async function isPrecisionRemoveEnabledForLocation(locationId?: string): Promise<boolean> {
    const settings = await getPrecisionRemoveLocationSettings(locationId);
    return settings.precisionRemoveEnabled;
}

export async function assertPrecisionRemoveEnabledForLocation(locationId: string): Promise<void> {
    const normalizedLocationId = String(locationId || "").trim();

    const settings = await getPrecisionRemoveLocationSettings(normalizedLocationId);
    if (!settings.precisionRemoveEnabled) {
        throw new Error("Precision Remove is disabled in AI settings for this location.");
    }
}
