import assert from "node:assert/strict";
import test from "node:test";
import { validateDeviceTunnelGatewayUrl, validateTrustedDeviceTunnelGatewayUrl } from "./gateway-url";

test("accepts canonical WSS node URLs", () => {
    assert.equal(validateDeviceTunnelGatewayUrl("wss://node-a.example.test/device-tunnel/", true), "wss://node-a.example.test/device-tunnel");
});

test("trusted node URLs require the exact endpoint, TLS port, and host suffix", () => {
    assert.equal(validateTrustedDeviceTunnelGatewayUrl({
        value: "wss://node-a.egress.example.test/device-tunnel",
        trustedHostSuffixes: ["egress.example.test"],
    }), "wss://node-a.egress.example.test/device-tunnel");
    for (const value of [
        "wss://node-a.evil.test/device-tunnel",
        "wss://127.0.0.1/device-tunnel",
        "wss://node-a.egress.example.test:8443/device-tunnel",
        "wss://node-a.egress.example.test/alternate",
    ]) {
        assert.throws(() => validateTrustedDeviceTunnelGatewayUrl({
            value,
            trustedHostSuffixes: ["egress.example.test"],
        }));
    }
});

test("rejects redirect-like or credential-bearing gateway URLs", () => {
    for (const value of [
        "https://node-a.example.test/device-tunnel",
        "wss://user:secret@node-a.example.test/device-tunnel",
        "wss://node-a.example.test/device-tunnel?next=wss://evil.example",
        "wss://node-a.example.test/device-tunnel#fragment",
    ]) {
        assert.throws(() => validateDeviceTunnelGatewayUrl(value, true));
    }
});
