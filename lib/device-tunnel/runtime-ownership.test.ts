import assert from "node:assert/strict";
import test from "node:test";
import {
    isDeviceTunnelRuntimeLeaseEnforcementEnabled,
    isDeviceTunnelRuntimeLeaseEnforcementActive,
    isDeviceTunnelRuntimeOwnershipRecordValid,
    RuntimeLeaseRenewalFence,
    sameDeviceTunnelRuntimeOwnership,
    type DeviceTunnelRuntimeOwnership,
    type DeviceTunnelRuntimeOwnershipRecord,
} from "./runtime-ownership";

const now = new Date("2026-07-20T12:00:00.000Z");
const ownership: DeviceTunnelRuntimeOwnership = {
    locationId: "location-1",
    sessionId: "session-1",
    bindingId: "binding-1",
    gatewayNodeId: "node-1",
    assignmentEpoch: 7,
    ownerInstanceId: "runtime-1",
    leaseEpoch: 9,
};
const record: DeviceTunnelRuntimeOwnershipRecord = {
    id: "lease-1",
    sessionId: ownership.sessionId,
    bindingId: ownership.bindingId,
    gatewayNodeId: ownership.gatewayNodeId,
    ownerInstanceId: ownership.ownerInstanceId,
    epoch: ownership.leaseEpoch,
    acquiredAt: now,
    renewedAt: now,
    expiresAt: new Date(now.getTime() + 30_000),
    state: "active",
    session: { locationId: ownership.locationId },
    binding: {
        id: ownership.bindingId,
        locationId: ownership.locationId,
        sessionId: ownership.sessionId,
        gatewayNodeId: ownership.gatewayNodeId,
        assignmentEpoch: ownership.assignmentEpoch,
        desiredState: "active",
    },
    gatewayNode: { id: ownership.gatewayNodeId, status: "online" },
};

test("runtime lease enforcement is explicit and defaults off", () => {
    assert.equal(isDeviceTunnelRuntimeLeaseEnforcementEnabled({} as NodeJS.ProcessEnv), false);
    assert.equal(isDeviceTunnelRuntimeLeaseEnforcementEnabled({ DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true" } as NodeJS.ProcessEnv), true);
    assert.equal(isDeviceTunnelRuntimeLeaseEnforcementActive({ DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true" } as NodeJS.ProcessEnv), false);
    assert.equal(isDeviceTunnelRuntimeLeaseEnforcementActive({
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
    } as NodeJS.ProcessEnv), true);
});

test("only the exact tenant, session, binding, node, assignment, owner, and lease epoch can serve", () => {
    assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record, now }), true);
    assert.equal(sameDeviceTunnelRuntimeOwnership(ownership, { ...ownership }), true);
    const cases: Array<[string, () => DeviceTunnelRuntimeOwnershipRecord | DeviceTunnelRuntimeOwnership]> = [
        ["tenant", () => ({ ...ownership, locationId: "location-2" })],
        ["session", () => ({ ...ownership, sessionId: "session-2" })],
        ["binding", () => ({ ...ownership, bindingId: "binding-2" })],
        ["gateway node", () => ({ ...ownership, gatewayNodeId: "node-2" })],
        ["assignment epoch", () => ({ ...ownership, assignmentEpoch: 8 })],
        ["owner", () => ({ ...ownership, ownerInstanceId: "runtime-2" })],
        ["lease epoch", () => ({ ...ownership, leaseEpoch: 10 })],
    ];
    for (const [label, mutate] of cases) {
        assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({
            ownership: mutate() as DeviceTunnelRuntimeOwnership,
            record,
            now,
        }), false, label);
    }
});

test("expiry, lease state, node drain, and binding drain fence runtime ownership", () => {
    assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record: { ...record, expiresAt: now }, now }), false);
    assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record: { ...record, state: "draining" }, now }), false);
    assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record: { ...record, gatewayNode: { ...record.gatewayNode, status: "draining" } }, now }), false);
    assert.equal(isDeviceTunnelRuntimeOwnershipRecordValid({ ownership, record: { ...record, binding: { ...record.binding, desiredState: "draining" } }, now }), false);
});

test("two consecutive missed renewals stop new work permanently", () => {
    const resources = { streamsClosed: false, browserStopped: false };
    const fence = new RuntimeLeaseRenewalFence(2, () => {
        resources.streamsClosed = true;
        resources.browserStopped = true;
    });
    assert.equal(fence.recordFailure(), true);
    assert.equal(fence.canAcceptWork, true);
    assert.equal(fence.recordFailure(), false);
    assert.equal(fence.canAcceptWork, false);
    assert.deepEqual(resources, { streamsClosed: true, browserStopped: true });
    assert.equal(fence.recordSuccess(), false);
    assert.equal(fence.canAcceptWork, false);
});
