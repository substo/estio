import assert from "node:assert/strict";
import test from "node:test";
import {
    didDeviceTunnelGatewayGenerationChange,
    isWhatsAppWebBridgeActiveProbeFresh,
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
