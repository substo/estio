export const DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT_FLAG = "DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT";

export type GatewayNodeCandidate = {
    id: string;
    region: string;
    status: string;
    capacitySessions: number;
    activeSessions: number;
    lastHeartbeatAt: Date;
};

export function isDistributedDeviceTunnelPlacementEnabled(env: NodeJS.ProcessEnv = process.env) {
    return String(env[DEVICE_TUNNEL_DISTRIBUTED_PLACEMENT_FLAG] || "").trim().toLowerCase() === "true";
}

export function nextAssignmentEpoch(currentEpoch: number) {
    if (!Number.isSafeInteger(currentEpoch) || currentEpoch < 0 || currentEpoch >= Number.MAX_SAFE_INTEGER) {
        throw new Error("Device tunnel assignment epoch is invalid or exhausted");
    }
    return currentEpoch + 1;
}

export function buildDeviceTunnelGatewayAssignment(args: {
    currentEpoch: number;
    gatewayNodeId: string;
    assignedAt: Date;
}) {
    if (!args.gatewayNodeId) throw new Error("Device tunnel gateway node ID is required for assignment");
    return {
        gatewayNodeId: args.gatewayNodeId,
        assignmentEpoch: nextAssignmentEpoch(args.currentEpoch),
        assignedAt: args.assignedAt,
        desiredState: "active" as const,
        drainRequestedAt: null,
    };
}

export function selectDeviceTunnelGatewayNode(args: {
    nodes: GatewayNodeCandidate[];
    now: Date;
    heartbeatTimeoutMs: number;
    region?: string | null;
    currentNodeId?: string | null;
}) {
    const cutoff = args.now.getTime() - args.heartbeatTimeoutMs;
    const eligible = args.nodes.filter((node) => (
        node.status === "online"
        && node.lastHeartbeatAt.getTime() >= cutoff
        && node.capacitySessions > 0
        && node.activeSessions < node.capacitySessions
        && (!args.region || node.region === args.region)
    ));

    const current = eligible.find((node) => node.id === args.currentNodeId);
    if (current) return current;

    return eligible.sort((left, right) => {
        const loadDifference = (left.activeSessions / left.capacitySessions) - (right.activeSessions / right.capacitySessions);
        if (loadDifference !== 0) return loadDifference;
        if (left.activeSessions !== right.activeSessions) return left.activeSessions - right.activeSessions;
        return left.id.localeCompare(right.id);
    })[0] || null;
}
