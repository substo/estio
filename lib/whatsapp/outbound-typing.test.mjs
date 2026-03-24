import test from "node:test";
import assert from "node:assert/strict";
import { computeWhatsAppTypingDelay } from "./outbound-typing.ts";

const ENV_KEYS = [
    "WHATSAPP_TYPING_SIMULATION_ENABLED",
    "WHATSAPP_TYPING_IDLE_BYPASS_MS",
    "WHATSAPP_TYPING_MIN_DELAY_MS",
    "WHATSAPP_TYPING_MAX_DELAY_MS",
    "WHATSAPP_TYPING_PER_WORD_MS",
    "WHATSAPP_TYPING_PER_CHAR_MS",
    "WHATSAPP_TYPING_PUNCTUATION_PAUSE_MS",
    "WHATSAPP_TYPING_JITTER_PCT",
];

function withEnv(overrides, fn) {
    const previous = new Map();
    for (const key of ENV_KEYS) {
        previous.set(key, process.env[key]);
    }
    for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined || value === null) delete process.env[key];
        else process.env[key] = String(value);
    }

    try {
        return fn();
    } finally {
        for (const key of ENV_KEYS) {
            const value = previous.get(key);
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

test("typing delay bypasses when inbound message is stale", () => {
    withEnv({
        WHATSAPP_TYPING_SIMULATION_ENABLED: "true",
        WHATSAPP_TYPING_IDLE_BYPASS_MS: "120000",
        WHATSAPP_TYPING_JITTER_PCT: "0",
    }, () => {
        const now = new Date("2026-03-24T10:00:00.000Z");
        const result = computeWhatsAppTypingDelay({
            body: "Hello there",
            messageCreatedAt: now,
            lastInboundMessageAt: new Date("2026-03-24T09:54:00.000Z"),
        });

        assert.equal(result.delayMs, 0);
        assert.equal(result.reason, "idle_bypass");
    });
});

test("typing delay scales by content and clamps to bounds", () => {
    withEnv({
        WHATSAPP_TYPING_SIMULATION_ENABLED: "true",
        WHATSAPP_TYPING_IDLE_BYPASS_MS: "999999999",
        WHATSAPP_TYPING_MIN_DELAY_MS: "250",
        WHATSAPP_TYPING_MAX_DELAY_MS: "1500",
        WHATSAPP_TYPING_PER_WORD_MS: "100",
        WHATSAPP_TYPING_PER_CHAR_MS: "10",
        WHATSAPP_TYPING_PUNCTUATION_PAUSE_MS: "50",
        WHATSAPP_TYPING_JITTER_PCT: "0",
    }, () => {
        const now = new Date("2026-03-24T10:00:00.000Z");

        const short = computeWhatsAppTypingDelay({
            body: "hi",
            messageCreatedAt: now,
            lastInboundMessageAt: new Date("2026-03-24T09:59:59.000Z"),
        });
        assert.equal(short.delayMs, 250);
        assert.equal(short.reason, "length_based");

        const long = computeWhatsAppTypingDelay({
            body: "This is a very long message designed to exceed the maximum delay limit by a wide margin. It keeps going, with punctuation! And more words, and more words, and more words.",
            messageCreatedAt: now,
            lastInboundMessageAt: new Date("2026-03-24T09:59:59.000Z"),
        });
        assert.equal(long.delayMs, 1500);
        assert.equal(long.reason, "length_based");
    });
});

test("typing delay bypasses retries", () => {
    withEnv({
        WHATSAPP_TYPING_SIMULATION_ENABLED: "true",
        WHATSAPP_TYPING_JITTER_PCT: "0",
    }, () => {
        const result = computeWhatsAppTypingDelay({
            body: "Retry this send",
            messageCreatedAt: new Date("2026-03-24T10:00:00.000Z"),
            lastInboundMessageAt: new Date("2026-03-24T09:59:30.000Z"),
            isRetryAttempt: true,
        });

        assert.equal(result.delayMs, 0);
        assert.equal(result.reason, "retry_bypass");
    });
});
