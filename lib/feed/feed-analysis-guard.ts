import { createHash, randomUUID } from 'node:crypto';

export type FeedAnalysisRateLimitWindow = {
    key: string;
    limit: number;
    windowMs: number;
};

export type FeedAnalysisGuardStore = {
    acquireLock(args: {
        key: string;
        token: string;
        ttlMs: number;
    }): Promise<{ acquired: true } | { acquired: false; retryAfterMs: number }>;
    releaseLock(args: { key: string; token: string }): Promise<boolean>;
    consume(args: {
        windows: FeedAnalysisRateLimitWindow[];
    }): Promise<{ allowed: true } | { allowed: false; windowIndex: number; retryAfterMs: number }>;
};

type FeedAnalysisGuardOptions = {
    getStore?: () => Promise<FeedAnalysisGuardStore>;
    limits?: Array<{ name: string; limit: number; windowMs: number }>;
    lockTtlMs?: number;
};

type FeedAnalysisRunArgs<T> = {
    locationId: string;
    companyId: string;
    url: string;
    execute: () => Promise<T>;
};

const DEFAULT_LIMITS = [
    { name: 'minute', limit: 5, windowMs: 60_000 },
    { name: 'hour', limit: 30, windowMs: 60 * 60_000 },
];
const DEFAULT_LOCK_TTL_MS = 2 * 60_000;
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const CONSUME_LIMITS_SCRIPT = `
for i = 1, #KEYS do
  local count = tonumber(redis.call('GET', KEYS[i]) or '0')
  local limit = tonumber(ARGV[((i - 1) * 2) + 1])
  local window = tonumber(ARGV[((i - 1) * 2) + 2])
  if count >= limit then
    local ttl = redis.call('PTTL', KEYS[i])
    if ttl < 1 then ttl = window end
    return {0, i - 1, ttl}
  end
end
for i = 1, #KEYS do
  local window = tonumber(ARGV[((i - 1) * 2) + 2])
  local count = redis.call('INCR', KEYS[i])
  if count == 1 then redis.call('PEXPIRE', KEYS[i], window) end
end
return {1, -1, 0}
`;

let redisPromise: Promise<any> | null = null;

function hashScope(value: string) {
    return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function normalizeUrlForKey(value: string) {
    const url = new URL(value);
    url.hash = '';
    return url.toString();
}

function retryAfterSeconds(retryAfterMs: number) {
    return Math.max(1, Math.ceil(retryAfterMs / 1_000));
}

export class FeedAnalysisRateLimitError extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfterMs: number) {
        super('Feed analysis rate limit reached.');
        this.name = 'FeedAnalysisRateLimitError';
        this.retryAfterSeconds = retryAfterSeconds(retryAfterMs);
    }
}

export class FeedAnalysisInProgressError extends Error {
    readonly retryAfterSeconds: number;

    constructor(retryAfterMs: number) {
        super('An identical feed analysis is already in progress.');
        this.name = 'FeedAnalysisInProgressError';
        this.retryAfterSeconds = retryAfterSeconds(retryAfterMs);
    }
}

export class FeedAnalysisGuardUnavailableError extends Error {
    constructor() {
        super('Feed analysis guard is unavailable.');
        this.name = 'FeedAnalysisGuardUnavailableError';
    }
}

export function createRedisFeedAnalysisGuardStore(redis: {
    set(key: string, value: string, millisecondsToken: 'PX', milliseconds: number, nx: 'NX'): Promise<'OK' | null>;
    pttl(key: string): Promise<number>;
    eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}): FeedAnalysisGuardStore {
    return {
        async acquireLock(args) {
            if (await redis.set(args.key, args.token, 'PX', args.ttlMs, 'NX') === 'OK') {
                return { acquired: true };
            }
            const ttl = await redis.pttl(args.key);
            return { acquired: false, retryAfterMs: ttl > 0 ? ttl : 1_000 };
        },
        async releaseLock(args) {
            return Number(await redis.eval(RELEASE_LOCK_SCRIPT, 1, args.key, args.token)) === 1;
        },
        async consume(args) {
            const values = args.windows.flatMap((window) => [window.limit, window.windowMs]);
            const raw = await redis.eval(
                CONSUME_LIMITS_SCRIPT,
                args.windows.length,
                ...args.windows.map((window) => window.key),
                ...values,
            );
            const response = Array.isArray(raw) ? raw.map(Number) : [];
            if (response[0] === 1) return { allowed: true };
            if (response[0] === 0 && Number.isInteger(response[1]) && Number.isFinite(response[2])) {
                return {
                    allowed: false,
                    windowIndex: response[1],
                    retryAfterMs: Math.max(1_000, response[2]),
                };
            }
            throw new Error('Invalid Redis feed analysis rate-limit response.');
        },
    };
}

async function getRedisFeedAnalysisGuardStore(): Promise<FeedAnalysisGuardStore> {
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
        return createRedisFeedAnalysisGuardStore(await redisPromise);
    } catch (error) {
        redisPromise = null;
        throw error;
    }
}

export function createFeedAnalysisGuard(options: FeedAnalysisGuardOptions = {}) {
    const getStore = options.getStore || getRedisFeedAnalysisGuardStore;
    const limits = options.limits || DEFAULT_LIMITS;
    const lockTtlMs = Math.max(1_000, options.lockTtlMs || DEFAULT_LOCK_TTL_MS);
    const inFlight = new Map<string, Promise<unknown>>();

    return {
        async run<T>(args: FeedAnalysisRunArgs<T>): Promise<T> {
            const requestScope = hashScope(
                `${args.locationId}:${args.companyId}:${normalizeUrlForKey(args.url)}`,
            );
            const existing = inFlight.get(requestScope);
            if (existing) return existing as Promise<T>;

            const operation = (async () => {
                let store: FeedAnalysisGuardStore;
                try {
                    store = await getStore();
                } catch (error) {
                    console.error('[feedAnalysisGuard] Store unavailable:', error);
                    throw new FeedAnalysisGuardUnavailableError();
                }

                const lockKey = `estio:feed-analysis-lock:v1:${requestScope}`;
                const lockToken = randomUUID();
                let lockAcquired = false;
                try {
                    let lock;
                    try {
                        lock = await store.acquireLock({ key: lockKey, token: lockToken, ttlMs: lockTtlMs });
                    } catch (error) {
                        console.error('[feedAnalysisGuard] Lock unavailable:', error);
                        throw new FeedAnalysisGuardUnavailableError();
                    }
                    if (!lock.acquired) throw new FeedAnalysisInProgressError(lock.retryAfterMs);
                    lockAcquired = true;

                    const locationScope = hashScope(args.locationId);
                    const windows = limits.map((limit) => ({
                        key: `estio:feed-analysis-rate:v1:${locationScope}:${limit.name}`,
                        limit: limit.limit,
                        windowMs: limit.windowMs,
                    }));
                    let decision;
                    try {
                        decision = await store.consume({ windows });
                    } catch (error) {
                        console.error('[feedAnalysisGuard] Rate limit unavailable:', error);
                        throw new FeedAnalysisGuardUnavailableError();
                    }
                    if (!decision.allowed) throw new FeedAnalysisRateLimitError(decision.retryAfterMs);

                    return await args.execute();
                } finally {
                    if (lockAcquired) {
                        await store.releaseLock({ key: lockKey, token: lockToken }).catch((error) => {
                            console.error('[feedAnalysisGuard] Lock release failed:', error);
                            return false;
                        });
                    }
                }
            })();

            inFlight.set(requestScope, operation);
            try {
                return await operation;
            } finally {
                if (inFlight.get(requestScope) === operation) inFlight.delete(requestScope);
            }
        },
    };
}

const feedAnalysisGuard = createFeedAnalysisGuard();

export async function runFeedAnalysisGuarded<T>(args: FeedAnalysisRunArgs<T>) {
    return feedAnalysisGuard.run(args);
}
