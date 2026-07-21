const NON_READY_STALE_STATUSES = new Set(["authenticated", "starting", "loading", "failed"]);

export const DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS = 180_000;
export const DEFAULT_WEB_BRIDGE_FAILED_RETRY_MS = 30_000;

function parseTimestampMs(value: unknown) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
    return Number.isFinite(time) ? time : null;
}

export function getStaleWhatsAppWebBridgeNonReadyReason(args: {
    status?: unknown;
    ready?: unknown;
    lastEventAt?: unknown;
    startedAt?: unknown;
    nowMs?: number;
    maxAgeMs?: number;
}) {
    if (args.ready) return null;

    const status = String(args.status || "").trim().toLowerCase();
    if (!NON_READY_STALE_STATUSES.has(status)) return null;

    const referenceMs = parseTimestampMs(args.lastEventAt) ?? parseTimestampMs(args.startedAt);
    if (!referenceMs) return null;

    const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
    const configuredMaxAgeMs = Math.max(Number(args.maxAgeMs || DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS), 30_000);
    const maxAgeMs = status === "failed"
        ? Math.min(configuredMaxAgeMs, DEFAULT_WEB_BRIDGE_FAILED_RETRY_MS)
        : configuredMaxAgeMs;
    const ageMs = nowMs - referenceMs;
    if (ageMs <= maxAgeMs) return null;

    return `WhatsApp Web Bridge session stayed ${status} for ${Math.round(ageMs / 1000)} seconds without becoming ready.`;
}
