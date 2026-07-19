import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

export type DeviceTunnelSessionLeaseRecord = {
    id: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId: string;
    ownerInstanceId: string;
    epoch: number;
    acquiredAt: Date;
    renewedAt: Date;
    expiresAt: Date;
    state: string;
};

export type DeviceTunnelLeaseScope = {
    locationId: string;
    sessionId: string;
    bindingId: string;
    gatewayNodeId: string;
    assignmentEpoch: number;
};

export type DeviceTunnelLeaseStore = {
    acquire(args: DeviceTunnelLeaseScope & {
        leaseId: string;
        ownerInstanceId: string;
        now: Date;
        expiresAt: Date;
    }): Promise<DeviceTunnelSessionLeaseRecord | null>;
    renew(args: DeviceTunnelLeaseScope & {
        ownerInstanceId: string;
        epoch: number;
        now: Date;
        expiresAt: Date;
    }): Promise<DeviceTunnelSessionLeaseRecord | null>;
    expire(args: DeviceTunnelLeaseScope & {
        ownerInstanceId: string;
        epoch: number;
        now: Date;
    }): Promise<boolean>;
};

function leaseExpiry(now: Date, ttlMs: number) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000) {
        throw new Error("Device tunnel lease TTL must be at least 1000ms");
    }
    return new Date(now.getTime() + ttlMs);
}

function validateScope(scope: DeviceTunnelLeaseScope) {
    if (!scope.locationId || !scope.sessionId || !scope.bindingId || !scope.gatewayNodeId) {
        throw new Error("Device tunnel lease scope is incomplete");
    }
    if (!Number.isSafeInteger(scope.assignmentEpoch) || scope.assignmentEpoch < 1) {
        throw new Error("Device tunnel lease requires a positive assignment epoch");
    }
}

export async function acquireDeviceTunnelSessionLease(args: DeviceTunnelLeaseScope & {
    store: DeviceTunnelLeaseStore;
    ownerInstanceId: string;
    ttlMs: number;
    now?: Date;
}) {
    validateScope(args);
    if (!args.ownerInstanceId) throw new Error("Device tunnel lease owner is required");
    const now = args.now || new Date();
    return args.store.acquire({
        locationId: args.locationId,
        sessionId: args.sessionId,
        bindingId: args.bindingId,
        gatewayNodeId: args.gatewayNodeId,
        assignmentEpoch: args.assignmentEpoch,
        ownerInstanceId: args.ownerInstanceId,
        leaseId: randomUUID(),
        now,
        expiresAt: leaseExpiry(now, args.ttlMs),
    });
}

export async function renewDeviceTunnelSessionLease(args: DeviceTunnelLeaseScope & {
    store: DeviceTunnelLeaseStore;
    ownerInstanceId: string;
    epoch: number;
    ttlMs: number;
    now?: Date;
}) {
    validateScope(args);
    if (!args.ownerInstanceId || !Number.isSafeInteger(args.epoch) || args.epoch < 1) {
        throw new Error("Device tunnel lease owner and epoch are required for renewal");
    }
    const now = args.now || new Date();
    return args.store.renew({
        locationId: args.locationId,
        sessionId: args.sessionId,
        bindingId: args.bindingId,
        gatewayNodeId: args.gatewayNodeId,
        assignmentEpoch: args.assignmentEpoch,
        ownerInstanceId: args.ownerInstanceId,
        epoch: args.epoch,
        now,
        expiresAt: leaseExpiry(now, args.ttlMs),
    });
}

export async function expireDeviceTunnelSessionLease(args: DeviceTunnelLeaseScope & {
    store: DeviceTunnelLeaseStore;
    ownerInstanceId: string;
    epoch: number;
    now?: Date;
}) {
    validateScope(args);
    if (!args.ownerInstanceId || !Number.isSafeInteger(args.epoch) || args.epoch < 1) {
        throw new Error("Device tunnel lease owner and epoch are required for expiry");
    }
    return args.store.expire({
        locationId: args.locationId,
        sessionId: args.sessionId,
        bindingId: args.bindingId,
        gatewayNodeId: args.gatewayNodeId,
        assignmentEpoch: args.assignmentEpoch,
        ownerInstanceId: args.ownerInstanceId,
        epoch: args.epoch,
        now: args.now || new Date(),
    });
}

export function createPrismaDeviceTunnelLeaseStore(prisma: {
    $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}): DeviceTunnelLeaseStore {
    return {
        async acquire(args) {
            const rows = await prisma.$queryRaw<DeviceTunnelSessionLeaseRecord[]>(Prisma.sql`
                WITH eligible AS (
                    SELECT binding."id", binding."sessionId", binding."assignmentEpoch"
                    FROM "DeviceTunnelBinding" AS binding
                    INNER JOIN "DeviceTunnelGatewayNode" AS node ON node."id" = binding."gatewayNodeId"
                    WHERE binding."id" = ${args.bindingId}
                      AND binding."sessionId" = ${args.sessionId}
                      AND binding."locationId" = ${args.locationId}
                      AND binding."gatewayNodeId" = ${args.gatewayNodeId}
                      AND binding."assignmentEpoch" = ${args.assignmentEpoch}
                      AND binding."desiredState" = 'active'
                      AND node."status" = 'online'
                ), inserted AS (
                    INSERT INTO "DeviceTunnelSessionLease" (
                        "id", "createdAt", "updatedAt", "sessionId", "bindingId", "gatewayNodeId",
                        "ownerInstanceId", "epoch", "acquiredAt", "renewedAt", "expiresAt", "state"
                    )
                    SELECT ${args.leaseId}, ${args.now}, ${args.now}, eligible."sessionId", eligible."id", ${args.gatewayNodeId},
                           ${args.ownerInstanceId}, GREATEST(eligible."assignmentEpoch", 1), ${args.now}, ${args.now}, ${args.expiresAt}, 'active'
                    FROM eligible
                    ON CONFLICT ("sessionId") DO NOTHING
                    RETURNING *
                ), taken_over AS (
                    UPDATE "DeviceTunnelSessionLease" AS lease
                    SET "updatedAt" = ${args.now},
                        "gatewayNodeId" = ${args.gatewayNodeId},
                        "ownerInstanceId" = ${args.ownerInstanceId},
                        "epoch" = GREATEST(lease."epoch" + 1, eligible."assignmentEpoch", 1),
                        "acquiredAt" = ${args.now},
                        "renewedAt" = ${args.now},
                        "expiresAt" = ${args.expiresAt},
                        "state" = 'active'
                    FROM eligible
                    WHERE lease."sessionId" = eligible."sessionId"
                      AND lease."bindingId" = eligible."id"
                      AND (lease."expiresAt" <= ${args.now} OR lease."state" = 'expired')
                      AND NOT EXISTS (SELECT 1 FROM inserted)
                    RETURNING lease.*
                )
                SELECT * FROM inserted
                UNION ALL
                SELECT * FROM taken_over
                LIMIT 1
            `);
            return rows[0] || null;
        },

        async renew(args) {
            const rows = await prisma.$queryRaw<DeviceTunnelSessionLeaseRecord[]>(Prisma.sql`
                UPDATE "DeviceTunnelSessionLease" AS lease
                SET "updatedAt" = ${args.now}, "renewedAt" = ${args.now}, "expiresAt" = ${args.expiresAt}
                FROM "DeviceTunnelBinding" AS binding
                INNER JOIN "DeviceTunnelGatewayNode" AS node ON node."id" = binding."gatewayNodeId"
                WHERE lease."sessionId" = ${args.sessionId}
                  AND lease."bindingId" = ${args.bindingId}
                  AND lease."gatewayNodeId" = ${args.gatewayNodeId}
                  AND lease."ownerInstanceId" = ${args.ownerInstanceId}
                  AND lease."epoch" = ${args.epoch}
                  AND lease."state" = 'active'
                  AND lease."expiresAt" > ${args.now}
                  AND binding."id" = lease."bindingId"
                  AND binding."sessionId" = lease."sessionId"
                  AND binding."locationId" = ${args.locationId}
                  AND binding."gatewayNodeId" = lease."gatewayNodeId"
                  AND binding."assignmentEpoch" = ${args.assignmentEpoch}
                  AND binding."desiredState" = 'active'
                  AND node."status" = 'online'
                RETURNING lease.*
            `);
            return rows[0] || null;
        },

        async expire(args) {
            const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                UPDATE "DeviceTunnelSessionLease" AS lease
                SET "updatedAt" = ${args.now}, "renewedAt" = ${args.now}, "expiresAt" = ${args.now}, "state" = 'expired'
                FROM "DeviceTunnelBinding" AS binding
                WHERE lease."sessionId" = ${args.sessionId}
                  AND lease."bindingId" = ${args.bindingId}
                  AND lease."gatewayNodeId" = ${args.gatewayNodeId}
                  AND lease."ownerInstanceId" = ${args.ownerInstanceId}
                  AND lease."epoch" = ${args.epoch}
                  AND lease."state" IN ('acquiring', 'active', 'draining')
                  AND binding."id" = lease."bindingId"
                  AND binding."sessionId" = lease."sessionId"
                  AND binding."locationId" = ${args.locationId}
                  AND binding."gatewayNodeId" = lease."gatewayNodeId"
                  AND binding."assignmentEpoch" = ${args.assignmentEpoch}
                RETURNING lease."id"
            `);
            return rows.length === 1;
        },
    };
}
