import {
    VIEWING_SESSION_ASSIGNMENT_STATUSES,
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_QUICK_START_SOURCES,
    VIEWING_SESSION_SAVE_POLICIES,
    VIEWING_SESSION_SPEECH_MODES,
    type ViewingSessionAssignmentStatus,
    type ViewingSessionKind,
    type ViewingSessionParticipantMode,
    type ViewingSessionQuickStartSource,
    type ViewingSessionSavePolicy,
    type ViewingSessionSpeechMode,
} from "@/lib/viewings/sessions/types";

function asString(value: unknown): string {
    return String(value || "").trim();
}

export function normalizeViewingSessionKind(value: unknown): ViewingSessionKind {
    switch (asString(value)) {
        case VIEWING_SESSION_KINDS.quickTranslate:
            return VIEWING_SESSION_KINDS.quickTranslate;
        case VIEWING_SESSION_KINDS.listenOnly:
            return VIEWING_SESSION_KINDS.listenOnly;
        case VIEWING_SESSION_KINDS.twoWayInterpreter:
            return VIEWING_SESSION_KINDS.twoWayInterpreter;
        default:
            return VIEWING_SESSION_KINDS.structuredViewing;
    }
}

export function normalizeViewingSessionParticipantMode(value: unknown): ViewingSessionParticipantMode {
    if (asString(value) === VIEWING_SESSION_PARTICIPANT_MODES.agentOnly) {
        return VIEWING_SESSION_PARTICIPANT_MODES.agentOnly;
    }
    return VIEWING_SESSION_PARTICIPANT_MODES.sharedClient;
}

export function normalizeViewingSessionSpeechMode(value: unknown): ViewingSessionSpeechMode {
    switch (asString(value)) {
        case VIEWING_SESSION_SPEECH_MODES.continuous:
            return VIEWING_SESSION_SPEECH_MODES.continuous;
        case VIEWING_SESSION_SPEECH_MODES.listenOnly:
            return VIEWING_SESSION_SPEECH_MODES.listenOnly;
        default:
            return VIEWING_SESSION_SPEECH_MODES.pushToTalk;
    }
}

export function normalizeViewingSessionSavePolicy(value: unknown): ViewingSessionSavePolicy {
    switch (asString(value)) {
        case VIEWING_SESSION_SAVE_POLICIES.discardOnClose:
            return VIEWING_SESSION_SAVE_POLICIES.discardOnClose;
        case VIEWING_SESSION_SAVE_POLICIES.saveSummaryOnly:
            return VIEWING_SESSION_SAVE_POLICIES.saveSummaryOnly;
        case VIEWING_SESSION_SAVE_POLICIES.fullSession:
            return VIEWING_SESSION_SAVE_POLICIES.fullSession;
        default:
            return VIEWING_SESSION_SAVE_POLICIES.saveTranscript;
    }
}

export function normalizeViewingSessionQuickStartSource(value: unknown): ViewingSessionQuickStartSource {
    switch (asString(value)) {
        case VIEWING_SESSION_QUICK_START_SOURCES.property:
            return VIEWING_SESSION_QUICK_START_SOURCES.property;
        case VIEWING_SESSION_QUICK_START_SOURCES.contact:
            return VIEWING_SESSION_QUICK_START_SOURCES.contact;
        case VIEWING_SESSION_QUICK_START_SOURCES.viewing:
            return VIEWING_SESSION_QUICK_START_SOURCES.viewing;
        default:
            return VIEWING_SESSION_QUICK_START_SOURCES.global;
    }
}

export function normalizeViewingSessionAssignmentStatus(value: unknown): ViewingSessionAssignmentStatus {
    if (asString(value) === VIEWING_SESSION_ASSIGNMENT_STATUSES.unassigned) {
        return VIEWING_SESSION_ASSIGNMENT_STATUSES.unassigned;
    }
    return VIEWING_SESSION_ASSIGNMENT_STATUSES.assigned;
}

export function shouldRequireViewingSessionJoinCredentials(participantMode: unknown): boolean {
    return normalizeViewingSessionParticipantMode(participantMode) === VIEWING_SESSION_PARTICIPANT_MODES.sharedClient;
}

export function getDefaultViewingSessionSavePolicy(input: {
    sessionKind?: unknown;
    participantMode?: unknown;
}): ViewingSessionSavePolicy {
    const participantMode = normalizeViewingSessionParticipantMode(input.participantMode);
    const sessionKind = normalizeViewingSessionKind(input.sessionKind);

    if (participantMode === VIEWING_SESSION_PARTICIPANT_MODES.agentOnly && sessionKind !== VIEWING_SESSION_KINDS.structuredViewing) {
        return VIEWING_SESSION_SAVE_POLICIES.saveTranscript;
    }
    return VIEWING_SESSION_SAVE_POLICIES.fullSession;
}

export function getDefaultViewingSessionConsentStatus(participantMode: unknown): "required" | "not_required" {
    return shouldRequireViewingSessionJoinCredentials(participantMode) ? "required" : "not_required";
}

export function isQuickViewingSessionKind(sessionKind: unknown): boolean {
    return normalizeViewingSessionKind(sessionKind) !== VIEWING_SESSION_KINDS.structuredViewing;
}
