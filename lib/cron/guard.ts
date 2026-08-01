import { randomUUID } from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const DEFAULT_LOCK_DIR = '/tmp';
const DEFAULT_LOCK_TTL_MS = 60 * 60 * 1000;
const RELEASE_REDIS_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export type CronDistributedLockStore = {
    acquire(args: { key: string; token: string; ttlMs: number }): Promise<boolean>;
    release(args: { key: string; token: string }): Promise<boolean>;
};

type CronGuardOptions = {
    distributed?: boolean;
    ttlMs?: number;
    lockDir?: string;
    distributedStore?: CronDistributedLockStore;
};

let redisPromise: Promise<any> | null = null;

export function createRedisCronDistributedLockStore(redis: {
    set(key: string, value: string, millisecondsToken: 'PX', milliseconds: number, nx: 'NX'): Promise<'OK' | null>;
    eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}): CronDistributedLockStore {
    return {
        async acquire(args) {
            return await redis.set(args.key, args.token, 'PX', args.ttlMs, 'NX') === 'OK';
        },
        async release(args) {
            return Number(await redis.eval(RELEASE_REDIS_LOCK_SCRIPT, 1, args.key, args.token)) === 1;
        },
    };
}

async function getRedisCronDistributedLockStore(): Promise<CronDistributedLockStore> {
    if (!redisPromise) {
        redisPromise = (async () => {
            const Redis = (await import('ioredis')).default;
            const redis = new Redis({
                host: process.env.REDIS_HOST || '127.0.0.1',
                port: Number(process.env.REDIS_PORT || 6379),
                lazyConnect: true,
                enableOfflineQueue: false,
                maxRetriesPerRequest: 1,
                connectTimeout: 2_000,
                retryStrategy: () => null,
            });
            await redis.connect();
            return redis;
        })();
    }
    try {
        return createRedisCronDistributedLockStore(await redisPromise);
    } catch (error) {
        redisPromise = null;
        throw error;
    }
}

export class CronGuard {
    private jobName: string;
    private lockFile: string;
    private distributedKey: string;
    private ttlMs: number;
    private useDistributedLock: boolean;
    private configuredDistributedStore?: CronDistributedLockStore;
    private activeDistributedStore: CronDistributedLockStore | null = null;
    private lockToken: string | null = null;
    private lastAcquireFailureReason: 'local_locked' | 'distributed_locked' | 'distributed_unavailable' | 'acquire_error' | null = null;

    constructor(jobName: string, options: CronGuardOptions = {}) {
        this.jobName = jobName;
        this.lockFile = path.join(options.lockDir || DEFAULT_LOCK_DIR, `estio-cron-${jobName}.lock`);
        this.distributedKey = `estio:cron-lock:v1:${jobName}`;
        this.ttlMs = Math.max(1_000, Math.floor(Number(options.ttlMs || DEFAULT_LOCK_TTL_MS)));
        this.useDistributedLock = options.distributed === true;
        this.configuredDistributedStore = options.distributedStore;
    }

    /**
     * Checks if system has enough resources to run this job.
     * @param minFreeMB Minimum free RAM in MB (default: 500)
     * @param maxLoad Maximum load average (default: 4.0)
     */
    async checkResources(minFreeMB = 500, maxLoad = 4.0): Promise<{ ok: boolean; reason?: string }> {
        const freeMemMB = os.freemem() / 1024 / 1024;
        const loadAvg = os.loadavg()[0];

        if (freeMemMB < minFreeMB) {
            return { ok: false, reason: `Low memory: ${freeMemMB.toFixed(0)}MB free (min: ${minFreeMB}MB)` };
        }

        if (loadAvg > maxLoad) {
            return { ok: false, reason: `High load: ${loadAvg.toFixed(2)} (max: ${maxLoad})` };
        }

        return { ok: true };
    }

    private async acquireLocal(token: string): Promise<boolean> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const handle = await fs.open(this.lockFile, 'wx');
                try {
                    await handle.writeFile(JSON.stringify({ token, pid: process.pid, timestamp: Date.now() }));
                } catch (error) {
                    await fs.unlink(this.lockFile).catch(() => undefined);
                    throw error;
                } finally {
                    await handle.close();
                }
                return true;
            } catch (error: any) {
                if (error?.code !== 'EEXIST') throw error;

                const stats = await fs.stat(this.lockFile).catch((statError: any) => {
                    if (statError?.code === 'ENOENT') return null;
                    throw statError;
                });
                if (!stats) continue;

                const ageMs = Date.now() - stats.mtimeMs;
                if (ageMs < this.ttlMs) return false;

                console.warn(`[CronGuard:${this.jobName}] Removing stale local lock (age: ${(ageMs / 60000).toFixed(1)}m)`);
                await fs.unlink(this.lockFile).catch((unlinkError: any) => {
                    if (unlinkError?.code !== 'ENOENT') throw unlinkError;
                });
            }
        }
        return false;
    }

    private async releaseLocal(token: string): Promise<void> {
        try {
            const raw = await fs.readFile(this.lockFile, 'utf8');
            const parsed = JSON.parse(raw);
            if (String(parsed?.token || '') !== token) return;
            await fs.unlink(this.lockFile);
        } catch (error: any) {
            if (error?.code !== 'ENOENT') {
                console.error(`[CronGuard:${this.jobName}] Error releasing local lock:`, error);
            }
        }
    }

    /**
     * Attempts to acquire this job's local lock and, when configured, its distributed lock.
     */
    async acquire(): Promise<boolean> {
        this.lastAcquireFailureReason = null;
        if (this.lockToken) {
            this.lastAcquireFailureReason = 'local_locked';
            return false;
        }
        const token = randomUUID();

        try {
            if (!(await this.acquireLocal(token))) {
                this.lastAcquireFailureReason = 'local_locked';
                return false;
            }

            if (this.useDistributedLock) {
                try {
                    const store = this.configuredDistributedStore || await getRedisCronDistributedLockStore();
                    if (!(await store.acquire({ key: this.distributedKey, token, ttlMs: this.ttlMs }))) {
                        this.lastAcquireFailureReason = 'distributed_locked';
                        await this.releaseLocal(token);
                        return false;
                    }
                    this.activeDistributedStore = store;
                } catch (error) {
                    this.lastAcquireFailureReason = 'distributed_unavailable';
                    console.error(`[CronGuard:${this.jobName}] Distributed lock unavailable; failing closed:`, error);
                    await this.releaseLocal(token);
                    return false;
                }
            }

            this.lockToken = token;
            return true;
        } catch (error) {
            this.lastAcquireFailureReason = 'acquire_error';
            console.error(`[CronGuard:${this.jobName}] Error acquiring lock:`, error);
            await this.releaseLocal(token);
            return false;
        }
    }

    getLastAcquireFailureReason(): string | null {
        return this.lastAcquireFailureReason;
    }

    /** Releases only locks owned by this guard's acquisition token. */
    async release(): Promise<void> {
        const token = this.lockToken;
        if (!token) return;
        this.lockToken = null;

        if (this.activeDistributedStore) {
            await this.activeDistributedStore.release({ key: this.distributedKey, token }).catch((error) => {
                console.error(`[CronGuard:${this.jobName}] Error releasing distributed lock:`, error);
                return false;
            });
            this.activeDistributedStore = null;
        }
        await this.releaseLocal(token);
    }
}
