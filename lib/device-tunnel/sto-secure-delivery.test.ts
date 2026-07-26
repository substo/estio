import assert from "node:assert/strict";
import test from "node:test";
import { buildStoSecureDeliveryStatus } from "./sto-secure-delivery";

const readyInput = {
    configured: true,
    deviceAlias: "Cyprus WhatsApp Device",
    deviceStatus: "online",
    bindingStatus: "online",
    bindingFresh: true,
    workerReady: true,
    workerStatus: "ready",
    runtimeLeaseEnforced: true,
    sessionAuthMode: "encrypted_snapshot",
    authDurableReady: true,
    authState: "attached",
    recoveryStatus: "healthy",
};

test("STO is ready only with a live device, exclusive ownership, and encrypted attached profile", () => {
    const result = buildStoSecureDeliveryStatus(readyInput);
    assert.equal(result.state, "ready");
    assert.equal(result.label, "STO Ready");
    assert.equal(result.protectedSession, true);
});

test("STO reports device offline without weakening the protected-session signal", () => {
    const result = buildStoSecureDeliveryStatus({
        ...readyInput,
        deviceStatus: "offline",
        bindingStatus: "offline",
        bindingFresh: false,
        workerReady: false,
    });
    assert.equal(result.state, "device_offline");
    assert.equal(result.protectedSession, true);
    assert.match(result.detail, /remain queued/i);
});

test("STO reports session restoration before generic route unavailability", () => {
    const result = buildStoSecureDeliveryStatus({
        ...readyInput,
        workerReady: false,
        authDurableReady: false,
        authState: "recovering",
        recoveryStatus: "restoring_previous",
    });
    assert.equal(result.state, "session_restoring");
    assert.equal(result.label, "WhatsApp Session Restoring");
});

test("STO reports the live device outage instead of masking it as session restoration", () => {
    const result = buildStoSecureDeliveryStatus({
        ...readyInput,
        deviceStatus: "online",
        bindingStatus: "online",
        bindingFresh: false,
        workerReady: false,
        authDurableReady: false,
        authState: "recovering",
        recoveryStatus: "restoring_previous",
    });
    assert.equal(result.state, "device_offline");
    assert.equal(result.label, "STO Relay Offline");
    assert.match(result.detail, /phone may still be powered on/i);
});

test("STO never claims ready for a local or unfenced browser profile", () => {
    for (const input of [
        { ...readyInput, runtimeLeaseEnforced: false },
        { ...readyInput, sessionAuthMode: "local" },
        { ...readyInput, authDurableReady: false },
    ]) {
        const result = buildStoSecureDeliveryStatus(input);
        assert.equal(result.state, "unavailable");
        assert.equal(result.protectedSession, false);
    }
});

test("STO requires relinking after the durable profile is fenced", () => {
    const result = buildStoSecureDeliveryStatus({
        ...readyInput,
        workerReady: false,
        authDurableReady: false,
        authState: "relink_required",
        recoveryStatus: "relink_required",
    });
    assert.equal(result.state, "unavailable");
    assert.match(result.detail, /linked again/i);
});
