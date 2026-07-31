export type AiUsageSummaryScope = {
    locationId: string;
    userId?: string;
};

export type AiUsageViewScope = "user" | "location";

export function canAccessAiUsageView(
    scope: AiUsageViewScope,
    isLocationAdmin: boolean,
): boolean {
    return scope === "user" || isLocationAdmin;
}

export function buildAiUsageSummaryScope(
    locationId: string,
    userId?: string,
): AiUsageSummaryScope {
    return {
        locationId,
        ...(userId ? { userId } : {}),
    };
}
