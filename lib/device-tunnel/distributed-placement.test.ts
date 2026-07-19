import assert from "node:assert/strict";
import test from "node:test";
import {
    buildDeviceTunnelGatewayAssignment,
    isDistributedDeviceTunnelPlacementEnabled,
    nextAssignmentEpoch,
    selectDeviceTunnelGatewayNode,
} from "./distributed-placement";

const now = new Date("2026-07-19T12:00:00.000Z");

test("distributed placement is opt-in", () => {
    assert.equal(isDistributedDeviceTunnelPlacementEnabled({} as NodeJS.ProcessEnv), false);
    assert.equal(isDistributedDeviceTunnelPlacementEnabled({ DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true" } as NodeJS.ProcessEnv), true);
    assert.equal(isDistributedDeviceTunnelPlacementEnabled({ DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "1" } as NodeJS.ProcessEnv), false);
});

test("placement keeps a healthy current node for stable assignment", () => {
    const nodes = [
        { id: "node-a", region: "eu", status: "online", capacitySessions: 10, activeSessions: 8, lastHeartbeatAt: now },
        { id: "node-b", region: "eu", status: "online", capacitySessions: 10, activeSessions: 1, lastHeartbeatAt: now },
    ];
    assert.equal(selectDeviceTunnelGatewayNode({ nodes, now, heartbeatTimeoutMs: 30_000, region: "eu", currentNodeId: "node-a" })?.id, "node-a");
});

test("placement chooses the least-loaded healthy node and excludes stale or draining nodes", () => {
    const nodes = [
        { id: "stale", region: "eu", status: "online", capacitySessions: 10, activeSessions: 0, lastHeartbeatAt: new Date(now.getTime() - 31_000) },
        { id: "draining", region: "eu", status: "draining", capacitySessions: 10, activeSessions: 0, lastHeartbeatAt: now },
        { id: "node-a", region: "eu", status: "online", capacitySessions: 10, activeSessions: 5, lastHeartbeatAt: now },
        { id: "node-b", region: "eu", status: "online", capacitySessions: 20, activeSessions: 2, lastHeartbeatAt: now },
    ];
    assert.equal(selectDeviceTunnelGatewayNode({ nodes, now, heartbeatTimeoutMs: 30_000, region: "eu" })?.id, "node-b");
});

test("assignment epochs only move forward", () => {
    assert.equal(nextAssignmentEpoch(0), 1);
    assert.equal(nextAssignmentEpoch(41), 42);
    assert.throws(() => nextAssignmentEpoch(-1));
    assert.deepEqual(buildDeviceTunnelGatewayAssignment({ currentEpoch: 4, gatewayNodeId: "node-a", assignedAt: now }), {
        gatewayNodeId: "node-a",
        assignmentEpoch: 5,
        assignedAt: now,
        desiredState: "active",
        drainRequestedAt: null,
    });
});
