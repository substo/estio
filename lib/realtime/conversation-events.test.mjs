import test from "node:test";
import assert from "node:assert/strict";
import { selectConversationRealtimeReplayEvents } from "./conversation-events.ts";

function buildEnvelope(id, ts) {
    return {
        id,
        ts,
        locationId: "loc_1",
        conversationId: "conv_1",
        type: "message.inbound",
        payloadVersion: 1,
        payload: {},
    };
}

test("returns events after the last seen id", () => {
    const events = [
        buildEnvelope("evt_1", "2026-03-09T09:00:00.000Z"),
        buildEnvelope("evt_2", "2026-03-09T09:00:01.000Z"),
        buildEnvelope("evt_3", "2026-03-09T09:00:02.000Z"),
    ];

    const replay = selectConversationRealtimeReplayEvents(events, "evt_1", 10);
    assert.deepEqual(replay.map((item) => item.id), ["evt_2", "evt_3"]);
});

test("returns empty array when last seen id is not present", () => {
    const events = [buildEnvelope("evt_1", "2026-03-09T09:00:00.000Z")];
    const replay = selectConversationRealtimeReplayEvents(events, "evt_missing", 10);
    assert.deepEqual(replay, []);
});

test("limits replay count", () => {
    const events = [
        buildEnvelope("evt_1", "2026-03-09T09:00:00.000Z"),
        buildEnvelope("evt_2", "2026-03-09T09:00:01.000Z"),
        buildEnvelope("evt_3", "2026-03-09T09:00:02.000Z"),
    ];

    const replay = selectConversationRealtimeReplayEvents(events, "evt_1", 1);
    assert.deepEqual(replay.map((item) => item.id), ["evt_2"]);
});
