import test from "node:test";
import assert from "node:assert/strict";
import {
    isPendingOutboundMessage,
    matchesByCorrelation,
    mergeSnapshotWithPendingMessages,
} from "./outbound-reconciliation.ts";

test("merge keeps pending optimistic message when snapshot is stale", () => {
    const pending = [{
        id: "opt-1",
        clientMessageId: "cmid_1",
        direction: "outbound",
        status: "sending",
        sendState: "queued",
        dateAdded: "2026-03-24T10:00:00.000Z",
        body: "Hello",
    }];

    const merged = mergeSnapshotWithPendingMessages([], pending);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].clientMessageId, "cmid_1");
    assert.equal(merged[0].status, "sending");
});

test("merge reconciles pending with snapshot via clientMessageId without duplicates", () => {
    const snapshot = [{
        id: "msg_real_1",
        clientMessageId: "cmid_2",
        wamId: "wam_2",
        direction: "outbound",
        status: "sent",
        dateAdded: "2026-03-24T10:00:01.000Z",
        body: "Hello",
    }];

    const pending = [{
        id: "opt-2",
        clientMessageId: "cmid_2",
        direction: "outbound",
        status: "sending",
        sendState: "queued",
        dateAdded: "2026-03-24T10:00:00.000Z",
        body: "Hello",
    }];

    const merged = mergeSnapshotWithPendingMessages(snapshot, pending);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].id, "msg_real_1");
    assert.equal(merged[0].clientMessageId, "cmid_2");
    assert.equal(merged[0].status, "sent");
});

test("status patch correlation works with wamId and message id", () => {
    const message = {
        id: "msg_real_3",
        clientMessageId: "cmid_3",
        wamId: "wam_3",
    };

    assert.equal(matchesByCorrelation(message, { wamId: "wam_3" }), true);
    assert.equal(matchesByCorrelation(message, { messageId: "msg_real_3" }), true);
    assert.equal(matchesByCorrelation(message, { clientMessageId: "cmid_3" }), true);
    assert.equal(matchesByCorrelation(message, { messageId: "other" }), false);
});

test("pending detector respects outbox/send state", () => {
    assert.equal(isPendingOutboundMessage({ direction: "outbound", status: "sending" }), true);
    assert.equal(isPendingOutboundMessage({ direction: "outbound", status: "sent", outboxState: { status: "pending" } }), true);
    assert.equal(isPendingOutboundMessage({ direction: "outbound", status: "sent", sendState: "queued" }), true);
    assert.equal(isPendingOutboundMessage({ direction: "outbound", status: "failed" }), false);
    assert.equal(isPendingOutboundMessage({ direction: "inbound", status: "sending" }), false);
});
