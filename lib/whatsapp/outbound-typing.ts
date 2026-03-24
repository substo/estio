type WhatsAppTypingDelayInput = {
    body: string;
    messageCreatedAt: Date;
    lastInboundMessageAt?: Date | null;
    isRetryAttempt?: boolean;
};

type WhatsAppTypingDelayReason =
    | "disabled"
    | "retry_bypass"
    | "idle_bypass"
    | "length_based";

export type WhatsAppTypingDelayResult = {
    delayMs: number;
    reason: WhatsAppTypingDelayReason;
    snapshot: Record<string, unknown>;
};

function toNumber(value: string | undefined, fallback: number, min: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return fallback;
}

function countWords(text: string): number {
    const matches = String(text || "")
        .trim()
        .match(/[^\s]+/g);
    return Array.isArray(matches) ? matches.length : 0;
}

function countPunctuation(text: string): number {
    const matches = String(text || "").match(/[.,!?;:]/g);
    return Array.isArray(matches) ? matches.length : 0;
}

function applyDeterministicJitter(baseDelayMs: number, input: string): number {
    const maxJitterPct = toNumber(process.env.WHATSAPP_TYPING_JITTER_PCT, 0.15, 0, 0.4);
    if (maxJitterPct <= 0) return baseDelayMs;

    let hash = 0;
    const seed = String(input || "");
    for (let i = 0; i < seed.length; i += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }

    const normalized = ((hash >>> 0) % 10000) / 10000; // 0..1
    const multiplier = 1 - maxJitterPct + (normalized * maxJitterPct * 2);
    return Math.round(baseDelayMs * multiplier);
}

export function computeWhatsAppTypingDelay(input: WhatsAppTypingDelayInput): WhatsAppTypingDelayResult {
    const typingEnabled = toBoolean(process.env.WHATSAPP_TYPING_SIMULATION_ENABLED, true);
    const idleBypassMs = toNumber(process.env.WHATSAPP_TYPING_IDLE_BYPASS_MS, 120_000, 0, 24 * 60 * 60 * 1000);
    const minDelayMs = toNumber(process.env.WHATSAPP_TYPING_MIN_DELAY_MS, 250, 0, 60_000);
    const maxDelayMs = toNumber(process.env.WHATSAPP_TYPING_MAX_DELAY_MS, 4500, minDelayMs, 120_000);
    const perWordMs = toNumber(process.env.WHATSAPP_TYPING_PER_WORD_MS, 180, 0, 5000);
    const perCharMs = toNumber(process.env.WHATSAPP_TYPING_PER_CHAR_MS, 22, 0, 500);
    const punctuationPauseMs = toNumber(process.env.WHATSAPP_TYPING_PUNCTUATION_PAUSE_MS, 120, 0, 2000);

    const body = String(input.body || "");
    const nowMs = Number(new Date(input.messageCreatedAt).getTime());
    const lastInboundMs = input.lastInboundMessageAt ? Number(new Date(input.lastInboundMessageAt).getTime()) : null;
    const lastInboundAgeMs = lastInboundMs && Number.isFinite(lastInboundMs)
        ? Math.max(nowMs - lastInboundMs, 0)
        : null;

    const commonSnapshot = {
        typingEnabled,
        idleBypassMs,
        minDelayMs,
        maxDelayMs,
        perWordMs,
        perCharMs,
        punctuationPauseMs,
        bodyLength: body.length,
        words: countWords(body),
        punctuationCount: countPunctuation(body),
        lastInboundAgeMs,
        isRetryAttempt: !!input.isRetryAttempt,
    };

    if (!typingEnabled) {
        return {
            delayMs: 0,
            reason: "disabled",
            snapshot: commonSnapshot,
        };
    }

    if (input.isRetryAttempt) {
        return {
            delayMs: 0,
            reason: "retry_bypass",
            snapshot: commonSnapshot,
        };
    }

    if (lastInboundAgeMs !== null && lastInboundAgeMs > idleBypassMs) {
        return {
            delayMs: 0,
            reason: "idle_bypass",
            snapshot: commonSnapshot,
        };
    }

    const words = countWords(body);
    const chars = body.length;
    const punctuationCount = countPunctuation(body);

    const wordEstimate = words * perWordMs;
    const charEstimate = chars * perCharMs;
    const punctuationPause = punctuationCount * punctuationPauseMs;
    const baseDelay = Math.max(wordEstimate, charEstimate) + punctuationPause;
    const jitteredDelay = applyDeterministicJitter(baseDelay, `${body}:${nowMs}`);
    const clampedDelay = Math.max(minDelayMs, Math.min(maxDelayMs, jitteredDelay));

    return {
        delayMs: clampedDelay,
        reason: "length_based",
        snapshot: {
            ...commonSnapshot,
            wordEstimate,
            charEstimate,
            punctuationPause,
            baseDelay,
            jitteredDelay,
        },
    };
}
