import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";
import { SessionAuthPlacementStore } from "./session-auth-store";

const ownership: DeviceTunnelRuntimeOwnership = {
    locationId: "location-a", sessionId: "session-a", bindingId: "binding-a",
    gatewayNodeId: "node-a", assignmentEpoch: 5, ownerInstanceId: "release-a", leaseEpoch: 7,
};

function matches(value: any, where: any): boolean {
    return Object.entries(where || {}).every(([key, expected]: [string, any]) => {
        const actual = value[key];
        if (expected && typeof expected === "object" && "in" in expected) return expected.in.includes(actual);
        if (expected && typeof expected === "object" && "lt" in expected) return actual < expected.lt;
        if (expected && typeof expected === "object" && "not" in expected) return actual !== expected.not;
        return actual === expected;
    });
}

function fakeDb() {
    const state: any = {
        placement: {
            id: "placement-a", locationId: ownership.locationId, sessionId: ownership.sessionId,
            bindingId: ownership.bindingId, provider: "r2_encrypted_snapshot", state: "detached",
            gatewayNodeId: null, assignmentEpoch: 0, ownerInstanceId: null, leaseEpoch: 0,
            authEpoch: 2, operationId: null, operationStartedAt: null, operationDeadlineAt: null,
            currentGeneration: 2, lastKnownGoodGeneration: 2, recoveryStatus: "healthy", lastErrorCode: null,
        },
        generations: [
            { id: "g1", placementId: "placement-a", sessionId: ownership.sessionId, generation: 1, status: "retired", objectKey: "object-1", createdAt: new Date("2026-07-18") },
            { id: "g2", placementId: "placement-a", sessionId: ownership.sessionId, generation: 2, status: "verified", objectKey: "object-2", createdAt: new Date("2026-07-19") },
        ],
        audits: [] as any[],
    };
    const db: any = {
        $transaction: async (callback: any) => callback(db),
        deviceTunnelSessionLease: { findUnique: async () => ({
            sessionId: ownership.sessionId, bindingId: ownership.bindingId, gatewayNodeId: ownership.gatewayNodeId,
            ownerInstanceId: ownership.ownerInstanceId, epoch: ownership.leaseEpoch, state: "active",
            expiresAt: new Date(Date.now() + 60_000), session: { locationId: ownership.locationId },
            binding: { id: ownership.bindingId, locationId: ownership.locationId, sessionId: ownership.sessionId, gatewayNodeId: ownership.gatewayNodeId, assignmentEpoch: ownership.assignmentEpoch, desiredState: "active" },
            gatewayNode: { id: ownership.gatewayNodeId, status: "online" },
        }) },
        whatsAppSessionAuthPlacement: {
            upsert: async () => ({ ...state.placement }),
            findUnique: async () => ({ ...state.placement }),
            update: async ({ where, data }: any) => {
                if (!matches(state.placement, where)) throw new Error("placement not found");
                Object.assign(state.placement, data);
                return { ...state.placement };
            },
            updateMany: async ({ where, data }: any) => {
                if (!matches(state.placement, where)) return { count: 0 };
                Object.assign(state.placement, data);
                return { count: 1 };
            },
        },
        whatsAppSessionAuthGeneration: {
            create: async ({ data }: any) => {
                const value = { id: `g${data.generation}`, createdAt: new Date(), ...data };
                state.generations.push(value);
                return value;
            },
            findUnique: async ({ where }: any) => state.generations.find((item: any) =>
                item.placementId === where.placementId_generation.placementId
                && item.generation === where.placementId_generation.generation) || null,
            findFirst: async ({ where }: any) => [...state.generations]
                .filter((item) => matches(item, where)).sort((a, b) => b.generation - a.generation)[0] || null,
            findMany: async ({ where }: any) => state.generations.filter((item: any) => matches(item, where)),
            update: async ({ where, data }: any) => {
                const value = state.generations.find((item: any) => item.id === where.id);
                if (!value) throw new Error("generation not found");
                Object.assign(value, data);
                return value;
            },
            updateMany: async ({ where, data }: any) => {
                const values = state.generations.filter((item: any) => matches(item, where));
                values.forEach((item: any) => Object.assign(item, data));
                return { count: values.length };
            },
        },
        whatsAppSessionAuthAuditEvent: { create: async ({ data }: any) => { state.audits.push(data); return data; } },
    };
    return { db, state };
}

test("transactional store fences attach, publishes a monotonic checkpoint, and rolls back to retained auth", async () => {
    const { db, state } = fakeDb();
    const store = new SessionAuthPlacementStore(db);
    const claimed = await store.claimAttach(ownership);
    assert.equal(state.placement.state, "attaching");
    assert.equal(state.placement.authEpoch, 7);
    const attached = await store.completeAttach(claimed.placement, ownership);
    const detaching = await store.claimDetach(attached.id, ownership);
    const archive: any = { ciphertext: Buffer.from("cipher"), metadata: {
        encryptionAlgorithm: "AES-256-GCM", formatVersion: 1, kmsKeyName: "kms", encryptedDek: "dek",
        iv: "iv", authTag: "tag", ciphertextSha256: "c".repeat(64), plaintextSha256: "p".repeat(64),
        encryptedSize: 6, plaintextSize: 10,
    } };
    await store.publishCheckpoint({
        placement: detaching, ownership, generation: 3, objectKey: "object-3",
        objectVersionId: null, objectEtag: null, archive,
    });
    assert.equal(state.placement.currentGeneration, 3);
    assert.equal(state.generations.find((item: any) => item.generation === 2).status, "retired");
    const rolledBack = await store.rollbackToPrevious(state.placement.id, ownership);
    assert.equal(rolledBack.currentGeneration, 2);
    assert.equal(rolledBack.authEpoch, 8);
    assert.equal(state.generations.find((item: any) => item.generation === 2).status, "verified");
    assert.deepEqual(state.audits.map((item: any) => item.eventType), [
        "attach_claimed", "attach_completed", "detach_claimed", "checkpoint_published", "operator_rollback",
    ]);
});

test("authoritative unhealthy owner detaches without publishing a checkpoint", async () => {
    const { db, state } = fakeDb();
    const store = new SessionAuthPlacementStore(db);
    const claimed = await store.claimAttach(ownership);
    const attached = await store.completeAttach(claimed.placement, ownership);

    const detached = await store.detachWithoutCheckpoint(attached.id, ownership);

    assert.equal(detached.state, "detached");
    assert.equal(detached.currentGeneration, 2);
    assert.equal(detached.lastKnownGoodGeneration, 2);
    assert.equal(detached.authEpoch, 8);
    assert.equal(detached.gatewayNodeId, null);
    assert.equal(detached.ownerInstanceId, null);
    assert.equal(detached.leaseEpoch, 0);
    assert.equal(detached.lastErrorCode, "unhealthy_profile_discarded");
    assert.deepEqual(state.audits.map((item: any) => item.eventType), [
        "attach_claimed", "attach_completed", "checkpoint_skipped",
    ]);
});

test("non-authoritative owner cannot detach a durable profile without a checkpoint", async () => {
    const { db } = fakeDb();
    const store = new SessionAuthPlacementStore(db);
    const claimed = await store.claimAttach(ownership);
    const attached = await store.completeAttach(claimed.placement, ownership);

    await assert.rejects(
        store.detachWithoutCheckpoint(attached.id, { ...ownership, ownerInstanceId: "stale-owner" }),
        /not authoritative/,
    );
});
