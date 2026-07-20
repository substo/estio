import type { DeviceTunnelTokenPayload } from "./auth";

type GatewayAuthorizationDb = {
    deviceTunnelBinding: {
        findFirst(args: unknown): Promise<any>;
    };
};

export async function authorizeDeviceTunnelGatewayConnection(args: {
    db: GatewayAuthorizationDb;
    token: DeviceTunnelTokenPayload;
    gatewayNodeId: string;
    distributedPlacement: boolean;
    now?: Date;
    heartbeatTimeoutMs?: number;
}) {
    if (args.token.nodeId !== args.gatewayNodeId) throw new Error("Tunnel token belongs to another gateway node");
    const heartbeatCutoff = new Date((args.now || new Date()).getTime() - (args.heartbeatTimeoutMs ?? 45_000));
    const binding = await args.db.deviceTunnelBinding.findFirst({
        where: {
            id: args.token.bindingId,
            deviceId: args.token.deviceId,
            locationId: args.token.locationId,
            sessionId: args.token.sessionId,
            assignmentEpoch: args.token.assignmentEpoch,
            desiredState: "active",
            ...(args.distributedPlacement ? {
                gatewayNodeId: args.gatewayNodeId,
                gatewayNode: {
                    status: "online",
                    lastHeartbeatAt: { gte: heartbeatCutoff },
                },
            } : {}),
            device: {
                id: args.token.deviceId,
                locationId: args.token.locationId,
                paired: true,
                deviceApiTokenHash: { not: null },
                tunnelRevokedAt: null,
                tunnelCredentialVersion: args.token.credentialVersion,
                capabilities: { has: "whatsapp_egress" },
            },
            session: {
                id: args.token.sessionId,
                locationId: args.token.locationId,
                egressMode: "device_tunnel",
            },
        },
        include: { session: { select: { id: true, sessionId: true, egressMode: true } } },
    });
    if (!binding) throw new Error("Tunnel token no longer matches its authorized binding");
    return binding;
}
