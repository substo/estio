import { normalizeViewingSessionKind } from "@/lib/viewings/sessions/session-config";
import { VIEWING_SESSION_KINDS, type ViewingSessionKind } from "@/lib/viewings/sessions/types";

export type ViewingSessionPipelinePolicy = {
    sessionKind: ViewingSessionKind;
    autoTranslation: boolean;
    autoInsights: boolean;
    autoSummary: boolean;
    allowTools: boolean;
    allowSpeechBack: boolean;
};

export function resolveViewingSessionPipelinePolicy(input: {
    sessionKind?: unknown;
}): ViewingSessionPipelinePolicy {
    const sessionKind = normalizeViewingSessionKind(input.sessionKind);

    switch (sessionKind) {
        case VIEWING_SESSION_KINDS.quickTranslate:
            return {
                sessionKind,
                autoTranslation: true,
                autoInsights: false,
                autoSummary: false,
                allowTools: false,
                allowSpeechBack: false,
            };
        case VIEWING_SESSION_KINDS.listenOnly:
            return {
                sessionKind,
                autoTranslation: true,
                autoInsights: false,
                autoSummary: false,
                allowTools: false,
                allowSpeechBack: false,
            };
        case VIEWING_SESSION_KINDS.twoWayInterpreter:
            return {
                sessionKind,
                autoTranslation: true,
                autoInsights: false,
                autoSummary: false,
                allowTools: false,
                allowSpeechBack: true,
            };
        default:
            return {
                sessionKind: VIEWING_SESSION_KINDS.structuredViewing,
                autoTranslation: true,
                autoInsights: true,
                autoSummary: true,
                allowTools: true,
                allowSpeechBack: true,
            };
    }
}
