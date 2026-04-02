import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionViewingSessionTransportStatus } from "@/lib/viewings/sessions/runtime";
import { VIEWING_SESSION_TRANSPORT_STATUSES } from "@/lib/viewings/sessions/types";

test("transport state machine allows required transitions", () => {
    const S = VIEWING_SESSION_TRANSPORT_STATUSES;

    assert.equal(canTransitionViewingSessionTransportStatus(S.disconnected, S.connecting), true);

    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.connected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.degraded), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.disconnected), true);

    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.reconnecting), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.degraded), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.disconnected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.chained), true);

    assert.equal(canTransitionViewingSessionTransportStatus(S.reconnecting, S.connected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.reconnecting, S.degraded), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.reconnecting, S.disconnected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.reconnecting, S.chained), true);

    assert.equal(canTransitionViewingSessionTransportStatus(S.degraded, S.reconnecting), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.degraded, S.connected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.degraded, S.disconnected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.degraded, S.chained), true);
});

test("transport state machine rejects illegal transitions", () => {
    const S = VIEWING_SESSION_TRANSPORT_STATUSES;

    assert.equal(canTransitionViewingSessionTransportStatus(S.disconnected, S.connected), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.disconnected, S.reconnecting), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.reconnecting), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.chained), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.connecting), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.chained, S.connected), false);
});

test("transport state machine supports idempotent updates and explicit failover", () => {
    const S = VIEWING_SESSION_TRANSPORT_STATUSES;

    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.connected), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.disconnected, S.failed), false);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connecting, S.failed), true);
    assert.equal(canTransitionViewingSessionTransportStatus(S.connected, S.failed), true);
});
