import test from "node:test";
import assert from "node:assert/strict";

import {
    resolveWhatsAppDispatchAckTimeoutState,
    resolveWhatsAppOutboundCompletionState,
} from "./outbound-outbox";

test("web bridge completion without provider id is delivery-unconfirmed and terminal", () => {
    const state = resolveWhatsAppOutboundCompletionState({
        transport: "web_bridge",
        wamId: null,
    });

    assert.equal(state.awaitsProviderAck, false);
    assert.equal(state.deliveryUnconfirmed, true);
    assert.equal(state.messageStatus, "delivery_unconfirmed");
    assert.equal(state.outboxStatus, "delivery_unconfirmed");
    assert.ok(state.processedAt instanceof Date);
    assert.match(String(state.lastError), /not retrying/i);
});

test("web bridge completion with provider id waits for provider ack", () => {
    const state = resolveWhatsAppOutboundCompletionState({
        transport: "web_bridge",
        wamId: "3EB_TEST",
    });

    assert.equal(state.awaitsProviderAck, true);
    assert.equal(state.deliveryUnconfirmed, false);
    assert.equal(state.messageStatus, "dispatch_accepted");
    assert.equal(state.outboxStatus, "dispatch_accepted");
    assert.equal(state.processedAt, null);
    assert.equal(state.lastError, null);
});

test("non-web bridge completion remains sent only when provider id is present", () => {
    const state = resolveWhatsAppOutboundCompletionState({
        transport: "cloud_api",
        wamId: "wamid.TEST",
    });

    assert.equal(state.awaitsProviderAck, false);
    assert.equal(state.deliveryUnconfirmed, false);
    assert.equal(state.messageStatus, "sent");
    assert.equal(state.outboxStatus, "completed");
    assert.ok(state.processedAt instanceof Date);
    assert.equal(state.lastError, null);
});

test("ack timeout completes the outbox when the message is already provider-confirmed", () => {
    for (const status of ["sent", "delivered", "read"]) {
        assert.deepEqual(resolveWhatsAppDispatchAckTimeoutState(status), {
            outboxStatus: "completed",
            shouldMarkMessageUnconfirmed: false,
        });
    }
});

test("ack timeout only downgrades a dispatch-accepted message", () => {
    assert.deepEqual(resolveWhatsAppDispatchAckTimeoutState("dispatch_accepted"), {
        outboxStatus: "delivery_unconfirmed",
        shouldMarkMessageUnconfirmed: true,
    });
    assert.deepEqual(resolveWhatsAppDispatchAckTimeoutState("failed"), {
        outboxStatus: "delivery_unconfirmed",
        shouldMarkMessageUnconfirmed: false,
    });
});
