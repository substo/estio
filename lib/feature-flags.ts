type FeatureFlagMode = "on" | "off" | "canary";

export type ConversationFeatureFlags = {
    workspaceV2: boolean;
    balancedPolling: boolean;
    lazySidebarData: boolean;
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

/**
 * Feature flags for enterprise conversations performance rollout.
 *
 * Supported env values per flag: on | off | canary
 * - If set to canary, the flag is enabled only for location IDs listed in CONVERSATIONS_CANARY_LOCATIONS.
 * - Defaults are on to keep the optimized path active unless explicitly disabled.
 */
export function getConversationFeatureFlags(locationId?: string | null): ConversationFeatureFlags {
    const canaryLocations = parseLocationList(
        readEnv("CONVERSATIONS_CANARY_LOCATIONS", "CONVERSATIONS_CANARY_LOCATION_IDS", "conversations_canary_locations")
    );
    const isCanaryLocation = !!locationId && canaryLocations.has(String(locationId));

    const workspaceMode = parseMode(
        readEnv("CONVERSATIONS_WORKSPACE_V2", "workspace_v2", "WORKSPACE_V2"),
        "on"
    );
    const pollingMode = parseMode(
        readEnv("CONVERSATIONS_BALANCED_POLLING", "balanced_polling", "BALANCED_POLLING"),
        "on"
    );
    const lazySidebarMode = parseMode(
        readEnv("CONVERSATIONS_LAZY_SIDEBAR_DATA", "lazy_sidebar_data", "LAZY_SIDEBAR_DATA"),
        "on"
    );

    return {
        workspaceV2: evaluateMode(workspaceMode, isCanaryLocation),
        balancedPolling: evaluateMode(pollingMode, isCanaryLocation),
        lazySidebarData: evaluateMode(lazySidebarMode, isCanaryLocation),
        canaryMatch: isCanaryLocation,
    };
}
