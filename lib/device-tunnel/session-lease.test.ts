import assert from "node:assert/strict";
import test from "node:test";
import {
    acquireDeviceTunnelSessionLease,
    renewDeviceTunnelSessionLease,
    type DeviceTunnelLeaseScope,
    type DeviceTunnelLeaseStore,
    type DeviceTunnelSessionLeaseRecord,
} from "./session-lease";

class ConcurrentMemoryLeaseStore implements DeviceTunnelLeaseStore {
    lease: DeviceTunnelSessionLeaseRecord | null = null;
    private queue = Promise.resolve();

    private serial<T>(operation: () => T | Promise<T>): Promise<T> {
        const result = this.queue.then(operation, operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    acquire(args: DeviceTunnelLeaseScope & { leaseId: string; ownerInstanceId: string; now: Date; expiresAt: Date }) {
        return this.serial(() => {
            if (this.lease && this.lease.expiresAt > args.now && this.lease.state === "active") return null;
            const epoch = Math.max((this.lease?.epoch || 0) + 1, args.assignmentEpoch);
            this.lease = {
                id: this.lease?.id || args.leaseId,
                sessionId: args.sessionId,
                bindingId: args.bindingId,
                gatewayNodeId: args.gatewayNodeId,
                ownerInstanceId: args.ownerInstanceId,
                epoch,
                acquiredAt: args.now,
                renewedAt: args.now,
                expiresAt: args.expiresAt,
                state: "active",
            };
            return { ...this.lease };
        });
    }

    renew(args: DeviceTunnelLeaseScope & { ownerInstanceId: string; epoch: number; now: Date; expiresAt: Date }) {
        return this.serial(() => {
            if (
                !this.lease
                || this.lease.ownerInstanceId !== args.ownerInstanceId
                || this.lease.epoch !== args.epoch
                || this.lease.expiresAt <= args.now
                || this.lease.gatewayNodeId !== args.gatewayNodeId
                || this.lease.state !== "active"
            ) return null;
            this.lease.renewedAt = args.now;
            this.lease.expiresAt = args.expiresAt;
            return { ...this.lease };
        });
    }

    expire(args: DeviceTunnelLeaseScope & { ownerInstanceId: string; epoch: number; now: Date }) {
        return this.serial(() => {
            if (!this.lease || this.lease.sessionId !== args.sessionId || this.lease.ownerInstanceId !== args.ownerInstanceId || this.lease.epoch !== args.epoch) {
                return false;
            }
            this.lease.state = "expired";
            this.lease.expiresAt = args.now;
            return true;
        });
    }
}

const scope = {
    locationId: "location-1",
    sessionId: "session-1",
    bindingId: "binding-1",
    gatewayNodeId: "node-1",
    assignmentEpoch: 7,
};

test("two concurrent owners cannot both acquire or renew a session lease", async () => {
    const store = new ConcurrentMemoryLeaseStore();
    const acquiredAt = new Date("2026-07-19T12:00:00.000Z");
    const [ownerA, ownerB] = await Promise.all([
        acquireDeviceTunnelSessionLease({ store, ...scope, ownerInstanceId: "owner-a", ttlMs: 15_000, now: acquiredAt }),
        acquireDeviceTunnelSessionLease({ store, ...scope, ownerInstanceId: "owner-b", ttlMs: 15_000, now: acquiredAt }),
    ]);
    const winner = ownerA || ownerB;
    const loserId = ownerA ? "owner-b" : "owner-a";
    assert.ok(winner);
    assert.equal(Number(Boolean(ownerA)) + Number(Boolean(ownerB)), 1);

    const renewed = await renewDeviceTunnelSessionLease({
        store,
        ...scope,
        ownerInstanceId: winner.ownerInstanceId,
        epoch: winner.epoch,
        ttlMs: 15_000,
        now: new Date(acquiredAt.getTime() + 1_000),
    });
    assert.equal(renewed?.ownerInstanceId, winner.ownerInstanceId);

    const staleRenewal = await renewDeviceTunnelSessionLease({
        store,
        ...scope,
        ownerInstanceId: loserId,
        epoch: winner.epoch,
        ttlMs: 15_000,
        now: new Date(acquiredAt.getTime() + 2_000),
    });
    assert.equal(staleRenewal, null);
});

test("takeover after expiry increments the fencing epoch and rejects the old owner", async () => {
    const store = new ConcurrentMemoryLeaseStore();
    const startedAt = new Date("2026-07-19T12:00:00.000Z");
    const first = await acquireDeviceTunnelSessionLease({ store, ...scope, ownerInstanceId: "owner-a", ttlMs: 1_000, now: startedAt });
    assert.ok(first);

    const takeoverAt = new Date(startedAt.getTime() + 1_001);
    const second = await acquireDeviceTunnelSessionLease({ store, ...scope, ownerInstanceId: "owner-b", ttlMs: 1_000, now: takeoverAt });
    assert.ok(second);
    assert.equal(second.epoch, first.epoch + 1);

    const staleRenewal = await renewDeviceTunnelSessionLease({
        store,
        ...scope,
        ownerInstanceId: "owner-a",
        epoch: first.epoch,
        ttlMs: 1_000,
        now: takeoverAt,
    });
    assert.equal(staleRenewal, null);
});
