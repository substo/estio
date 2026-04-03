import assert from "node:assert/strict";
import test from "node:test";
import {
    getDefaultViewingSessionConsentStatus,
    getDefaultViewingSessionSavePolicy,
    isQuickViewingSessionKind,
    shouldRequireViewingSessionJoinCredentials,
} from "@/lib/viewings/sessions/session-config";
import {
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_SAVE_POLICIES,
} from "@/lib/viewings/sessions/types";

test("agent-only quick sessions default to transcript retention without client join", () => {
    assert.equal(
        shouldRequireViewingSessionJoinCredentials(VIEWING_SESSION_PARTICIPANT_MODES.agentOnly),
        false
    );
    assert.equal(
        getDefaultViewingSessionConsentStatus(VIEWING_SESSION_PARTICIPANT_MODES.agentOnly),
        "not_required"
    );
    assert.equal(
        getDefaultViewingSessionSavePolicy({
            sessionKind: VIEWING_SESSION_KINDS.quickTranslate,
            participantMode: VIEWING_SESSION_PARTICIPANT_MODES.agentOnly,
        }),
        VIEWING_SESSION_SAVE_POLICIES.saveTranscript
    );
});

test("shared structured sessions keep full retention and shared-client requirements", () => {
    assert.equal(
        shouldRequireViewingSessionJoinCredentials(VIEWING_SESSION_PARTICIPANT_MODES.sharedClient),
        true
    );
    assert.equal(
        getDefaultViewingSessionConsentStatus(VIEWING_SESSION_PARTICIPANT_MODES.sharedClient),
        "required"
    );
    assert.equal(
        getDefaultViewingSessionSavePolicy({
            sessionKind: VIEWING_SESSION_KINDS.structuredViewing,
            participantMode: VIEWING_SESSION_PARTICIPANT_MODES.sharedClient,
        }),
        VIEWING_SESSION_SAVE_POLICIES.fullSession
    );
    assert.equal(isQuickViewingSessionKind(VIEWING_SESSION_KINDS.structuredViewing), false);
    assert.equal(isQuickViewingSessionKind(VIEWING_SESSION_KINDS.listenOnly), true);
});
