import assert from "node:assert/strict";
import test from "node:test";
import {
    acquireWhatsAppDispatchGuard,
    releaseWhatsAppDispatchGuard,
    type WhatsAppDatabaseDispatchLockStore,
    type WhatsAppDispatchLock,
    type WhatsAppRedisDispatchLockStore,
} from "./dispatch-serialization";

class MemoryRedisLockStore implements WhatsAppRedisDispatchLockStore {
    token: string | null = null;
    async acquire(args: { token: string }) {
        if (this.token) return false;
        this.token = args.token;
        return true;
    }
    async release(args: { token: string }) {
        if (this.token !== args.token) return false;
        this.token = null;
        return true;
    }
}

class MemoryDatabaseLockStore implements WhatsAppDatabaseDispatchLockStore {
    lock: WhatsAppDispatchLock | null = null;
    private queue = Promise.resolve();
    private serial<T>(operation: () => T): Promise<T> {
        const result = this.queue.then(operation, operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }
    acquire(args: WhatsAppDispatchLock) {
        return this.serial(() => {
            if (this.lock && this.lock.expiresAt > args.acquiredAt) return false;
            this.lock = args;
            return true;
        });
    }
    release(args: Pick<WhatsAppDispatchLock, "scopeKey" | "locationId" | "ownerId" | "outboxId">) {
        return this.serial(() => {
            if (!this.lock || this.lock.scopeKey !== args.scopeKey || this.lock.ownerId !== args.ownerId || this.lock.outboxId !== args.outboxId) return false;
            this.lock = null;
            return true;
        });
    }
}

test("concurrent workers serialize provider dispatch for one session", async () => {
    const redisStore = new MemoryRedisLockStore();
    const databaseStore = new MemoryDatabaseLockStore();
    const base = {
        redisStore,
        databaseStore,
        scopeKey: "web-session:session-1",
        locationId: "location-1",
        outboxId: "outbox-1",
        ttlMs: 300_000,
        now: new Date("2026-07-19T12:00:00.000Z"),
    };
    const [first, second] = await Promise.all([
        acquireWhatsAppDispatchGuard({ ...base, ownerId: "worker-a" }),
        acquireWhatsAppDispatchGuard({ ...base, ownerId: "worker-b", outboxId: "outbox-2" }),
    ]);
    assert.equal(Number(Boolean(first)) + Number(Boolean(second)), 1);

    const winner = first || second;
    assert.ok(winner);
    await releaseWhatsAppDispatchGuard({ guard: winner, redisStore, databaseStore });
    const next = await acquireWhatsAppDispatchGuard({ ...base, ownerId: "worker-c", outboxId: "outbox-3" });
    assert.ok(next);
});

test("Redis acquisition failure does not create a database lock", async () => {
    const redisStore: WhatsAppRedisDispatchLockStore = {
        acquire: async () => false,
        release: async () => false,
    };
    const databaseStore = new MemoryDatabaseLockStore();
    const guard = await acquireWhatsAppDispatchGuard({
        redisStore,
        databaseStore,
        scopeKey: "web-session:session-1",
        locationId: "location-1",
        outboxId: "outbox-1",
        ownerId: "worker-a",
        ttlMs: 300_000,
    });
    assert.equal(guard, null);
    assert.equal(databaseStore.lock, null);
});
