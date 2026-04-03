import assert from "node:assert/strict";
import test from "node:test";
import { resolveViewingSessionPipelinePolicy } from "@/lib/viewings/sessions/pipeline-policy";
import { VIEWING_SESSION_KINDS } from "@/lib/viewings/sessions/types";

test("structured viewing keeps the full copilot pipeline enabled", () => {
    assert.deepEqual(
        resolveViewingSessionPipelinePolicy({ sessionKind: VIEWING_SESSION_KINDS.structuredViewing }),
        {
            sessionKind: VIEWING_SESSION_KINDS.structuredViewing,
            autoTranslation: true,
            autoInsights: true,
            autoSummary: true,
            allowTools: true,
            allowSpeechBack: true,
        }
    );
});

test("quick translate fast-path disables insights, summary, and automatic tools", () => {
    assert.deepEqual(
        resolveViewingSessionPipelinePolicy({ sessionKind: VIEWING_SESSION_KINDS.quickTranslate }),
        {
            sessionKind: VIEWING_SESSION_KINDS.quickTranslate,
            autoTranslation: true,
            autoInsights: false,
            autoSummary: false,
            allowTools: false,
            allowSpeechBack: false,
        }
    );
});

test("listen-only and two-way interpreter keep translation fast-path behavior distinct", () => {
    assert.deepEqual(
        resolveViewingSessionPipelinePolicy({ sessionKind: VIEWING_SESSION_KINDS.listenOnly }),
        {
            sessionKind: VIEWING_SESSION_KINDS.listenOnly,
            autoTranslation: true,
            autoInsights: false,
            autoSummary: false,
            allowTools: false,
            allowSpeechBack: false,
        }
    );
    assert.deepEqual(
        resolveViewingSessionPipelinePolicy({ sessionKind: VIEWING_SESSION_KINDS.twoWayInterpreter }),
        {
            sessionKind: VIEWING_SESSION_KINDS.twoWayInterpreter,
            autoTranslation: true,
            autoInsights: false,
            autoSummary: false,
            allowTools: false,
            allowSpeechBack: true,
        }
    );
});
