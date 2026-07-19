import assert from "node:assert/strict";
import test from "node:test";
import { calculateTunnelSendProof } from "./send-proof";

test("verifies bytes that crossed the tunnel inside a send window", () => {
    const startedAt = new Date("2026-07-19T12:00:00.000Z");
    const result = calculateTunnelSendProof({
        snapshot: { startedAt, bytesToDevice: 1_000n, bytesFromDevice: 2_000n },
        now: new Date("2026-07-19T12:00:03.000Z"),
        lastBrowserTrafficAt: new Date("2026-07-19T12:00:02.000Z"),
        bytesToDevice: 1_640n,
        bytesFromDevice: 2_320n,
    });
    assert.deepEqual(result, { bytesToDevice: 640n, bytesFromDevice: 320n });
});

test("rejects background traffic from before the send window", () => {
    const startedAt = new Date("2026-07-19T12:00:00.000Z");
    const result = calculateTunnelSendProof({
        snapshot: { startedAt, bytesToDevice: 1_000n, bytesFromDevice: 2_000n },
        now: new Date("2026-07-19T12:00:03.000Z"),
        lastBrowserTrafficAt: new Date("2026-07-19T11:59:59.000Z"),
        bytesToDevice: 1_640n,
        bytesFromDevice: 2_320n,
    });
    assert.equal(result, null);
});

test("rejects an expired or downstream-only send window", () => {
    const startedAt = new Date("2026-07-19T12:00:00.000Z");
    assert.equal(calculateTunnelSendProof({
        snapshot: { startedAt, bytesToDevice: 1_000n, bytesFromDevice: 2_000n },
        now: new Date("2026-07-19T12:03:00.000Z"),
        lastBrowserTrafficAt: new Date("2026-07-19T12:00:02.000Z"),
        bytesToDevice: 1_640n,
        bytesFromDevice: 2_320n,
    }), null);
    assert.equal(calculateTunnelSendProof({
        snapshot: { startedAt, bytesToDevice: 1_000n, bytesFromDevice: 2_000n },
        now: new Date("2026-07-19T12:00:03.000Z"),
        lastBrowserTrafficAt: new Date("2026-07-19T12:00:02.000Z"),
        bytesToDevice: 1_000n,
        bytesFromDevice: 2_320n,
    }), null);
});
