import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
    normalizeStoReconnectGeneration,
    sanitizeStoReconnectErrorCode,
    sanitizeStoRuntimeState,
    shouldAutoRequestStoReconnect,
    shouldRecordStoReconnectAttempt,
} from "./reconnect-control";

test("normalizes reconnect generations without accepting unsafe values", () => {
    assert.equal(normalizeStoReconnectGeneration(4), 4);
    assert.equal(normalizeStoReconnectGeneration("5"), 5);
    assert.equal(normalizeStoReconnectGeneration(-1), 0);
    assert.equal(normalizeStoReconnectGeneration("invalid"), 0);
});

test("records only an acknowledgement for the current reconnect generation", () => {
    assert.equal(shouldRecordStoReconnectAttempt({ requestedGeneration: 3, appliedGeneration: 2 }), false);
    assert.equal(shouldRecordStoReconnectAttempt({ requestedGeneration: 3, appliedGeneration: 3 }), true);
    assert.equal(shouldRecordStoReconnectAttempt({ requestedGeneration: 3, appliedGeneration: 4 }), true);
});

test("only stores privacy-safe diagnostic codes", () => {
    assert.equal(sanitizeStoReconnectErrorCode("gateway_silent"), "GATEWAY_SILENT");
    assert.equal(sanitizeStoReconnectErrorCode("socket failed at 10.0.0.1"), null);
    assert.equal(sanitizeStoRuntimeState("reconnecting"), "reconnecting");
    assert.equal(sanitizeStoRuntimeState("running arbitrary command"), null);
});

test("auto reconnect is bounded to a stale recoverable relay failure", () => {
    const now = new Date("2026-07-29T06:00:00.000Z");
    const base = {
        bindingStatus: "offline",
        bindingLastSeenAt: new Date("2026-07-29T05:58:00.000Z"),
        lastReconnectRequestedAt: null,
        requestedGeneration: 2,
        appliedGeneration: 2,
        runtimeState: "reconnecting",
        diagnosticCode: "TUNNEL_TOKEN_REJECTED",
        now,
    };

    assert.equal(shouldAutoRequestStoReconnect(base), true);
    assert.equal(shouldAutoRequestStoReconnect({
        ...base,
        bindingLastSeenAt: new Date("2026-07-29T05:59:00.000Z"),
    }), false);
    assert.equal(shouldAutoRequestStoReconnect({
        ...base,
        requestedGeneration: 3,
    }), false);
    assert.equal(shouldAutoRequestStoReconnect({
        ...base,
        lastReconnectRequestedAt: new Date("2026-07-29T05:59:00.000Z"),
    }), false);
    assert.equal(shouldAutoRequestStoReconnect({
        ...base,
        diagnosticCode: "NO_ANDROID_NETWORK",
    }), false);
    assert.equal(shouldAutoRequestStoReconnect({
        ...base,
        bindingStatus: "online",
    }), false);
});

test("lean reconnect stays on authenticated heartbeat and an allowlisted admin action", async () => {
    const [heartbeat, route] = await Promise.all([
        readFile(new URL("../../app/api/sms-relay/gateway/heartbeat/route.ts", import.meta.url), "utf8"),
        readFile(new URL("../../app/api/admin/whatsapp-egress/reconnect/route.ts", import.meta.url), "utf8"),
    ]);
    assert.match(heartbeat, /extractDeviceFromAuthHeader/);
    assert.match(heartbeat, /deviceApiTokenHash:\s*tokenHash/);
    assert.match(route, /verifyUserIsLocationAdmin/);
    assert.match(route, /reconnectGeneration:\s*\{\s*increment:\s*1/);
    assert.doesNotMatch(route, /gatewayNodeId|sessionId|deviceId/);
});
