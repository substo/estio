import assert from "node:assert/strict";
import test from "node:test";
import {
    createSupersededMessageIdSet,
    selectEffectiveViewingTranscriptMessageForUtterance,
    selectEffectiveViewingTranscriptMessages,
    selectViewingTranscriptRevisionHistory,
    selectViewingTranscriptUtteranceMessages,
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

test("utterance lineage groups corrections under the same utterance id", () => {
    const messages = [
        { id: "root", utteranceId: "u1", timestamp: "2026-04-02T10:00:00.000Z", supersedesMessageId: null },
        { id: "rev1", utteranceId: "u1", timestamp: "2026-04-02T10:00:02.000Z", supersedesMessageId: "root" },
        { id: "other", utteranceId: "u2", timestamp: "2026-04-02T10:00:03.000Z", supersedesMessageId: null },
        { id: "rev2", utteranceId: "u1", timestamp: "2026-04-02T10:00:05.000Z", supersedesMessageId: "rev1" },
    ];

    const lineage = selectViewingTranscriptUtteranceMessages(messages, "u1");
    assert.deepEqual(lineage.map((item) => item.id), ["root", "rev1", "rev2"]);
});

test("effective utterance selection returns the terminal non-superseded revision", () => {
    const messages = [
        { id: "root", utteranceId: "u1", timestamp: "2026-04-02T10:00:00.000Z", supersedesMessageId: null },
        { id: "rev1", utteranceId: "u1", timestamp: "2026-04-02T10:00:02.000Z", supersedesMessageId: "root" },
        { id: "rev2", utteranceId: "u1", timestamp: "2026-04-02T10:00:05.000Z", supersedesMessageId: "rev1" },
        { id: "other", utteranceId: "u2", timestamp: "2026-04-02T10:00:03.000Z", supersedesMessageId: null },
    ];

    const effective = selectEffectiveViewingTranscriptMessageForUtterance(messages, "u1");
    assert.equal(effective?.id, "rev2");
});
