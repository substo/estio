type GatewayNodeRegistryClient = {
    deviceTunnelGatewayNode: {
        findUnique(args: unknown): Promise<{ status: string } | null>;
        create(args: unknown): Promise<unknown>;
        updateMany(args: unknown): Promise<{ count: number }>;
    };
};

export type GatewayNodeRegistration = {
    id: string;
    region: string;
    publicUrl: string | null;
    internalUrl: string | null;
    capacitySessions: number;
    version: string | null;
    startedAt: Date;
    metadata?: Record<string, string> | null;
};

export async function registerDeviceTunnelGatewayNode(
    db: GatewayNodeRegistryClient,
    registration: GatewayNodeRegistration,
    now = new Date(),
) {
    if (!registration.id) throw new Error("Device tunnel gateway node ID is required");
    if (!Number.isSafeInteger(registration.capacitySessions) || registration.capacitySessions < 1) {
        throw new Error("Device tunnel gateway capacity must be a positive integer");
    }
    const existing = await db.deviceTunnelGatewayNode.findUnique({
        where: { id: registration.id },
        select: { status: true },
    });
    if (existing?.status === "quarantined") {
        throw new Error(`Device tunnel gateway node ${registration.id} is quarantined`);
    }
    if (!existing) {
        return db.deviceTunnelGatewayNode.create({
            data: {
                ...registration,
                status: "online",
                activeSessions: 0,
                lastHeartbeatAt: now,
            },
        });
    }
    const updated = await db.deviceTunnelGatewayNode.updateMany({
        where: { id: registration.id, status: { not: "quarantined" } },
        data: {
            region: registration.region,
            publicUrl: registration.publicUrl,
            internalUrl: registration.internalUrl,
            capacitySessions: registration.capacitySessions,
            version: registration.version,
            startedAt: registration.startedAt,
            lastHeartbeatAt: now,
            status: "online",
            activeSessions: 0,
            metadata: registration.metadata,
        },
    });
    if (updated.count !== 1) {
        throw new Error(`Device tunnel gateway node ${registration.id} could not be registered`);
    }
    return updated;
}

export async function heartbeatDeviceTunnelGatewayNode(args: {
    db: GatewayNodeRegistryClient;
    nodeId: string;
    startedAt: Date;
    activeSessions: number;
    now?: Date;
}) {
    const result = await args.db.deviceTunnelGatewayNode.updateMany({
        where: {
            id: args.nodeId,
            startedAt: args.startedAt,
            status: { in: ["online", "draining"] },
        },
        data: {
            activeSessions: Math.max(0, Math.trunc(args.activeSessions)),
            lastHeartbeatAt: args.now || new Date(),
        },
    });
    return result.count === 1;
}

export async function setDeviceTunnelGatewayNodeDrainState(args: {
    db: GatewayNodeRegistryClient;
    nodeId: string;
    startedAt: Date;
    draining: boolean;
    now?: Date;
}) {
    const result = await args.db.deviceTunnelGatewayNode.updateMany({
        where: {
            id: args.nodeId,
            startedAt: args.startedAt,
            status: args.draining ? "online" : "draining",
        },
        data: {
            status: args.draining ? "draining" : "online",
            lastHeartbeatAt: args.now || new Date(),
        },
    });
    return result.count === 1;
}
