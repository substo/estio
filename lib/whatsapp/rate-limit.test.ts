import assert from "node:assert/strict";
import test from "node:test";
import {
    buildWhatsAppRateLimitWindows,
    evaluateWhatsAppRateLimit,
    resolveWhatsAppRateLimitPolicyValues,
    type WhatsAppRateLimitStore,
} from "./rate-limit";

class MemorySlidingWindowStore implements WhatsAppRateLimitStore {
    entries = new Map<string, Array<{ member: string; at: number }>>();
    private queue = Promise.resolve();

    consume(args: Parameters<WhatsAppRateLimitStore["consume"]>[0]) {
        const operation = this.queue.then(() => {
            for (let index = 0; index < args.windows.length; index += 1) {
                const window = args.windows[index];
                const retained = (this.entries.get(window.key) || []).filter((entry) => entry.at > args.nowMs - window.windowMs);
                this.entries.set(window.key, retained);
                if (retained.length >= window.limit) {
                    return {
                        allowed: false as const,
                        windowIndex: index,
                        nextEligibleAtMs: retained[0].at + window.windowMs,
                    };
                }
            }
            for (const window of args.windows) {
                this.entries.set(window.key, [...(this.entries.get(window.key) || []), { member: args.member, at: args.nowMs }]);
            }
            return { allowed: true as const };
        });
        this.queue = operation.then(() => undefined, () => undefined);
        return operation;
    }
}

const now = new Date("2026-07-19T12:00:00.000Z");
const policy = resolveWhatsAppRateLimitPolicyValues({
    sessionCreatedAt: new Date("2026-07-18T12:00:00.000Z"),
    now,
});

test("new and established sessions receive the configured daily defaults", () => {
    assert.equal(policy.sessionDailyMax, 100);
    assert.equal(resolveWhatsAppRateLimitPolicyValues({
        sessionCreatedAt: new Date("2026-07-01T12:00:00.000Z"),
        now,
    }).sessionDailyMax, 500);
    assert.equal(resolveWhatsAppRateLimitPolicyValues({
        trustTier: "reviewed",
        sessionCreatedAt: now,
        now,
        overrides: { sessionDailyMax: 750 },
    }).sessionDailyMax, 750);
});

test("concurrent workers cannot exceed an atomic session burst limit", async () => {
    const store = new MemorySlidingWindowStore();
    const windows = buildWhatsAppRateLimitWindows({
        sessionScope: "session-1",
        recipientScope: "35799000000",
        policy: { ...policy, sessionBurstMax: 1 },
    });
    const decisions = await Promise.all([
        evaluateWhatsAppRateLimit({ store, mode: "enforce", windows, member: "outbox-a:1", now, random: () => 0 }),
        evaluateWhatsAppRateLimit({ store, mode: "enforce", windows, member: "outbox-b:1", now, random: () => 0 }),
    ]);
    assert.equal(decisions.filter((decision) => decision.allowed).length, 1);
    const denied = decisions.find((decision) => !decision.allowed);
    assert.equal(denied?.reason, "Session burst limit reached");
    assert.equal(denied?.nextEligibleAt?.toISOString(), "2026-07-19T12:00:10.000Z");
});

test("shadow mode records counters without delaying the send", async () => {
    const store = new MemorySlidingWindowStore();
    const windows = buildWhatsAppRateLimitWindows({
        sessionScope: "session-1",
        recipientScope: "recipient-1",
        policy: { ...policy, sessionBurstMax: 1 },
    });
    await evaluateWhatsAppRateLimit({ store, mode: "shadow", windows, member: "one", now });
    const second = await evaluateWhatsAppRateLimit({ store, mode: "shadow", windows, member: "two", now });
    assert.equal(second.allowed, true);
});

test("Redis errors are surfaced so enforce mode can fail closed", async () => {
    const store: WhatsAppRateLimitStore = {
        consume: async () => { throw new Error("Redis unavailable"); },
    };
    await assert.rejects(() => evaluateWhatsAppRateLimit({
        store,
        mode: "enforce",
        windows: buildWhatsAppRateLimitWindows({ sessionScope: "session-1", recipientScope: "recipient-1", policy }),
        member: "outbox-a:1",
        now,
    }), /Redis unavailable/);
});
