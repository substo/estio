import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
    CronGuard,
    createRedisCronDistributedLockStore,
    type CronDistributedLockStore,
} from "./guard";

class MemoryDistributedLockStore implements CronDistributedLockStore {
    token: string | null = null;
    ttlMs: number | null = null;

    async acquire(args: { token: string; ttlMs: number }) {
        if (this.token) return false;
        this.token = args.token;
        this.ttlMs = args.ttlMs;
        return true;
    }

    async release(args: { token: string }) {
        if (this.token !== args.token) return false;
        this.token = null;
        return true;
    }
}

async function tempLockDir(t: test.TestContext, name: string): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `cron-guard-${name}-`));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return directory;
}

test("local lock acquisition is atomic for concurrent guards", async (t) => {
    const lockDir = await tempLockDir(t, "local");
    const first = new CronGuard("job", { lockDir });
    const second = new CronGuard("job", { lockDir });

    const results = await Promise.all([first.acquire(), second.acquire()]);
    assert.equal(results.filter(Boolean).length, 1);

    await first.release();
    await second.release();
});

test("distributed locking serializes guards on separate hosts", async (t) => {
    const firstLockDir = await tempLockDir(t, "host-a");
    const secondLockDir = await tempLockDir(t, "host-b");
    const store = new MemoryDistributedLockStore();
    const first = new CronGuard("purge-trash", {
        distributed: true,
        ttlMs: 600_000,
        lockDir: firstLockDir,
        distributedStore: store,
    });
    const second = new CronGuard("purge-trash", {
        distributed: true,
        ttlMs: 600_000,
        lockDir: secondLockDir,
        distributedStore: store,
    });

    assert.equal(await first.acquire(), true);
    assert.equal(await second.acquire(), false);
    assert.equal(second.getLastAcquireFailureReason(), "distributed_locked");
    assert.equal(store.ttlMs, 600_000);

    await first.release();
    assert.equal(await second.acquire(), true);
    await second.release();
});

test("distributed lock failure releases the local lock and fails closed", async (t) => {
    const lockDir = await tempLockDir(t, "failure");
    const unavailableStore: CronDistributedLockStore = {
        acquire: async () => { throw new Error("Redis unavailable"); },
        release: async () => false,
    };
    const distributed = new CronGuard("purge-trash", {
        distributed: true,
        lockDir,
        distributedStore: unavailableStore,
    });

    assert.equal(await distributed.acquire(), false);
    assert.equal(distributed.getLastAcquireFailureReason(), "distributed_unavailable");

    const local = new CronGuard("purge-trash", { lockDir });
    assert.equal(await local.acquire(), true);
    await local.release();
});

test("Redis release cannot remove a lock owned by another token", async () => {
    let token: string | null = null;
    const redis = {
        async set(_key: string, value: string) {
            if (token) return null;
            token = value;
            return "OK" as const;
        },
        async eval(_script: string, _keyCount: number, _key: string, candidate: string) {
            if (token !== candidate) return 0;
            token = null;
            return 1;
        },
    };
    const store = createRedisCronDistributedLockStore(redis);

    assert.equal(await store.acquire({ key: "cron", token: "owner-a", ttlMs: 60_000 }), true);
    assert.equal(await store.release({ key: "cron", token: "owner-b" }), false);
    assert.equal(await store.acquire({ key: "cron", token: "owner-c", ttlMs: 60_000 }), false);
    assert.equal(await store.release({ key: "cron", token: "owner-a" }), true);
});
