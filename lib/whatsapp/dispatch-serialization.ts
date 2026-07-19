import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

const RELEASE_REDIS_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type WhatsAppDispatchLock = {
    scopeKey: string;
    locationId: string;
    ownerId: string;
    outboxId: string;
    acquiredAt: Date;
    renewedAt: Date;
    expiresAt: Date;
};

export type WhatsAppRedisDispatchLockStore = {
    acquire(args: { scopeKey: string; token: string; ttlMs: number }): Promise<boolean>;
    release(args: { scopeKey: string; token: string }): Promise<boolean>;
};

export type WhatsAppDatabaseDispatchLockStore = {
    acquire(args: WhatsAppDispatchLock): Promise<boolean>;
    release(args: Pick<WhatsAppDispatchLock, "scopeKey" | "locationId" | "ownerId" | "outboxId">): Promise<boolean>;
};

export type WhatsAppDispatchGuard = {
    scopeKey: string;
    locationId: string;
    ownerId: string;
    outboxId: string;
    redisToken: string;
};

let redisPromise: Promise<any> | null = null;

function redisScopeKey(scopeKey: string) {
    const digest = createHash("sha256").update(scopeKey).digest("hex").slice(0, 24);
    return `wa:dispatch-lock:v1:${digest}`;
}

export function createRedisWhatsAppDispatchLockStore(redis: {
    set(key: string, value: string, millisecondsToken: "PX", milliseconds: number, nx: "NX"): Promise<"OK" | null>;
    eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}): WhatsAppRedisDispatchLockStore {
    return {
        async acquire(args) {
            return await redis.set(redisScopeKey(args.scopeKey), args.token, "PX", args.ttlMs, "NX") === "OK";
        },
        async release(args) {
            return Number(await redis.eval(RELEASE_REDIS_LOCK_SCRIPT, 1, redisScopeKey(args.scopeKey), args.token)) === 1;
        },
    };
}

export function createPrismaWhatsAppDispatchLockStore(prisma: {
    $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
    whatsAppOutboundDispatchLock: { deleteMany(args: unknown): Promise<{ count: number }> };
}): WhatsAppDatabaseDispatchLockStore {
    return {
        async acquire(args) {
            const rows = await prisma.$queryRaw<Array<{ scopeKey: string }>>(Prisma.sql`
                INSERT INTO "WhatsAppOutboundDispatchLock" (
                    "scopeKey", "locationId", "ownerId", "outboxId", "acquiredAt", "renewedAt", "expiresAt"
                ) VALUES (
                    ${args.scopeKey}, ${args.locationId}, ${args.ownerId}, ${args.outboxId}, ${args.acquiredAt}, ${args.renewedAt}, ${args.expiresAt}
                )
                ON CONFLICT ("scopeKey") DO UPDATE SET
                    "locationId" = EXCLUDED."locationId",
                    "ownerId" = EXCLUDED."ownerId",
                    "outboxId" = EXCLUDED."outboxId",
                    "acquiredAt" = EXCLUDED."acquiredAt",
                    "renewedAt" = EXCLUDED."renewedAt",
                    "expiresAt" = EXCLUDED."expiresAt"
                WHERE "WhatsAppOutboundDispatchLock"."expiresAt" <= ${args.acquiredAt}
                   OR (
                       "WhatsAppOutboundDispatchLock"."locationId" = ${args.locationId}
                       AND "WhatsAppOutboundDispatchLock"."ownerId" = ${args.ownerId}
                       AND "WhatsAppOutboundDispatchLock"."outboxId" = ${args.outboxId}
                   )
                RETURNING "scopeKey"
            `);
            return rows.length === 1;
        },
        async release(args) {
            const result = await prisma.whatsAppOutboundDispatchLock.deleteMany({
                where: {
                    scopeKey: args.scopeKey,
                    locationId: args.locationId,
                    ownerId: args.ownerId,
                    outboxId: args.outboxId,
                },
            });
            return result.count === 1;
        },
    };
}

export async function acquireWhatsAppDispatchGuard(args: {
    redisStore: WhatsAppRedisDispatchLockStore;
    databaseStore: WhatsAppDatabaseDispatchLockStore;
    scopeKey: string;
    locationId: string;
    outboxId: string;
    ownerId: string;
    ttlMs: number;
    now?: Date;
}): Promise<WhatsAppDispatchGuard | null> {
    const now = args.now || new Date();
    const redisToken = randomUUID();
    const redisAcquired = await args.redisStore.acquire({ scopeKey: args.scopeKey, token: redisToken, ttlMs: args.ttlMs });
    if (!redisAcquired) return null;

    try {
        const databaseAcquired = await args.databaseStore.acquire({
            scopeKey: args.scopeKey,
            locationId: args.locationId,
            ownerId: args.ownerId,
            outboxId: args.outboxId,
            acquiredAt: now,
            renewedAt: now,
            expiresAt: new Date(now.getTime() + args.ttlMs),
        });
        if (!databaseAcquired) {
            await args.redisStore.release({ scopeKey: args.scopeKey, token: redisToken }).catch(() => false);
            return null;
        }
        return {
            scopeKey: args.scopeKey,
            locationId: args.locationId,
            ownerId: args.ownerId,
            outboxId: args.outboxId,
            redisToken,
        };
    } catch (error) {
        await args.redisStore.release({ scopeKey: args.scopeKey, token: redisToken }).catch(() => false);
        throw error;
    }
}

export async function releaseWhatsAppDispatchGuard(args: {
    guard: WhatsAppDispatchGuard;
    redisStore: WhatsAppRedisDispatchLockStore;
    databaseStore: WhatsAppDatabaseDispatchLockStore;
}) {
    const databaseReleased = await args.databaseStore.release(args.guard).catch(() => false);
    const redisReleased = await args.redisStore.release({
        scopeKey: args.guard.scopeKey,
        token: args.guard.redisToken,
    }).catch(() => false);
    return { databaseReleased, redisReleased };
}

export async function getWhatsAppRedisDispatchLockStore(): Promise<WhatsAppRedisDispatchLockStore> {
    if (!redisPromise) {
        redisPromise = (async () => {
            const Redis = (await import("ioredis")).default;
            const redis = new Redis({
                host: process.env.REDIS_HOST || "127.0.0.1",
                port: Number(process.env.REDIS_PORT || 6379),
                lazyConnect: true,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: 2_000,
            });
            await redis.connect();
            return redis;
        })();
    }
    try {
        return createRedisWhatsAppDispatchLockStore(await redisPromise);
    } catch (error) {
        redisPromise = null;
        throw error;
    }
}
