import assert from "node:assert/strict";
import test from "node:test";
import { assignDeviceTunnelBindingToGateway } from "./assignment";

const now = new Date("2026-07-19T12:00:00.000Z");
const node = (overrides: Record<string, unknown> = {}) => ({
    id: "node-a",
    region: "eu",
    publicUrl: "wss://node-a.example.test/device-tunnel",
    status: "online",
    capacitySessions: 10,
    activeSessions: 1,
    lastHeartbeatAt: now,
    ...overrides,
});

class AssignmentDb {
    binding = {
        id: "binding-1",
        locationId: "location-1",
        deviceId: "device-1",
        sessionId: "session-1",
        gatewayNodeId: null as string | null,
        assignmentEpoch: 0,
        assignedAt: null as Date | null,
    };
    nodes = [node()];
    updates = 0;
    private transactionTail: Promise<unknown> = Promise.resolve();

    deviceTunnelGatewayNode = { findMany: async (args: any) => this.nodes.filter((candidate) => (
        (!args?.where?.id || candidate.id === args.where.id)
        && (!args?.where?.region || candidate.region === args.where.region)
    )) };
    deviceTunnelBinding = {
        update: async (args: any) => {
            this.updates += 1;
            Object.assign(this.binding, args.data);
            return { ...this.binding };
        },
    };
    $queryRaw = async () => [{ ...this.binding }];
    $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const result = this.transactionTail.then(() => fn(this));
        this.transactionTail = result.then(() => undefined, () => undefined);
        return result;
    }
}

test("assignment preserves an existing healthy node", async () => {
    const db = new AssignmentDb();
    db.binding.gatewayNodeId = "node-a";
    db.binding.assignmentEpoch = 8;
    const assigned = await assignDeviceTunnelBindingToGateway({ db: db as any, bindingId: db.binding.id, now, region: "eu" });
    assert.equal(assigned.gatewayNodeId, "node-a");
    assert.equal(assigned.assignmentEpoch, 8);
    assert.equal(db.updates, 0);
});

test("assignment selects a healthy node with capacity and increments the epoch on ownership change", async () => {
    const db = new AssignmentDb();
    db.nodes = [node({ id: "full", activeSessions: 10 }), node({ id: "node-b", activeSessions: 2 })];
    const assigned = await assignDeviceTunnelBindingToGateway({ db: db as any, bindingId: db.binding.id, now, region: "eu" });
    assert.equal(assigned.gatewayNodeId, "node-b");
    assert.equal(assigned.assignmentEpoch, 1);
    assert.equal(db.updates, 1);
});

test("explicit canary assignment selects only the reviewed node", async () => {
    const db = new AssignmentDb();
    db.nodes = [node({ id: "node-a", activeSessions: 0 }), node({ id: "node-b", activeSessions: 4 })];
    const assigned = await assignDeviceTunnelBindingToGateway({
        db: db as any, bindingId: db.binding.id, now, region: "eu", requiredNodeId: "node-b",
    });
    assert.equal(assigned.gatewayNodeId, "node-b");
    assert.equal(assigned.assignmentEpoch, 1);
});

test("assignment rejects offline, stale, draining, quarantined, full, and unroutable nodes", async () => {
    const db = new AssignmentDb();
    db.nodes = [
        node({ id: "offline", status: "offline" }),
        node({ id: "stale", lastHeartbeatAt: new Date(now.getTime() - 46_000) }),
        node({ id: "draining", status: "draining" }),
        node({ id: "quarantined", status: "quarantined" }),
        node({ id: "full", activeSessions: 10 }),
        node({ id: "unroutable", publicUrl: "https://node.example.test" }),
    ];
    await assert.rejects(
        () => assignDeviceTunnelBindingToGateway({ db: db as any, bindingId: db.binding.id, now, region: "eu" }),
        /No healthy/,
    );
});

test("concurrent assignments serialize on the authoritative binding row", async () => {
    const db = new AssignmentDb();
    const [first, second] = await Promise.all([
        assignDeviceTunnelBindingToGateway({ db: db as any, bindingId: db.binding.id, now, region: "eu" }),
        assignDeviceTunnelBindingToGateway({ db: db as any, bindingId: db.binding.id, now, region: "eu" }),
    ]);
    assert.equal(first.gatewayNodeId, "node-a");
    assert.equal(second.gatewayNodeId, "node-a");
    assert.equal(first.assignmentEpoch, 1);
    assert.equal(second.assignmentEpoch, 1);
    assert.equal(db.updates, 1);
});
