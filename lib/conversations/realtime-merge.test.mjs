import test from "node:test";
import assert from "node:assert/strict";
import { shouldApplyRealtimeEnvelope } from "./realtime-merge.ts";

test("accepts first event and rejects duplicate by id", () => {
    const state = {
        seenEventIds: new Set(),
        lastTsByConversationId: {},
    };

    const first = shouldApplyRealtimeEnvelope(state, {
        id: "evt_1",
        conversationId: "conv_1",
        ts: "2026-03-09T09:00:00.000Z",
    });
    const duplicate = shouldApplyRealtimeEnvelope(state, {
        id: "evt_1",
        conversationId: "conv_1",
        ts: "2026-03-09T09:00:01.000Z",
    });

    assert.equal(first, true);
    assert.equal(duplicate, false);
    assert.equal(state.lastTsByConversationId.conv_1, new Date("2026-03-09T09:00:00.000Z").getTime());
});

test("rejects older out-of-order timestamps for same conversation", () => {
    const state = {
        seenEventIds: new Set(),
        lastTsByConversationId: {},
    };

    const newest = shouldApplyRealtimeEnvelope(state, {
        id: "evt_new",
        conversationId: "conv_2",
        ts: "2026-03-09T09:05:00.000Z",
    });
    const older = shouldApplyRealtimeEnvelope(state, {
        id: "evt_old",
        conversationId: "conv_2",
        ts: "2026-03-09T09:04:59.000Z",
    });

    assert.equal(newest, true);
    assert.equal(older, false);
});

test("evicts oldest tracked event ids over cap", () => {
    const state = {
        seenEventIds: new Set(),
        lastTsByConversationId: {},
    };

    assert.equal(
        shouldApplyRealtimeEnvelope(state, { id: "evt_1", ts: "2026-03-09T09:00:00.000Z" }, { maxTrackedEventIds: 2 }),
        true
    );
    assert.equal(
        shouldApplyRealtimeEnvelope(state, { id: "evt_2", ts: "2026-03-09T09:00:01.000Z" }, { maxTrackedEventIds: 2 }),
        true
    );
    assert.equal(
        shouldApplyRealtimeEnvelope(state, { id: "evt_3", ts: "2026-03-09T09:00:02.000Z" }, { maxTrackedEventIds: 2 }),
        true
    );

    assert.equal(state.seenEventIds.has("evt_1"), false);
    assert.equal(state.seenEventIds.has("evt_2"), true);
    assert.equal(state.seenEventIds.has("evt_3"), true);
});
