import assert from "node:assert/strict";
import test from "node:test";
import type { DeviceTunnelTokenPayload } from "./auth";
import { authorizeDeviceTunnelGatewayConnection } from "./gateway-authorization";

const now = new Date("2026-07-19T12:00:00.000Z");
const token: DeviceTunnelTokenPayload = {
    aud: "device-tunnel-gateway",
    nodeId: "node-a",
    sessionId: "session-1",
    bindingId: "binding-1",
    deviceId: "device-1",
    locationId: "location-1",
    assignmentEpoch: 4,
    credentialVersion: 3,
    purpose: "device_tunnel",
    jti: "jti-1",
    iat: 1,
    exp: 301,
};

function authorizationDb(overrides: Record<string, unknown> = {}) {
    const record = {
        bindingId: "binding-1",
        sessionId: "session-1",
        deviceId: "device-1",
        locationId: "location-1",
        assignmentEpoch: 4,
        gatewayNodeId: "node-a",
        nodeStatus: "online",
        nodeHeartbeat: now,
        credentialVersion: 3,
        paired: true,
        revoked: false,
        hasCredential: true,
        egressMode: "device_tunnel",
        ...overrides,
    };
    return {
        deviceTunnelBinding: {
            findFirst: async (args: any) => {
                const where = args.where;
                const matches = where.id === record.bindingId
                    && where.sessionId === record.sessionId
                    && where.deviceId === record.deviceId
                    && where.locationId === record.locationId
                    && where.assignmentEpoch === record.assignmentEpoch
                    && where.device.tunnelCredentialVersion === record.credentialVersion
                    && where.device.paired === record.paired
                    && Boolean(where.device.deviceApiTokenHash) === record.hasCredential
                    && (where.device.tunnelRevokedAt === null) === !record.revoked
                    && where.session.egressMode === record.egressMode
                    && (!where.gatewayNodeId || (
                        where.gatewayNodeId === record.gatewayNodeId
                        && where.gatewayNode.status === record.nodeStatus
                        && record.nodeHeartbeat >= where.gatewayNode.lastHeartbeatAt.gte
                    ));
                return matches ? {
                    id: record.bindingId,
                    deviceId: record.deviceId,
                    locationId: record.locationId,
                    session: { id: record.sessionId, sessionId: "bridge-location-1", egressMode: record.egressMode },
                } : null;
            },
        },
    };
}

test("the assigned healthy gateway accepts the fully scoped token", async () => {
    const binding = await authorizeDeviceTunnelGatewayConnection({
        db: authorizationDb(),
        token,
        gatewayNodeId: "node-a",
        distributedPlacement: true,
        now,
    });
    assert.equal(binding.id, "binding-1");
});

test("wrong node and stale assignment epoch are rejected", async () => {
    await assert.rejects(() => authorizeDeviceTunnelGatewayConnection({
        db: authorizationDb(), token, gatewayNodeId: "node-b", distributedPlacement: true, now,
    }), /another gateway node/);
    await assert.rejects(() => authorizeDeviceTunnelGatewayConnection({
        db: authorizationDb({ assignmentEpoch: 5 }), token, gatewayNodeId: "node-a", distributedPlacement: true, now,
    }), /no longer matches/);
});

test("wrong tenant, session, binding, or device scope is rejected", async () => {
    for (const changed of [
        { locationId: "location-2" },
        { sessionId: "session-2" },
        { bindingId: "binding-2" },
        { deviceId: "device-2" },
    ]) {
        await assert.rejects(() => authorizeDeviceTunnelGatewayConnection({
            db: authorizationDb(changed), token, gatewayNodeId: "node-a", distributedPlacement: true, now,
        }), /no longer matches/);
    }
});

test("revoked, re-paired, and stale-node credentials are rejected", async () => {
    for (const changed of [
        { revoked: true },
        { credentialVersion: 4 },
        { paired: false },
        { hasCredential: false },
        { nodeStatus: "draining" },
        { nodeHeartbeat: new Date(now.getTime() - 46_000) },
    ]) {
        await assert.rejects(() => authorizeDeviceTunnelGatewayConnection({
            db: authorizationDb(changed), token, gatewayNodeId: "node-a", distributedPlacement: true, now,
        }), /no longer matches/);
    }
});

test("flag-off compatibility does not require authoritative gateway assignment", async () => {
    const binding = await authorizeDeviceTunnelGatewayConnection({
        db: authorizationDb({ gatewayNodeId: null, nodeStatus: "offline" }),
        token,
        gatewayNodeId: "node-a",
        distributedPlacement: false,
        now,
    });
    assert.equal(binding.id, "binding-1");
});
