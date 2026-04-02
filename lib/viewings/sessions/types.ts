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
    transportStatusChanged: "viewing_session.transport.status.changed",
    usageUpdated: "viewing_session.usage.updated",
} as const;

export type ViewingSessionEventType = typeof VIEWING_SESSION_EVENT_TYPES[keyof typeof VIEWING_SESSION_EVENT_TYPES];

export const VIEWING_SESSION_ANALYSIS_STATUSES = {
    pending: "pending",
    processing: "processing",
    completed: "completed",
    failed: "failed",
} as const;

export type ViewingSessionAnalysisStatus = typeof VIEWING_SESSION_ANALYSIS_STATUSES[keyof typeof VIEWING_SESSION_ANALYSIS_STATUSES];

export const VIEWING_SESSION_TRANSLATION_STATUSES = {
    pending: "pending",
    processing: "processing",
    completed: "completed",
    failed: "failed",
    skipped: "skipped",
} as const;

export type ViewingSessionTranslationStatus = typeof VIEWING_SESSION_TRANSLATION_STATUSES[keyof typeof VIEWING_SESSION_TRANSLATION_STATUSES];

export const VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES = {
    pending: "pending",
    processing: "processing",
    completed: "completed",
    failed: "failed",
    skipped: "skipped",
} as const;

export type ViewingSessionInsightPipelineStatus =
    typeof VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES[keyof typeof VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES];

export const VIEWING_SESSION_MESSAGE_ORIGINS = {
    manualText: "manual_text",
    browserStt: "browser_stt",
    relayLiveTranscript: "relay_live_transcript",
    relayToolResult: "relay_tool_result",
    human: "human",
    system: "system",
} as const;

export type ViewingSessionMessageOrigin = typeof VIEWING_SESSION_MESSAGE_ORIGINS[keyof typeof VIEWING_SESSION_MESSAGE_ORIGINS];

export const VIEWING_SESSION_TRANSCRIPT_STATUSES = {
    provisional: "provisional",
    final: "final",
} as const;

export type ViewingSessionTranscriptStatus =
    typeof VIEWING_SESSION_TRANSCRIPT_STATUSES[keyof typeof VIEWING_SESSION_TRANSCRIPT_STATUSES];

export const VIEWING_SESSION_INSIGHT_SOURCES = {
    analysisModel: "analysis_model",
    staticLibrary: "static_library",
    heuristicFallback: "heuristic_fallback",
    manual: "manual",
} as const;

export type ViewingSessionInsightSource = typeof VIEWING_SESSION_INSIGHT_SOURCES[keyof typeof VIEWING_SESSION_INSIGHT_SOURCES];

export const VIEWING_SESSION_SUMMARY_SOURCES = {
    analysisModel: "analysis_model",
    heuristicFallback: "heuristic_fallback",
    manual: "manual",
} as const;

export type ViewingSessionSummarySource = typeof VIEWING_SESSION_SUMMARY_SOURCES[keyof typeof VIEWING_SESSION_SUMMARY_SOURCES];

export const VIEWING_SESSION_TRANSPORT_STATUSES = {
    connecting: "connecting",
    connected: "connected",
    degraded: "degraded",
    reconnecting: "reconnecting",
    disconnected: "disconnected",
    chained: "chained",
    failed: "failed",
} as const;

export type ViewingSessionTransportStatus = typeof VIEWING_SESSION_TRANSPORT_STATUSES[keyof typeof VIEWING_SESSION_TRANSPORT_STATUSES];

export const VIEWING_SESSION_MESSAGE_KINDS = {
    utterance: "utterance",
    systemNote: "system_note",
    toolResult: "tool_result",
} as const;

export type ViewingSessionMessageKind = typeof VIEWING_SESSION_MESSAGE_KINDS[keyof typeof VIEWING_SESSION_MESSAGE_KINDS];

export const VIEWING_SESSION_SUMMARY_STATUSES = {
    draft: "draft",
    generating: "generating",
    final: "final",
    failed: "failed",
} as const;

export type ViewingSessionSummaryStatus = typeof VIEWING_SESSION_SUMMARY_STATUSES[keyof typeof VIEWING_SESSION_SUMMARY_STATUSES];

export const DEFAULT_VIEWING_SESSION_PIN_LENGTH = 6;
export const DEFAULT_VIEWING_SESSION_TOKEN_TTL_HOURS = 24;
export const DEFAULT_VIEWING_SESSION_ACCESS_TOKEN_TTL_SECONDS = 60 * 60 * 4;

export function deriveViewingSessionAnalysisStatus(input: {
    translationStatus: ViewingSessionTranslationStatus;
    insightStatus: ViewingSessionInsightPipelineStatus;
}): ViewingSessionAnalysisStatus {
    const translationStatus = input.translationStatus;
    const insightStatus = input.insightStatus;

    if (translationStatus === VIEWING_SESSION_TRANSLATION_STATUSES.failed || insightStatus === VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.failed) {
        return VIEWING_SESSION_ANALYSIS_STATUSES.failed;
    }
    if (
        (translationStatus === VIEWING_SESSION_TRANSLATION_STATUSES.completed || translationStatus === VIEWING_SESSION_TRANSLATION_STATUSES.skipped) &&
        (insightStatus === VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed || insightStatus === VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.skipped)
    ) {
        return VIEWING_SESSION_ANALYSIS_STATUSES.completed;
    }
    if (
        translationStatus === VIEWING_SESSION_TRANSLATION_STATUSES.processing ||
        insightStatus === VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.processing
    ) {
        return VIEWING_SESSION_ANALYSIS_STATUSES.processing;
    }
    return VIEWING_SESSION_ANALYSIS_STATUSES.pending;
}
