import assert from "node:assert/strict";
import test from "node:test";
import {
    createSupersededMessageIdSet,
    selectEffectiveViewingTranscriptMessages,
    selectViewingTranscriptRevisionHistory,
} from "@/lib/viewings/sessions/transcript";

test("effective transcript hides superseded rows by default", () => {
    const messages = [
        { id: "m1", timestamp: "2026-04-02T10:00:00.000Z", supersedesMessageId: null },
        { id: "m2", timestamp: "2026-04-02T10:00:01.000Z", supersedesMessageId: "m1" },
        { id: "m3", timestamp: "2026-04-02T10:00:02.000Z", supersedesMessageId: null },
    ];

    const superseded = createSupersededMessageIdSet(messages);
    assert.deepEqual(Array.from(superseded).sort(), ["m1"]);

    const effective = selectEffectiveViewingTranscriptMessages(messages);
    assert.deepEqual(effective.map((item) => item.id), ["m2", "m3"]);
});

test("revision history returns the full correction chain", () => {
    const messages = [
        { id: "root", timestamp: "2026-04-02T10:00:00.000Z", supersedesMessageId: null },
        { id: "rev1", timestamp: "2026-04-02T10:00:02.000Z", supersedesMessageId: "root" },
        { id: "rev2", timestamp: "2026-04-02T10:00:05.000Z", supersedesMessageId: "rev1" },
        { id: "other", timestamp: "2026-04-02T10:00:03.000Z", supersedesMessageId: null },
    ];

    const history = selectViewingTranscriptRevisionHistory(messages, "root");
    assert.deepEqual(history.map((item) => item.id), ["rev1", "rev2"]);
});
