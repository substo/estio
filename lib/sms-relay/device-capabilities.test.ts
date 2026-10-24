import assert from "node:assert/strict";
import test from "node:test";

import {
    acceptedSmsRelayCapabilities,
    normalizeSmsRelayPlatform,
} from "./device-capabilities";

test("unknown and omitted platforms remain Android for existing clients", () => {
    assert.equal(normalizeSmsRelayPlatform(undefined), "android");
    assert.equal(normalizeSmsRelayPlatform("android"), "android");
    assert.equal(normalizeSmsRelayPlatform("ios"), "ios");
});

test("iOS is limited to user-approved interactive SMS", () => {
    assert.deepEqual(acceptedSmsRelayCapabilities({
        platform: "ios",
        requestedCapabilities: ["sms_relay", "whatsapp_egress"],
        hasValidTunnelPublicKey: true,
    }), ["interactive_sms"]);
});

test("Android keeps unattended SMS and only gets egress with a key", () => {
    assert.deepEqual(acceptedSmsRelayCapabilities({
        platform: "android",
        requestedCapabilities: ["whatsapp_egress"],
        hasValidTunnelPublicKey: false,
    }), ["sms_relay"]);
    assert.deepEqual(acceptedSmsRelayCapabilities({
        platform: "android",
        requestedCapabilities: ["whatsapp_egress"],
        hasValidTunnelPublicKey: true,
    }), ["sms_relay", "whatsapp_egress"]);
});
