export const VIEWING_SESSION_MODES = {
    assistantLiveToolHeavy: "assistant_live_tool_heavy",
    assistantLiveVoicePremium: "assistant_live_voice_premium",
} as const;

export type ViewingSessionMode = typeof VIEWING_SESSION_MODES[keyof typeof VIEWING_SESSION_MODES];

export const VIEWING_SESSION_STATUSES = {
    scheduled: "scheduled",
    active: "active",
    paused: "paused",
    completed: "completed",
    expired: "expired",
} as const;

export type ViewingSessionStatus = typeof VIEWING_SESSION_STATUSES[keyof typeof VIEWING_SESSION_STATUSES];

export const VIEWING_SESSION_INSIGHT_TYPES = {
    keyPoint: "key_point",
    objection: "objection",
    buyingSignal: "buying_signal",
    sentiment: "sentiment",
    reply: "reply",
    pivot: "pivot",
} as const;

export type ViewingSessionInsightType = typeof VIEWING_SESSION_INSIGHT_TYPES[keyof typeof VIEWING_SESSION_INSIGHT_TYPES];

export const VIEWING_SESSION_INSIGHT_STATES = {
    active: "active",
    pinned: "pinned",
    dismissed: "dismissed",
    resolved: "resolved",
} as const;

export type ViewingSessionInsightState = typeof VIEWING_SESSION_INSIGHT_STATES[keyof typeof VIEWING_SESSION_INSIGHT_STATES];

export const VIEWING_SESSION_SPEAKERS = {
    client: "client",
    agent: "agent",
    system: "system",
} as const;

export type ViewingSessionSpeaker = typeof VIEWING_SESSION_SPEAKERS[keyof typeof VIEWING_SESSION_SPEAKERS];

export const VIEWING_SESSION_EVENT_TYPES = {
    messageCreated: "viewing_session.message.created",
    messageUpdated: "viewing_session.message.updated",
    insightUpserted: "viewing_session.insight.upserted",
    summaryUpdated: "viewing_session.summary.updated",
    statusChanged: "viewing_session.status.changed",
} as const;

export type ViewingSessionEventType = typeof VIEWING_SESSION_EVENT_TYPES[keyof typeof VIEWING_SESSION_EVENT_TYPES];

export const VIEWING_SESSION_ANALYSIS_STATUSES = {
    pending: "pending",
    processing: "processing",
    completed: "completed",
    failed: "failed",
} as const;

export type ViewingSessionAnalysisStatus = typeof VIEWING_SESSION_ANALYSIS_STATUSES[keyof typeof VIEWING_SESSION_ANALYSIS_STATUSES];

export const DEFAULT_VIEWING_SESSION_PIN_LENGTH = 6;
export const DEFAULT_VIEWING_SESSION_TOKEN_TTL_HOURS = 24;
export const DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 4;
