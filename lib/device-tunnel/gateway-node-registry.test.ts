import assert from "node:assert/strict";
import test from "node:test";
import {
    heartbeatDeviceTunnelGatewayNode,
    registerDeviceTunnelGatewayNode,
    setDeviceTunnelGatewayNodeDrainState,
} from "./gateway-node-registry";

const registration = {
    id: "node-a",
    region: "eu",
    publicUrl: "wss://node-a.example.test/device-tunnel",
    internalUrl: "http://127.0.0.1:3220",
    capacitySessions: 100,
    version: "test",
    startedAt: new Date("2026-07-19T12:00:00.000Z"),
};

test("a quarantined gateway cannot register itself back online", async () => {
    let updateCalled = false;
    const db = {
        deviceTunnelGatewayNode: {
            findUnique: async () => ({ status: "quarantined" }),
            create: async () => undefined,
            updateMany: async () => {
                updateCalled = true;
                return { count: 1 };
            },
        },
    };
    await assert.rejects(() => registerDeviceTunnelGatewayNode(db, registration), /quarantined/);
    assert.equal(updateCalled, false);
});

test("drain and resume are fenced by node ID and process generation", async () => {
    const transitions: any[] = [];
    const db = {
        deviceTunnelGatewayNode: {
            findUnique: async () => ({ status: "online" }),
            create: async () => undefined,
            updateMany: async (args: any) => {
                transitions.push(args);
                return { count: 1 };
            },
        },
    };
    assert.equal(await setDeviceTunnelGatewayNodeDrainState({
        db, nodeId: registration.id, startedAt: registration.startedAt, draining: true,
    }), true);
    assert.equal(await setDeviceTunnelGatewayNodeDrainState({
        db, nodeId: registration.id, startedAt: registration.startedAt, draining: false,
    }), true);
    assert.equal(transitions[0].where.status, "online");
    assert.equal(transitions[0].data.status, "draining");
    assert.equal(transitions[1].where.status, "draining");
    assert.equal(transitions[1].data.status, "online");
});

test("heartbeats are fenced by stable node ID and process start time", async () => {
    let updateArgs: any;
    const db = {
        deviceTunnelGatewayNode: {
            findUnique: async () => ({ status: "online" }),
            create: async () => undefined,
            updateMany: async (args: unknown) => {
                updateArgs = args;
                return { count: 1 };
            },
        },
    };
    const updated = await heartbeatDeviceTunnelGatewayNode({
        db,
        nodeId: registration.id,
        startedAt: registration.startedAt,
        activeSessions: 3,
        now: new Date("2026-07-19T12:00:15.000Z"),
    });
    assert.equal(updated, true);
    assert.deepEqual(updateArgs.where, {
        id: registration.id,
        startedAt: registration.startedAt,
        status: { in: ["online", "draining"] },
    });
    assert.equal(updateArgs.data.activeSessions, 3);
});
