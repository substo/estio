import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceTunnelRuntimeOwnership } from "../device-tunnel/runtime-ownership";
import {
    beginSessionAuthAttach,
    beginSessionAuthDetach,
    completeSessionAuthAttach,
    completeSessionAuthDetach,
    fenceExpiredSessionAuthOperation,
    getWhatsAppSessionAuthMode,
    isEncryptedWhatsAppSessionAuthActive,
    validateEncryptedWhatsAppSessionAuthConfiguration,
    type SessionAuthPlacementRecord,
} from "./session-auth-placement";

const ownership: DeviceTunnelRuntimeOwnership = {
    locationId: "location-a",
    sessionId: "session-a",
    bindingId: "binding-a",
    gatewayNodeId: "node-a",
    assignmentEpoch: 7,
    ownerInstanceId: "release-a",
    leaseEpoch: 9,
};

function placement(overrides: Partial<SessionAuthPlacementRecord> = {}): SessionAuthPlacementRecord {
    return {
        id: "placement-a",
        locationId: ownership.locationId,
        sessionId: ownership.sessionId,
        bindingId: ownership.bindingId,
        provider: "r2_encrypted_snapshot",
        state: "detached",
        gatewayNodeId: null,
        assignmentEpoch: 0,
        ownerInstanceId: null,
        leaseEpoch: 0,
        authEpoch: 3,
        operationId: null,
        operationStartedAt: null,
        operationDeadlineAt: null,
        currentGeneration: 2,
        lastKnownGoodGeneration: 2,
        recoveryStatus: "healthy",
        lastErrorCode: null,
        ...overrides,
    };
}

test("encrypted session auth is dormant unless every explicit flag is enabled", () => {
    assert.equal(getWhatsAppSessionAuthMode({} as NodeJS.ProcessEnv), "local");
    assert.equal(isEncryptedWhatsAppSessionAuthActive({ WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot" } as NodeJS.ProcessEnv), false);
    assert.equal(isEncryptedWhatsAppSessionAuthActive({
        WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot",
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
    } as NodeJS.ProcessEnv), true);
    assert.throws(() => getWhatsAppSessionAuthMode({ WHATSAPP_SESSION_AUTH_MODE: "remote" } as NodeJS.ProcessEnv));
});

test("encrypted session auth configuration requires a separate KMS key and private bucket", () => {
    assert.deepEqual(validateEncryptedWhatsAppSessionAuthConfiguration({} as NodeJS.ProcessEnv), { mode: "local", active: false });
    assert.throws(() => validateEncryptedWhatsAppSessionAuthConfiguration({
        WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot",
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
    } as NodeJS.ProcessEnv));
    assert.equal(validateEncryptedWhatsAppSessionAuthConfiguration({
        WHATSAPP_SESSION_AUTH_MODE: "encrypted_snapshot",
        DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT: "true",
        DEVICE_TUNNEL_RUNTIME_LEASE_ENFORCEMENT: "true",
        WHATSAPP_SESSION_AUTH_KMS_KEY_PATH: "projects/p/locations/global/keyRings/r/cryptoKeys/whatsapp-auth",
        WHATSAPP_SESSION_AUTH_R2_BUCKET: "estio-whatsapp-auth-private",
    } as NodeJS.ProcessEnv).active, true);
});

test("attach and detach preserve exact ownership and monotonic epochs", () => {
    const now = new Date("2026-07-20T10:00:00.000Z");
    const attaching = beginSessionAuthAttach({ placement: placement(), ownership, now, operationId: "attach-1" });
    assert.equal(attaching.authEpoch, 9);
    const attachedRecord = placement({ ...attaching });
    const attached = completeSessionAuthAttach({
        placement: attachedRecord,
        ownership,
        authEpoch: attaching.authEpoch,
        operationId: attaching.operationId,
        now: new Date(now.getTime() + 1_000),
    });
    const detachBase = placement({ ...attaching, ...attached });
    const detaching = beginSessionAuthDetach({ placement: detachBase, ownership, now, operationId: "detach-1" });
    const detached = completeSessionAuthDetach({
        placement: placement({ ...detachBase, ...detaching }),
        ownership,
        authEpoch: attaching.authEpoch,
        operationId: detaching.operationId,
        generation: 3,
        now: new Date(now.getTime() + 2_000),
    });
    assert.equal(detached.state, "detached");
    assert.equal(detached.currentGeneration, 3);
    assert.equal(detached.lastKnownGoodGeneration, 3);
    assert.equal(detached.gatewayNodeId, null);
});

test("stale owner and non-monotonic generation are fenced", () => {
    const attaching = beginSessionAuthAttach({ placement: placement(), ownership, operationId: "attach-1" });
    const attachedRecord = placement({ ...attaching, state: "attached", operationId: null, operationStartedAt: null, operationDeadlineAt: null });
    assert.throws(() => beginSessionAuthDetach({
        placement: attachedRecord,
        ownership: { ...ownership, ownerInstanceId: "release-b" },
    }), /fenced/);
    assert.throws(() => beginSessionAuthAttach({
        placement: placement({ bindingId: "binding-b" }),
        ownership,
    }), /binding scope/);
    const detaching = beginSessionAuthDetach({ placement: attachedRecord, ownership, operationId: "detach-1" });
    assert.throws(() => completeSessionAuthDetach({
        placement: placement({ ...attachedRecord, ...detaching }),
        ownership,
        authEpoch: attaching.authEpoch,
        operationId: "detach-1",
        generation: 2,
    }), /increase monotonically/);
});

test("expired operations increment the auth fence before quarantine", () => {
    const expired = placement({
        state: "attaching",
        gatewayNodeId: ownership.gatewayNodeId,
        assignmentEpoch: ownership.assignmentEpoch,
        ownerInstanceId: ownership.ownerInstanceId,
        leaseEpoch: ownership.leaseEpoch,
        authEpoch: 12,
        operationId: "expired-attach",
        operationStartedAt: new Date("2026-07-20T09:00:00.000Z"),
        operationDeadlineAt: new Date("2026-07-20T09:02:00.000Z"),
    });
    const fenced = fenceExpiredSessionAuthOperation({ placement: expired, now: new Date("2026-07-20T09:03:00.000Z") });
    assert.equal(fenced.authEpoch, 13);
    assert.equal(fenced.state, "quarantined");
    assert.equal(fenced.ownerInstanceId, null);
});
