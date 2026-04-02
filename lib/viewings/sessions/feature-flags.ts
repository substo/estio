type FeatureFlagMode = "on" | "off" | "canary";

export type ViewingSessionFeatureFlags = {
    voicePremiumEnabled: boolean;
    canaryMatch: boolean;
};

function parseMode(value: string | undefined, fallback: FeatureFlagMode): FeatureFlagMode {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "on" || normalized === "off" || normalized === "canary") {
        return normalized;
    }
    return fallback;
}

function parseLocationList(value: string | undefined): Set<string> {
    return new Set(
        String(value || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
    );
}

function evaluateMode(mode: FeatureFlagMode, isCanaryLocation: boolean): boolean {
    if (mode === "on") return true;
    if (mode === "off") return false;
    return isCanaryLocation;
}

function readEnv(...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = process.env[key];
        if (typeof value === "string" && value.trim()) return value;
    }
    return undefined;
}

export function getViewingSessionFeatureFlags(locationId?: string | null): ViewingSessionFeatureFlags {
    const canaryLocations = parseLocationList(
        readEnv(
            "VIEWING_SESSION_CANARY_LOCATIONS",
            "VIEWING_SESSION_CANARY_LOCATION_IDS",
            "viewing_session_canary_locations"
        )
    );
    const isCanaryLocation = !!locationId && canaryLocations.has(String(locationId));
    const premiumMode = parseMode(
        readEnv(
            "VIEWING_SESSION_VOICE_PREMIUM",
            "VIEWING_SESSION_VOICE_PREMIUM_MODE",
            "viewing_session_voice_premium"
        ),
        "off"
    );

    return {
        voicePremiumEnabled: evaluateMode(premiumMode, isCanaryLocation),
        canaryMatch: isCanaryLocation,
    };
}

export function isViewingSessionVoicePremiumEnabled(locationId?: string | null): boolean {
    return getViewingSessionFeatureFlags(locationId).voicePremiumEnabled;
}
