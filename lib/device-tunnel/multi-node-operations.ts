export const DEVICE_EGRESS_ALLOWED_OPERATIONAL_ERROR_CODES = new Set([
    "archive_corrupt",
    "archive_digest_mismatch",
    "archive_path_invalid",
    "auth_tag_invalid",
    "bridge_operation_failed",
    "attach_deadline_expired",
    "detach_deadline_expired",
    "gateway_generation_stale",
    "kms_unavailable",
    "lease_lost",
    "profile_lock_held",
    "r2_get_failed",
    "r2_put_failed",
    "r2_readback_failed",
    "relink_required",
    "rollback_failed",
    "runtime_fenced",
    "tunnel_disconnected",
    "webhook_stale",
    "wrong_node",
]);

export type DeviceEgressCanaryObservation = {
    nodeId: string;
    expectedNodeId: string;
    assignmentEpoch: number;
    previousAssignmentEpoch: number;
    leaseEpoch: number;
    previousLeaseEpoch: number;
    authEpoch: number;
    previousAuthEpoch: number;
    authGeneration: number;
    restoredGeneration: number;
    gatewayGeneration: string;
    expectedGatewayGeneration: string;
    authoritativeLeaseCount: number;
    activeBrowserCount: number;
    profileScopedOrphanChromiumCount: number;
    androidTunnelReady: boolean;
    proxyReady: boolean;
    activeBrowserProbeFresh: boolean;
    authenticatedWebhookFresh: boolean;
    latestInboundAt: Date | null;
    baselineInboundAt: Date | null;
    outboundTunnelProofVerified: boolean;
    staleOwnerServeRejected: boolean;
    staleOwnerReadyRejected: boolean;
    staleOwnerCheckpointRejected: boolean;
    rollbackRequested?: boolean;
    rollbackGeneration?: number | null;
    errorCode?: string | null;
};

export type DeviceEgressAcceptanceCheck = { code: string; ok: boolean };

export function evaluateDeviceEgressCanaryAcceptance(observation: DeviceEgressCanaryObservation) {
    const monotonicEpochs = observation.assignmentEpoch >= observation.previousAssignmentEpoch
        && observation.leaseEpoch >= observation.previousLeaseEpoch
        && observation.authEpoch >= observation.previousAuthEpoch;
    const rollbackValid = !observation.rollbackRequested || Boolean(
        observation.rollbackGeneration
        && observation.rollbackGeneration < observation.authGeneration
        && monotonicEpochs
    );
    const checks: DeviceEgressAcceptanceCheck[] = [
        { code: "authoritative_node", ok: observation.nodeId === observation.expectedNodeId },
        { code: "one_authoritative_lease", ok: observation.authoritativeLeaseCount === 1 },
        { code: "one_active_browser", ok: observation.activeBrowserCount === 1 },
        { code: "no_profile_orphans", ok: observation.profileScopedOrphanChromiumCount === 0 },
        { code: "current_gateway_generation", ok: Boolean(observation.gatewayGeneration) && observation.gatewayGeneration === observation.expectedGatewayGeneration },
        { code: "android_tunnel_and_proxy", ok: observation.androidTunnelReady && observation.proxyReady },
        { code: "durable_generation_restored", ok: observation.authGeneration > 0 && observation.restoredGeneration === observation.authGeneration },
        { code: "epochs_monotonic", ok: monotonicEpochs },
        { code: "active_browser_probe", ok: observation.activeBrowserProbeFresh },
        { code: "authenticated_webhook_fresh", ok: observation.authenticatedWebhookFresh },
        {
            code: "latest_inbound_advanced",
            ok: Boolean(observation.latestInboundAt && observation.baselineInboundAt && observation.latestInboundAt > observation.baselineInboundAt),
        },
        { code: "outbound_android_tunnel_proof", ok: observation.outboundTunnelProofVerified },
        {
            code: "stale_owner_fenced",
            ok: observation.staleOwnerServeRejected && observation.staleOwnerReadyRejected && observation.staleOwnerCheckpointRejected,
        },
        { code: "rollback_generation_and_epochs", ok: rollbackValid },
        {
            code: "allowlisted_error_code",
            ok: !observation.errorCode || DEVICE_EGRESS_ALLOWED_OPERATIONAL_ERROR_CODES.has(observation.errorCode),
        },
    ];
    return { ok: checks.every((check) => check.ok), checks };
}

export const DEVICE_EGRESS_FAILURE_SCENARIOS = [
    "planned_drain",
    "abrupt_gateway_crash",
    "abrupt_bridge_browser_crash",
    "node_loss",
    "reassignment",
    "lease_loss_during_attach",
    "lease_loss_during_detach",
    "gateway_generation_replacement",
    "android_disconnect_reconnect",
    "r2_put_failure",
    "r2_readback_failure",
    "kms_wrap_unwrap_failure",
    "archive_integrity_failure",
    "profile_lock_orphan",
    "attach_detach_deadline_expiry",
    "current_generation_corrupt",
    "all_generations_unusable",
    "operator_rollback",
    "rollback_failure",
    "application_release_rollback",
    "primary_and_raw_history_r",
    "isolated_media_r",
] as const;

export type DeviceEgressFailureScenario = typeof DEVICE_EGRESS_FAILURE_SCENARIOS[number];

export function planDeviceEgressFailureResponse(scenario: DeviceEgressFailureScenario) {
    const relink = scenario === "all_generations_unusable" || scenario === "rollback_failure";
    const restartBrowser = new Set<DeviceEgressFailureScenario>([
        "abrupt_gateway_crash",
        "abrupt_bridge_browser_crash",
        "node_loss",
        "reassignment",
        "gateway_generation_replacement",
        "android_disconnect_reconnect",
        "application_release_rollback",
        "primary_and_raw_history_r",
    ]).has(scenario);
    const preserveBrowser = scenario === "isolated_media_r";
    return {
        scenario,
        failClosed: true,
        serverEgressFallback: false,
        fenceBeforeReplacement: !preserveBrowser,
        checkpointOnlyIfHealthyAndAuthoritative: scenario === "planned_drain" || scenario === "operator_rollback",
        restartBrowser,
        preserveBrowser,
        requireRelink: relink,
        preserveMonotonicEpochs: true,
    };
}

export function buildDeviceEgressReassignment(args: {
    currentNodeId: string;
    targetNodeId: string;
    assignmentEpoch: number;
    leaseEpoch: number;
    authEpoch: number;
}) {
    if (!args.currentNodeId || !args.targetNodeId || args.currentNodeId === args.targetNodeId) {
        throw new Error("Device egress reassignment requires two distinct stable node IDs");
    }
    for (const [name, value] of Object.entries({
        assignment: args.assignmentEpoch,
        lease: args.leaseEpoch,
        auth: args.authEpoch,
    })) {
        if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
            throw new Error(`Device egress ${name} epoch is invalid or exhausted`);
        }
    }
    return {
        fromNodeId: args.currentNodeId,
        toNodeId: args.targetNodeId,
        assignmentEpoch: args.assignmentEpoch + 1,
        minimumLeaseEpoch: Math.max(args.leaseEpoch + 1, args.assignmentEpoch + 1),
        minimumAuthEpoch: Math.max(args.authEpoch + 1, args.leaseEpoch + 1, args.assignmentEpoch + 1),
    };
}
