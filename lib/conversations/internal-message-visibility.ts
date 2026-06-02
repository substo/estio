export const AI_PROPERTY_EVIDENCE_MESSAGE_SOURCE = "ai_property_evidence";

const INTERNAL_TIMELINE_MESSAGE_SOURCES = [
    AI_PROPERTY_EVIDENCE_MESSAGE_SOURCE,
] as const;

export function getInternalTimelineMessageSources(): string[] {
    return [...INTERNAL_TIMELINE_MESSAGE_SOURCES];
}

export function buildVisibleMessageSourceWhere() {
    return {
        OR: [
            { source: null },
            { source: { notIn: getInternalTimelineMessageSources() } },
        ],
    };
}
