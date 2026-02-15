/**
 * Semi-Auto Configuration
 * 
 * Controls how the AI predicts and drafts — NEVER sends autonomously.
 * Every outbound message requires human approval.
 */

export interface SemiAutoConfig {
    /** Master toggle — enables auto-drafting on incoming events */
    enabled: boolean;

    /** Predict next steps after each inbound message (e.g. "Schedule viewing", "Send price comparison") */
    predictNextSteps: boolean;

    /** Auto-generate reply drafts for incoming messages */
    draftReplies: boolean;

    /** Auto-generate follow-up drafts when follow-ups are due */
    draftFollowUps: boolean;

    /** Auto-generate listing alert drafts for matching contacts */
    draftListingAlerts: boolean;

    /** Maximum drafts per day per conversation — circuit breaker */
    maxDraftsPerDay: number;

    /** Minimum minutes between drafts for the same conversation */
    cooldownMinutes: number;
}

export const DEFAULT_SEMI_AUTO_CONFIG: SemiAutoConfig = {
    enabled: true,
    predictNextSteps: true,
    draftReplies: true,
    draftFollowUps: true,
    draftListingAlerts: true,
    maxDraftsPerDay: 50,
    cooldownMinutes: 2,
};

/**
 * Parse a SemiAutoConfig from the JSON stored in Conversation.
 * Falls back to defaults for any missing fields.
 */
export function parseSemiAutoConfig(json: unknown): SemiAutoConfig {
    if (!json || typeof json !== "object") return { ...DEFAULT_SEMI_AUTO_CONFIG };

    const raw = json as Record<string, unknown>;

    return {
        enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SEMI_AUTO_CONFIG.enabled,
        predictNextSteps: typeof raw.predictNextSteps === "boolean" ? raw.predictNextSteps : DEFAULT_SEMI_AUTO_CONFIG.predictNextSteps,
        draftReplies: typeof raw.draftReplies === "boolean" ? raw.draftReplies : DEFAULT_SEMI_AUTO_CONFIG.draftReplies,
        draftFollowUps: typeof raw.draftFollowUps === "boolean" ? raw.draftFollowUps : DEFAULT_SEMI_AUTO_CONFIG.draftFollowUps,
        draftListingAlerts: typeof raw.draftListingAlerts === "boolean" ? raw.draftListingAlerts : DEFAULT_SEMI_AUTO_CONFIG.draftListingAlerts,
        maxDraftsPerDay: typeof raw.maxDraftsPerDay === "number" ? raw.maxDraftsPerDay : DEFAULT_SEMI_AUTO_CONFIG.maxDraftsPerDay,
        cooldownMinutes: typeof raw.cooldownMinutes === "number" ? raw.cooldownMinutes : DEFAULT_SEMI_AUTO_CONFIG.cooldownMinutes,
    };
}
