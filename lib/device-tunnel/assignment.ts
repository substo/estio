import { Prisma } from "@prisma/client";
import {
    buildDeviceTunnelGatewayAssignment,
    selectDeviceTunnelGatewayNode,
    type GatewayNodeCandidate,
} from "./distributed-placement";
import { validateDeviceTunnelGatewayUrl } from "./gateway-url";

export const DEFAULT_DEVICE_TUNNEL_NODE_HEARTBEAT_TIMEOUT_MS = 45_000;

type AssignmentBinding = {
    id: string;
    locationId: string;
    deviceId: string;
    sessionId: string;
    gatewayNodeId: string | null;
    assignmentEpoch: number;
    assignedAt: Date | null;
};

type AssignmentNode = GatewayNodeCandidate & { publicUrl: string | null };

export type DeviceTunnelAssignment = AssignmentBinding & {
    gatewayNodeId: string;
    assignmentEpoch: number;
    assignedAt: Date | null;
    gatewayNode: AssignmentNode & { publicUrl: string };
};

type AssignmentTransaction = {
    $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
    deviceTunnelGatewayNode: {
        findMany(args: unknown): Promise<AssignmentNode[]>;
    };
    deviceTunnelBinding: {
        update(args: unknown): Promise<AssignmentBinding & { assignedAt: Date | null }>;
    };
};

export type DeviceTunnelAssignmentDb = AssignmentTransaction & {
    $transaction<T>(fn: (tx: AssignmentTransaction) => Promise<T>): Promise<T>;
};

export async function assignDeviceTunnelBindingToGateway(args: {
    db: DeviceTunnelAssignmentDb;
    bindingId: string;
    region?: string | null;
    now?: Date;
    heartbeatTimeoutMs?: number;
    productionUrls?: boolean;
}): Promise<DeviceTunnelAssignment> {
    const now = args.now || new Date();
    const heartbeatTimeoutMs = args.heartbeatTimeoutMs ?? DEFAULT_DEVICE_TUNNEL_NODE_HEARTBEAT_TIMEOUT_MS;
    if (!args.bindingId || !Number.isSafeInteger(heartbeatTimeoutMs) || heartbeatTimeoutMs < 1_000) {
        throw new Error("Device tunnel assignment input is invalid");
    }

    return args.db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<AssignmentBinding[]>(Prisma.sql`
            SELECT "id", "locationId", "deviceId", "sessionId", "gatewayNodeId", "assignmentEpoch", "assignedAt"
            FROM "DeviceTunnelBinding"
            WHERE "id" = ${args.bindingId}
            FOR UPDATE
        `);
        const binding = locked[0];
        if (!binding) throw new Error("Device tunnel binding no longer exists");

        const nodes = await tx.deviceTunnelGatewayNode.findMany({
            where: args.region ? { region: args.region } : undefined,
            select: {
                id: true,
                region: true,
                publicUrl: true,
                status: true,
                capacitySessions: true,
                activeSessions: true,
                lastHeartbeatAt: true,
            },
        });
        const routableNodes = nodes.flatMap((node) => {
            try {
                return [{ ...node, publicUrl: validateDeviceTunnelGatewayUrl(node.publicUrl || "", args.productionUrls) }];
            } catch {
                return [];
            }
        });
        const selectedCandidate = selectDeviceTunnelGatewayNode({
            nodes: routableNodes,
            now,
            heartbeatTimeoutMs,
            region: args.region,
            currentNodeId: binding.gatewayNodeId,
        });
        if (!selectedCandidate) throw new Error("No healthy device tunnel gateway has available capacity");
        const selected = routableNodes.find((node) => node.id === selectedCandidate.id)!;

        if (binding.gatewayNodeId === selected.id) {
            return {
                ...binding,
                gatewayNodeId: selected.id,
                gatewayNode: selected,
            };
        }

        const assignment = buildDeviceTunnelGatewayAssignment({
            currentEpoch: binding.assignmentEpoch,
            gatewayNodeId: selected.id,
            assignedAt: now,
        });
        const updated = await tx.deviceTunnelBinding.update({
            where: { id: binding.id },
            data: assignment,
            select: {
                id: true,
                locationId: true,
                deviceId: true,
                sessionId: true,
                gatewayNodeId: true,
                assignmentEpoch: true,
                assignedAt: true,
            },
        });
        return {
            ...updated,
            gatewayNodeId: selected.id,
            gatewayNode: selected,
        };
    });
}
