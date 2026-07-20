import assert from "node:assert/strict";
import test from "node:test";
import {
    DEVICE_EGRESS_FAILURE_SCENARIOS,
    buildDeviceEgressReassignment,
    evaluateDeviceEgressCanaryAcceptance,
    planDeviceEgressFailureResponse,
    type DeviceEgressCanaryObservation,
} from "./multi-node-operations";

function healthy(overrides: Partial<DeviceEgressCanaryObservation> = {}): DeviceEgressCanaryObservation {
    return {
        nodeId: "node-b", expectedNodeId: "node-b",
        assignmentEpoch: 5, previousAssignmentEpoch: 4,
        leaseEpoch: 7, previousLeaseEpoch: 6,
        authEpoch: 9, previousAuthEpoch: 8,
        authGeneration: 3, restoredGeneration: 3,
        gatewayGeneration: "gateway-2", expectedGatewayGeneration: "gateway-2",
        authoritativeLeaseCount: 1, activeBrowserCount: 1, profileScopedOrphanChromiumCount: 0,
        androidTunnelReady: true, proxyReady: true, activeBrowserProbeFresh: true,
        authenticatedWebhookFresh: true,
        baselineInboundAt: new Date("2026-07-20T10:00:00Z"),
        latestInboundAt: new Date("2026-07-20T10:01:00Z"),
        outboundTunnelProofVerified: true,
        staleOwnerServeRejected: true, staleOwnerReadyRejected: true, staleOwnerCheckpointRejected: true,
        ...overrides,
    };
}

test("canary acceptance requires every ownership, ingress, egress, and profile invariant", () => {
    assert.equal(evaluateDeviceEgressCanaryAcceptance(healthy()).ok, true);
    for (const override of [
        { authoritativeLeaseCount: 2 },
        { activeBrowserCount: 0 },
        { profileScopedOrphanChromiumCount: 1 },
        { gatewayGeneration: "stale" },
        { androidTunnelReady: false },
        { authenticatedWebhookFresh: false },
        { latestInboundAt: new Date("2026-07-20T09:59:00Z") },
        { outboundTunnelProofVerified: false },
        { staleOwnerCheckpointRejected: false },
    ]) assert.equal(evaluateDeviceEgressCanaryAcceptance(healthy(override)).ok, false);
});

test("rollback may decrease generation but never an epoch", () => {
    assert.equal(evaluateDeviceEgressCanaryAcceptance(healthy({
        rollbackRequested: true, rollbackGeneration: 2,
    })).ok, true);
    assert.equal(evaluateDeviceEgressCanaryAcceptance(healthy({
        rollbackRequested: true, rollbackGeneration: 2, authEpoch: 7,
    })).ok, false);
});

test("the complete failure matrix fails closed without server egress", () => {
    assert.equal(DEVICE_EGRESS_FAILURE_SCENARIOS.length, 22);
    for (const scenario of DEVICE_EGRESS_FAILURE_SCENARIOS) {
        const response = planDeviceEgressFailureResponse(scenario);
        assert.equal(response.failClosed, true, scenario);
        assert.equal(response.serverEgressFallback, false, scenario);
        assert.equal(response.preserveMonotonicEpochs, true, scenario);
    }
    assert.equal(planDeviceEgressFailureResponse("isolated_media_r").preserveBrowser, true);
    assert.equal(planDeviceEgressFailureResponse("primary_and_raw_history_r").restartBrowser, true);
});

test("reassignment increments assignment, lease, and auth fences monotonically", () => {
    assert.deepEqual(buildDeviceEgressReassignment({
        currentNodeId: "node-a", targetNodeId: "node-b", assignmentEpoch: 4, leaseEpoch: 7, authEpoch: 9,
    }), {
        fromNodeId: "node-a", toNodeId: "node-b", assignmentEpoch: 5, minimumLeaseEpoch: 8, minimumAuthEpoch: 10,
    });
    assert.throws(() => buildDeviceEgressReassignment({
        currentNodeId: "node-a", targetNodeId: "node-a", assignmentEpoch: 4, leaseEpoch: 7, authEpoch: 9,
    }));
});
