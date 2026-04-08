type FeatureFlagMode = "on" | "off" | "canary";

export type ConversationFeatureFlags = {
    workspaceV2: boolean;
    balancedPolling: boolean;
    lazySidebarData: boolean;
    workspaceSplit: boolean;
    realtimeSse: boolean;
    shallowUrlSync: boolean;
    conversationTranslationRead: boolean;
    conversationTranslationWrite: boolean;
    conversationTranslationBanner: boolean;
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
    const workspaceSplitMode = parseMode(
        readEnv("CONVERSATIONS_WORKSPACE_SPLIT", "workspace_split", "WORKSPACE_SPLIT"),
        "on"
    );
    const realtimeSseMode = parseMode(
        readEnv("CONVERSATIONS_REALTIME_SSE", "realtime_sse", "REALTIME_SSE"),
        "on"
    );
    const shallowUrlSyncMode = parseMode(
        readEnv("CONVERSATIONS_SHALLOW_URL_SYNC", "shallow_url_sync", "SHALLOW_URL_SYNC"),
        "on"
    );
    const translationReadMode = parseMode(
        readEnv("CONVERSATIONS_TRANSLATION_READ", "conversation_translation_read", "TRANSLATION_READ"),
        "off"
    );
    const translationWriteMode = parseMode(
        readEnv("CONVERSATIONS_TRANSLATION_WRITE", "conversation_translation_write", "TRANSLATION_WRITE"),
        "off"
    );
    const translationBannerMode = parseMode(
        readEnv("CONVERSATIONS_TRANSLATION_BANNER", "conversation_translation_banner", "TRANSLATION_BANNER"),
        "off"
    );

    return {
        workspaceV2: evaluateMode(workspaceMode, isCanaryLocation),
        balancedPolling: evaluateMode(pollingMode, isCanaryLocation),
        lazySidebarData: evaluateMode(lazySidebarMode, isCanaryLocation),
        workspaceSplit: evaluateMode(workspaceSplitMode, isCanaryLocation),
        realtimeSse: evaluateMode(realtimeSseMode, isCanaryLocation),
        shallowUrlSync: evaluateMode(shallowUrlSyncMode, isCanaryLocation),
        conversationTranslationRead: evaluateMode(translationReadMode, isCanaryLocation),
        conversationTranslationWrite: evaluateMode(translationWriteMode, isCanaryLocation),
        conversationTranslationBanner: evaluateMode(translationBannerMode, isCanaryLocation),
        canaryMatch: isCanaryLocation,
    };
}
