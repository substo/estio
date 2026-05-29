import assert from "node:assert/strict";
import test from "node:test";
import { getStaleWhatsAppWebBridgeNonReadyReason } from "./web-bridge-readiness";

test("getStaleWhatsAppWebBridgeNonReadyReason ignores ready sessions", () => {
    const result = getStaleWhatsAppWebBridgeNonReadyReason({
        status: "authenticated",
        ready: true,
        lastEventAt: "2026-05-29T06:00:00.000Z",
        nowMs: Date.parse("2026-05-29T06:10:00.000Z"),
        maxAgeMs: 180_000,
    });

    assert.equal(result, null);
});

test("getStaleWhatsAppWebBridgeNonReadyReason flags authenticated sessions stuck before ready", () => {
    const result = getStaleWhatsAppWebBridgeNonReadyReason({
        status: "authenticated",
        ready: false,
        lastEventAt: "2026-05-29T06:00:00.000Z",
        nowMs: Date.parse("2026-05-29T06:04:00.000Z"),
        maxAgeMs: 180_000,
    });

    assert.match(result || "", /stayed authenticated for 240 seconds/);
});

test("getStaleWhatsAppWebBridgeNonReadyReason allows recent non-ready sessions", () => {
    const result = getStaleWhatsAppWebBridgeNonReadyReason({
        status: "starting",
        ready: false,
        lastEventAt: "2026-05-29T06:00:00.000Z",
        nowMs: Date.parse("2026-05-29T06:01:00.000Z"),
        maxAgeMs: 180_000,
    });

    assert.equal(result, null);
});
