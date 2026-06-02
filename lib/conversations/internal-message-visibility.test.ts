import test from "node:test";
import assert from "node:assert/strict";
import {
    AI_PROPERTY_EVIDENCE_MESSAGE_SOURCE,
    buildVisibleMessageSourceWhere,
    getInternalTimelineMessageSources,
} from "./internal-message-visibility";

test("internal timeline message sources include AI property evidence", () => {
    assert.deepEqual(getInternalTimelineMessageSources(), [AI_PROPERTY_EVIDENCE_MESSAGE_SOURCE]);
});

test("buildVisibleMessageSourceWhere keeps null sources and excludes internal sources", () => {
    assert.deepEqual(buildVisibleMessageSourceWhere(), {
        OR: [
            { source: null },
            { source: { notIn: [AI_PROPERTY_EVIDENCE_MESSAGE_SOURCE] } },
        ],
    });
});
