import { createHash } from "node:crypto";

export type WhatsAppRateLimitMode = "disabled" | "shadow" | "enforce";
export type WhatsAppRateLimitWindow = {
    key: string;
    limit: number;
    windowMs: number;
    reason: string;
    action: "reschedule" | "review";
};

export type WhatsAppRateLimitDecision = {
    allowed: boolean;
    mode: WhatsAppRateLimitMode;
    reason: string | null;
    action: "allow" | "reschedule" | "review";
    nextEligibleAt: Date | null;
    retryDelayMs: number;
    limitedWindow?: WhatsAppRateLimitWindow;
};

export type WhatsAppRateLimitStore = {
    consume(args: {
        windows: WhatsAppRateLimitWindow[];
        member: string;
        nowMs: number;
    }): Promise<{ allowed: true } | { allowed: false; windowIndex: number; nextEligibleAtMs: number }>;
};

export type WhatsAppRateLimitPolicyValues = {
    sessionBurstMax: number;
    sessionBurstWindowMs: number;
    sessionMinuteMax: number;
    sessionMinuteWindowMs: number;
    sessionHourlyMax: number;
    sessionHourlyWindowMs: number;
    sessionDailyMax: number;
    sessionDailyWindowMs: number;
    recipientMinuteMax: number;
    recipientMinuteWindowMs: number;
    recipientDailyMax: number;
    recipientDailyWindowMs: number;
};

const LIMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
for i = 1, #KEYS do
  local limit = tonumber(ARGV[2 + ((i - 1) * 2) + 1])
  local window = tonumber(ARGV[2 + ((i - 1) * 2) + 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - window)
  local count = redis.call('ZCARD', KEYS[i])
  if count >= limit then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local nextAt = now + window
    if oldest[2] then nextAt = tonumber(oldest[2]) + window end
    return {0, i - 1, nextAt}
  end
end
for i = 1, #KEYS do
  local window = tonumber(ARGV[2 + ((i - 1) * 2) + 2])
  redis.call('ZADD', KEYS[i], now, member)
  redis.call('PEXPIRE', KEYS[i], window + 60000)
end
return {1, -1, 0}
`;

let redisPromise: Promise<any> | null = null;

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function hashScope(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function getWhatsAppRateLimitMode(env: NodeJS.ProcessEnv = process.env): WhatsAppRateLimitMode {
    const value = String(env.WHATSAPP_RATE_LIMIT_MODE || "disabled").trim().toLowerCase();
    return value === "enforce" || value === "shadow" ? value : "disabled";
}

export function resolveWhatsAppRateLimitPolicyValues(args: {
    trustTier?: string | null;
    sessionCreatedAt: Date;
    now: Date;
    overrides?: Record<string, unknown> | null;
}): WhatsAppRateLimitPolicyValues {
    const ageMs = Math.max(0, args.now.getTime() - args.sessionCreatedAt.getTime());
    const isNewSession = ageMs < 7 * 24 * 60 * 60 * 1000;
    const trustTier = String(args.trustTier || (isNewSession ? "new" : "established")).toLowerCase();
    const defaultDaily = trustTier === "new" ? 100 : 500;
    const source = args.overrides || {};

    return {
        sessionBurstMax: boundedInteger(source.sessionBurstMax, 3, 1, 100),
        sessionBurstWindowMs: boundedInteger(source.sessionBurstWindowMs, 10_000, 1_000, 60 * 60 * 1000),
        sessionMinuteMax: boundedInteger(source.sessionMinuteMax, 6, 1, 1_000),
        sessionMinuteWindowMs: boundedInteger(source.sessionMinuteWindowMs, 60_000, 1_000, 60 * 60 * 1000),
        sessionHourlyMax: boundedInteger(source.sessionHourlyMax, 120, 1, 100_000),
        sessionHourlyWindowMs: boundedInteger(source.sessionHourlyWindowMs, 60 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
        sessionDailyMax: boundedInteger(source.sessionDailyMax, defaultDaily, 1, 1_000_000),
        sessionDailyWindowMs: boundedInteger(source.sessionDailyWindowMs, 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
        recipientMinuteMax: boundedInteger(source.recipientMinuteMax, 3, 1, 1_000),
        recipientMinuteWindowMs: boundedInteger(source.recipientMinuteWindowMs, 60_000, 1_000, 60 * 60 * 1000),
        recipientDailyMax: boundedInteger(source.recipientDailyMax, 20, 1, 100_000),
        recipientDailyWindowMs: boundedInteger(source.recipientDailyWindowMs, 24 * 60 * 60 * 1000, 60 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
    };
}

export function buildWhatsAppRateLimitWindows(args: {
    sessionScope: string;
    recipientScope: string;
    policy: WhatsAppRateLimitPolicyValues;
}): WhatsAppRateLimitWindow[] {
    const session = hashScope(`session:${args.sessionScope}`);
    const recipient = hashScope(`session:${args.sessionScope}:recipient:${args.recipientScope}`);
    const prefix = "wa:rate-limit:v1";
    return [
        { key: `${prefix}:session:${session}:burst`, limit: args.policy.sessionBurstMax, windowMs: args.policy.sessionBurstWindowMs, reason: "Session burst limit reached", action: "reschedule" },
        { key: `${prefix}:session:${session}:minute`, limit: args.policy.sessionMinuteMax, windowMs: args.policy.sessionMinuteWindowMs, reason: "Session sustained limit reached", action: "reschedule" },
        { key: `${prefix}:session:${session}:hour`, limit: args.policy.sessionHourlyMax, windowMs: args.policy.sessionHourlyWindowMs, reason: "Session hourly limit reached", action: "reschedule" },
        { key: `${prefix}:session:${session}:day`, limit: args.policy.sessionDailyMax, windowMs: args.policy.sessionDailyWindowMs, reason: "Session daily limit reached; pending review", action: "review" },
        { key: `${prefix}:recipient:${recipient}:minute`, limit: args.policy.recipientMinuteMax, windowMs: args.policy.recipientMinuteWindowMs, reason: "Recipient minute limit reached", action: "reschedule" },
        { key: `${prefix}:recipient:${recipient}:day`, limit: args.policy.recipientDailyMax, windowMs: args.policy.recipientDailyWindowMs, reason: "Recipient daily limit reached; pending review", action: "review" },
    ];
}

export function computeRateLimitRetryDelayMs(args: { nowMs: number; nextEligibleAtMs: number; random?: () => number }) {
    const waitMs = Math.max(1_000, args.nextEligibleAtMs - args.nowMs);
    const jitterCap = Math.min(waitMs, 30_000);
    return waitMs + Math.floor((args.random || Math.random)() * jitterCap);
}

export async function evaluateWhatsAppRateLimit(args: {
    store: WhatsAppRateLimitStore;
    mode: WhatsAppRateLimitMode;
    windows: WhatsAppRateLimitWindow[];
    member: string;
    now?: Date;
    random?: () => number;
}): Promise<WhatsAppRateLimitDecision> {
    if (args.mode === "disabled") {
        return { allowed: true, mode: args.mode, reason: null, action: "allow", nextEligibleAt: null, retryDelayMs: 0 };
    }
    const now = args.now || new Date();
    const result = await args.store.consume({ windows: args.windows, member: args.member, nowMs: now.getTime() });
    if (result.allowed) {
        return { allowed: true, mode: args.mode, reason: null, action: "allow", nextEligibleAt: null, retryDelayMs: 0 };
    }
    if (args.mode === "shadow") {
        return { allowed: true, mode: args.mode, reason: null, action: "allow", nextEligibleAt: null, retryDelayMs: 0 };
    }
    const window = args.windows[result.windowIndex];
    if (!window) throw new Error("Redis returned an invalid WhatsApp rate-limit window");
    const retryDelayMs = computeRateLimitRetryDelayMs({ nowMs: now.getTime(), nextEligibleAtMs: result.nextEligibleAtMs, random: args.random });
    return {
        allowed: false,
        mode: args.mode,
        reason: window.reason,
        action: window.action,
        nextEligibleAt: new Date(result.nextEligibleAtMs),
        retryDelayMs,
        limitedWindow: window,
    };
}

export function createRedisWhatsAppRateLimitStore(redis: {
    eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
}): WhatsAppRateLimitStore {
    return {
        async consume(args) {
            const values: Array<string | number> = [args.nowMs, args.member];
            for (const window of args.windows) values.push(window.limit, window.windowMs);
            const raw = await redis.eval(LIMIT_SCRIPT, args.windows.length, ...args.windows.map((window) => window.key), ...values);
            const response = Array.isArray(raw) ? raw.map(Number) : [];
            if (response[0] === 1) return { allowed: true };
            if (response[0] === 0 && Number.isInteger(response[1]) && Number.isFinite(response[2])) {
                return { allowed: false, windowIndex: response[1], nextEligibleAtMs: response[2] };
            }
            throw new Error("Invalid Redis WhatsApp rate-limit response");
        },
    };
}

export async function getWhatsAppRateLimitStore(): Promise<WhatsAppRateLimitStore> {
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
        return createRedisWhatsAppRateLimitStore(await redisPromise);
    } catch (error) {
        redisPromise = null;
        throw error;
    }
}

export function createWhatsAppRateLimitMember(outboxId: string, attemptOrdinal: number) {
    return `${hashScope(outboxId)}:${Math.max(1, Math.trunc(attemptOrdinal))}`;
}
