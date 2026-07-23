import assert from "node:assert/strict";
import test from "node:test";

import {
    attachLiveDeviceTunnelProxyState,
    DeviceTunnelStreamHealth,
} from "./stream-health";

test("stream health opens the reconnect circuit after consecutive failures", () => {
    const health = new DeviceTunnelStreamHealth(3);
    assert.equal(health.recordOpenResult(false), false);
    assert.equal(health.recordOpenResult(false), false);
    assert.equal(health.recordOpenResult(false), true);
    assert.equal(health.failureCount, 3);
});

test("a successful stream resets the failure circuit", () => {
    const health = new DeviceTunnelStreamHealth(3);
    health.recordOpenResult(false);
    health.recordOpenResult(false);
    assert.equal(health.recordOpenResult(true), false);
    assert.equal(health.failureCount, 0);
    assert.equal(health.recordOpenResult(false), false);
});

test("the SOCKS proxy and lease renewer retain one live runtime state", () => {
    const proxyRuntime = { leaseExpiresAt: new Date("2026-07-23T10:00:30Z") };
    const connectedDevice = attachLiveDeviceTunnelProxyState(proxyRuntime, {
        proxyPort: 32123,
    });

    connectedDevice.leaseExpiresAt = new Date("2026-07-23T10:01:00Z");

    assert.equal(connectedDevice, proxyRuntime);
    assert.equal(proxyRuntime.leaseExpiresAt.toISOString(), "2026-07-23T10:01:00.000Z");
});
