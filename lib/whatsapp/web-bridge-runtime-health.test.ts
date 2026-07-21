import assert from "node:assert/strict";
import test from "node:test";
import {
    didDeviceTunnelGatewayGenerationChange,
    isWhatsAppWebBridgeActiveProbeFresh,
    isWhatsAppWebBridgeCheckpointEligible,
} from "./web-bridge-runtime-health";

test("active readiness requires a recent successful browser and webhook probe", () => {
    const nowMs = Date.parse("2026-07-20T12:00:00.000Z");
    assert.equal(isWhatsAppWebBridgeActiveProbeFresh({
        healthy: true,
        lastSuccessAt: "2026-07-20T11:59:30.000Z",
        nowMs,
        maxAgeMs: 60_000,
    }), true);
    assert.equal(isWhatsAppWebBridgeActiveProbeFresh({
        healthy: true,
        lastSuccessAt: "2026-07-20T11:58:00.000Z",
        nowMs,
        maxAgeMs: 60_000,
    }), false);
    assert.equal(isWhatsAppWebBridgeActiveProbeFresh({
        healthy: false,
        lastSuccessAt: "2026-07-20T11:59:30.000Z",
        nowMs,
        maxAgeMs: 60_000,
    }), false);
});

test("device-tunnel sessions rebind after a gateway process generation change", () => {
    assert.equal(didDeviceTunnelGatewayGenerationChange({
        deviceTunnelBindingId: "binding-1",
        sessionGeneration: "gateway-start-1",
        gatewayGeneration: "gateway-start-1",
    }), false);
    assert.equal(didDeviceTunnelGatewayGenerationChange({
        deviceTunnelBindingId: "binding-1",
        sessionGeneration: "gateway-start-1",
        gatewayGeneration: "gateway-start-2",
    }), true);
    assert.equal(didDeviceTunnelGatewayGenerationChange({
        deviceTunnelBindingId: "binding-1",
        sessionGeneration: null,
        gatewayGeneration: "gateway-start-2",
    }), true);
    assert.equal(didDeviceTunnelGatewayGenerationChange({
        deviceTunnelBindingId: null,
        sessionGeneration: null,
        gatewayGeneration: null,
    }), false);
});

test("durable checkpoints require ready, authoritative, recently probed browsers", () => {
    const nowMs = Date.parse("2026-07-21T17:30:00.000Z");
    const healthy = {
        ready: true,
        runtimeLeaseEnforced: true,
        ownershipValid: true,
        activeProbeHealthy: true,
        lastActiveProbeSuccessAt: new Date(nowMs - 1_000),
        nowMs,
        maxAgeMs: 60_000,
    };
    assert.equal(isWhatsAppWebBridgeCheckpointEligible(healthy), true);
    assert.equal(isWhatsAppWebBridgeCheckpointEligible({ ...healthy, ready: false }), false);
    assert.equal(isWhatsAppWebBridgeCheckpointEligible({ ...healthy, ownershipValid: false }), false);
    assert.equal(isWhatsAppWebBridgeCheckpointEligible({
        ...healthy,
        lastActiveProbeSuccessAt: new Date(nowMs - 60_001),
    }), false);
});
