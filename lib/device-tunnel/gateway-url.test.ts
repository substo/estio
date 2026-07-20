import assert from "node:assert/strict";
import test from "node:test";
import { validateDeviceTunnelGatewayUrl } from "./gateway-url";

test("accepts canonical WSS node URLs", () => {
    assert.equal(validateDeviceTunnelGatewayUrl("wss://node-a.example.test/device-tunnel/", true), "wss://node-a.example.test/device-tunnel");
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
